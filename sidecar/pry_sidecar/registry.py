"""In-memory model registry.

Phase 2: holds real HookedTransformer + SAE handles, keyed by preset id.
Loads are synchronous (blocking); callers should wrap in asyncio.to_thread
to avoid starving the event loop.
"""

from __future__ import annotations

import os
import threading
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from .presets import PresetManifest


class LoadedModel:
    """A loaded model + its companion SAE, pinned to a device."""

    def __init__(
        self,
        preset_id: str,
        model: object,  # HookedTransformer
        sae: object,  # sae_lens.SAE
        sae_layer: int,
        device: str,
    ) -> None:
        self.preset_id = preset_id
        self.model = model
        self.sae = sae
        self.sae_layer = sae_layer
        self.device = device


class ModelRegistry:
    def __init__(self) -> None:
        self._loaded: dict[str, LoadedModel] = {}
        # M2 fix: one lock per preset id to allow concurrent loads of *different*
        # presets while serialising concurrent loads of the *same* preset.
        self._load_locks: dict[str, threading.Lock] = {}
        self._meta_lock = threading.Lock()  # guards _load_locks dict itself
        self._last_loaded: Optional[str] = None  # tracks most-recently loaded preset id

    # -- lookup -------------------------------------------------------------

    def is_loaded(self, preset_id: str) -> bool:
        # N3 fix: don't hold the per-preset lock here. The per-preset lock is
        # also held during the entire (potentially multi-minute) download inside
        # load(), so acquiring it in is_loaded() would cause callers to hang
        # silently. A lock-free dict membership check is safe in CPython due to
        # the GIL; worst case is a stale read — the actual load() path
        # double-checks under the lock anyway.
        return preset_id in self._loaded

    def get_loaded(self) -> list[str]:
        return list(self._loaded.keys())

    def get(self, preset_id: str) -> Optional[LoadedModel]:
        return self._loaded.get(preset_id)

    @property
    def last_loaded(self) -> Optional[str]:
        """Most-recently loaded preset id, or None if nothing has been loaded."""
        return self._last_loaded

    # -- lifecycle ----------------------------------------------------------

    def _get_lock(self, preset_id: str) -> threading.Lock:
        """Return (creating if needed) the per-preset load lock."""
        with self._meta_lock:
            if preset_id not in self._load_locks:
                self._load_locks[preset_id] = threading.Lock()
            return self._load_locks[preset_id]

    def load(self, preset_id: str, manifest: "PresetManifest") -> LoadedModel:
        """Load a model + SAE synchronously. Raises RuntimeError on failure.

        Heavy imports are deferred so that merely importing this module
        (e.g. during tests) does not pull in torch / transformer_lens.

        M2 fix: serialised per preset id — concurrent loads of the same preset
        are deduplicated; concurrent loads of *different* presets proceed in
        parallel (each holds its own lock).
        """
        # Fast path: already loaded, no lock needed for read
        if preset_id in self._loaded:
            return self._loaded[preset_id]

        lock = self._get_lock(preset_id)
        with lock:
            # Re-check inside lock (another thread may have loaded while we waited)
            if preset_id in self._loaded:
                return self._loaded[preset_id]

            try:
                import torch
                from transformer_lens import HookedTransformer
                from sae_lens import SAE
            except ImportError as e:
                raise RuntimeError(f"required ML deps not available: {e}") from e

            device = "cuda" if torch.cuda.is_available() else "cpu"
            sae_layer = manifest.sae.layer

            # M1 fix: read HF_TOKEN from env and pass it to gated model/SAE
            # downloads. Only used when the preset declares a license_gate.
            hf_token: Optional[str] = None
            if manifest.license_gate:
                hf_token = os.environ.get("HF_TOKEN")
                if not hf_token:
                    raise RuntimeError(
                        f"Preset '{preset_id}' requires a HuggingFace token "
                        f"(license gate: {manifest.license_gate!r}). "
                        "Set the HF_TOKEN environment variable after accepting "
                        "the model license on huggingface.co."
                    )

            try:
                model = HookedTransformer.from_pretrained(
                    manifest.model.tl_name,
                    device=device,
                    **({"token": hf_token} if hf_token else {}),
                )
                model.cfg.use_attn_result = True
            except torch.cuda.OutOfMemoryError as e:
                raise RuntimeError(f"CUDA OOM loading model {manifest.model.tl_name}: {e}") from e
            except Exception as e:
                raise RuntimeError(f"failed to load model {manifest.model.tl_name}: {e}") from e

            hook = manifest.sae.hook
            sae_id = f"blocks.{sae_layer}.{hook}"
            try:
                sae_kwargs: dict = dict(
                    release=manifest.sae.release,
                    sae_id=sae_id,
                    device=device,
                )
                if hf_token:
                    sae_kwargs["hf_token"] = hf_token
                sae_result = SAE.from_pretrained(**sae_kwargs)
                # sae_lens.SAE.from_pretrained returns a tuple in some versions
                # (sae, cfg_dict, sparsity). Normalize to the SAE object.
                if isinstance(sae_result, tuple):
                    sae = sae_result[0]
                else:
                    sae = sae_result
            except torch.cuda.OutOfMemoryError as e:
                # Free the model before bubbling up
                del model
                torch.cuda.empty_cache()
                raise RuntimeError(f"CUDA OOM loading SAE {manifest.sae.release}: {e}") from e
            except Exception as e:
                del model
                if device == "cuda":
                    torch.cuda.empty_cache()
                raise RuntimeError(f"failed to load SAE {manifest.sae.release}@{sae_id}: {e}") from e

            loaded = LoadedModel(
                preset_id=preset_id,
                model=model,
                sae=sae,
                sae_layer=sae_layer,
                device=device,
            )
            self._loaded[preset_id] = loaded
            self._last_loaded = preset_id
            return loaded

    def swap_sae(self, preset_id: str, layer: int, manifest: "PresetManifest") -> LoadedModel:
        """Unload current SAE, load new SAE at specified layer. Model stays resident.

        Updates loaded.sae, loaded.sae_layer.
        IMPORTANT: This method does NOT acquire the per-preset lock itself.
        Caller (run_sae_features) must hold the lock for the entire operation
        (swap + forward pass + SAE encode) to prevent race conditions with
        concurrent /generate requests.
        """
        loaded = self._loaded.get(preset_id)
        if loaded is None:
            raise RuntimeError(f"preset {preset_id!r} not loaded")

        import gc
        import torch
        from sae_lens import SAE

        sae_id = f"blocks.{layer}.{manifest.sae.hook}"

        # Free old SAE before loading new one to minimize peak VRAM
        old_sae = loaded.sae
        loaded.sae = None
        del old_sae
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        try:
            hf_token: Optional[str] = None
            if manifest.license_gate:
                hf_token = os.environ.get("HF_TOKEN")
            sae_kwargs: dict = dict(
                release=manifest.sae.release,
                sae_id=sae_id,
                device=loaded.device,
            )
            if hf_token:
                sae_kwargs["hf_token"] = hf_token
            sae_result = SAE.from_pretrained(**sae_kwargs)
            if isinstance(sae_result, tuple):
                sae = sae_result[0]
            else:
                sae = sae_result
        except Exception as e:
            # On failure, try to restore original SAE at the old layer
            raise RuntimeError(f"failed to load SAE {manifest.sae.release}@{sae_id}: {e}") from e

        loaded.sae = sae
        loaded.sae_layer = layer
        return loaded

    def unload(self, preset_id: str) -> bool:
        """Free a preset's model + SAE and reclaim VRAM.

        Returns True iff the preset was present in _loaded and was actually
        popped (computed inside the per-preset lock for race-freedom). Returns
        False if the preset was not loaded (no-op).
        """
        lock = self._get_lock(preset_id)
        was_present = False
        with lock:
            loaded = self._loaded.pop(preset_id, None)
            was_present = loaded is not None
            if loaded is not None:
                # M1 fix: null refs while still holding the per-preset lock so no
                # concurrent thread can obtain the handle from _loaded and then race
                # to use .model/.sae after they've been set to None. Pop happens
                # first (removes from _loaded), then we null inside the lock before
                # releasing it. empty_cache() is called after the lock to avoid
                # holding it during a potentially slow CUDA operation.
                loaded.model = None
                loaded.sae = None
                if self._last_loaded == preset_id:
                    self._last_loaded = next(iter(self._loaded), None)
        if was_present:
            try:
                import gc
                gc.collect()
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
        return was_present


# Module-level singletons. Both names are exported for compatibility: the
# older call sites used `registry`, the plan references `REGISTRY`.
REGISTRY = ModelRegistry()
registry = REGISTRY
