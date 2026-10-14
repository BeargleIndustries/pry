"""In-memory model registry.

Phase 2: holds real HookedTransformer + SAE handles, keyed by preset id.
Loads are synchronous (blocking); callers should wrap in asyncio.to_thread
to avoid starving the event loop.
"""

from __future__ import annotations

import gc
import logging
import os
import threading
from typing import TYPE_CHECKING, Callable, Optional

if TYPE_CHECKING:
    from .presets import PresetManifest

logger = logging.getLogger("pry_sidecar")


def _fault_sae_swap_enabled() -> bool:
    """Dev-only fault switch: make ``swap_sae`` fail on purpose.

    Needs both ``PRY_DEV=1`` and ``PRY_FAULT_SAE_SWAP=1`` so a stray
    variable on a user's machine can never trigger it.
    """
    return os.environ.get("PRY_DEV") == "1" and os.environ.get("PRY_FAULT_SAE_SWAP") == "1"


class LicenseGateError(RuntimeError):
    """A gated model (e.g. Gemma) can't be downloaded yet.

    ``step`` names the missing setup step: ``"token"`` (no Hugging Face token,
    or Hugging Face rejected it) or ``"license"`` (the token works but its
    account hasn't accepted the model's license). The message is plain
    language and is shown to the user as-is.
    """

    def __init__(self, step: str, message: str) -> None:
        super().__init__(message)
        self.step = step


def _gate_message(manifest: "PresetManifest", step: str, token_present: bool) -> str:
    name = manifest.display.name
    lead = f"{name} needs one more setup step: "
    again = f"then load {name} again."
    if step == "license":
        return (
            lead + "your Hugging Face account hasn't accepted Google's Gemma license yet. "
            f"Accept it at huggingface.co/{manifest.model.hf_id} in your browser, " + again
        )
    if token_present:
        return (
            lead + "Hugging Face didn't accept the token Pry has saved. Paste a fresh "
            "read token in the Hugging Face token step, " + again
        )
    return (
        lead + "Pry doesn't have your Hugging Face token yet. Add it in the "
        "Hugging Face token step, " + again
    )


def hf_token_for(manifest: "PresetManifest") -> Optional[str]:
    """The HF token for a gated preset (None for ungated presets).

    Raises LicenseGateError when the preset is gated and no token is set.
    Rust passes the saved token to this process as ``HF_TOKEN``.
    """
    if not manifest.license_gate:
        return None
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise LicenseGateError("token", _gate_message(manifest, "token", token_present=False))
    return token


def license_gate_error(manifest: "PresetManifest", exc: BaseException) -> Optional[LicenseGateError]:
    """Classify a load failure on a gated preset as a missing setup step.

    Hugging Face answers 401 when the token is missing or invalid and 403 when
    a valid token's account hasn't accepted the license (huggingface_hub's
    ``GatedRepoError``; transformers re-raises it as an OSError ``from`` the
    original). Returns None when the failure isn't about the gate.
    """
    if not manifest.license_gate:
        return None
    token_present = bool(os.environ.get("HF_TOKEN"))
    status: Optional[int] = None
    gated = False
    seen: set[int] = set()
    e: Optional[BaseException] = exc
    while e is not None and id(e) not in seen:
        seen.add(id(e))
        if isinstance(e, LicenseGateError):
            return e
        code = getattr(getattr(e, "response", None), "status_code", None)
        if code in (401, 403):
            status = code
        text = str(e)
        if type(e).__name__ == "GatedRepoError" or "gated repo" in text.lower():
            gated = True
        if status is None:
            if "401 Client Error" in text:
                status = 401
            elif "403 Client Error" in text:
                status = 403
        e = e.__cause__ or e.__context__
    if status is None and not gated:
        return None
    if not token_present or status == 401:
        step = "token"
    else:
        step = "license"
    return LicenseGateError(step, _gate_message(manifest, step, token_present))


class LoadedModel:
    """A loaded model + its companion SAE, pinned to a device."""

    def __init__(
        self,
        preset_id: str,
        model: object,  # HookedTransformer
        sae: object,  # sae_lens.SAE; None for custom models (T32)
        sae_layer: Optional[int],  # None for custom models (no SAE)
        device: str,
        model_revision: Optional[str] = None,
        sae_release: Optional[str] = None,
        sae_id: Optional[str] = None,
    ) -> None:
        self.preset_id = preset_id
        self.model = model
        self.sae = sae
        self.sae_layer = sae_layer
        self.device = device
        # MF-5 provenance: the Hugging Face snapshot hash the weights were read
        # from (recorded, not pinned; None if it can't be resolved) and the SAE.
        self.model_revision = model_revision
        self.sae_release = sae_release
        self.sae_id = sae_id


def resolve_model_revision(hf_id: str) -> Optional[str]:
    """The snapshot hash of ``hf_id`` in the local Hugging Face cache, or None.

    Read from the cached ``config.json`` path (``.../snapshots/<hash>/config.json``),
    i.e. the revision the weights were actually loaded from. Never touches the
    network.
    """
    try:
        from huggingface_hub import try_to_load_from_cache

        path = try_to_load_from_cache(hf_id, "config.json")
    except Exception:
        return None
    if not isinstance(path, str):
        return None
    parts = path.replace("\\", "/").split("/")
    if "snapshots" in parts:
        i = parts.index("snapshots")
        if i + 1 < len(parts):
            return parts[i + 1]
    return None


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

    def load(
        self,
        preset_id: str,
        manifest: "PresetManifest",
        on_stage: Optional[Callable[[str, str], None]] = None,
    ) -> LoadedModel:
        """Load a model + SAE synchronously. Raises RuntimeError on failure.

        ``on_stage(event, device)`` is called with ``"cpu_fallback"`` when a
        CUDA out-of-memory error moves the load to the CPU, and with
        ``"model_loaded"`` after the model is resident, before the SAE loads.

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

            # Gated presets need HF_TOKEN in the env. TransformerLens and
            # huggingface_hub read it from there themselves: TL passes
            # token=HF_TOKEN to transformers on its own (a token= kwarg here
            # would collide with it), and SAELens 5.11's SAE.from_pretrained
            # has no token parameter.
            hf_token_for(manifest)

            def notify(event: str) -> None:
                if on_stage is not None:
                    on_stage(event, device)

            def fall_back_to_cpu(what: str, err: Exception) -> None:
                # A GPU smaller than the preset's estimate can still get a
                # CpuOk verdict, so an OOM on CUDA retries on the CPU.
                nonlocal device
                logger.warning(
                    "CUDA out of memory loading %s for %r (%s); retrying on CPU",
                    what, preset_id, err,
                )
                gc.collect()
                torch.cuda.empty_cache()
                device = "cpu"
                notify("cpu_fallback")

            def load_model(on: str):
                m = HookedTransformer.from_pretrained(
                    manifest.model.tl_name,
                    device=on,
                    **({"dtype": manifest.model.dtype} if manifest.model.dtype else {}),
                )
                m.cfg.use_attn_result = True
                return m

            try:
                try:
                    model = load_model(device)
                except torch.cuda.OutOfMemoryError as e:
                    if device != "cuda":
                        raise
                    fall_back_to_cpu("model", e)
                    model = load_model(device)
            except Exception as e:
                raise RuntimeError(f"failed to load model {manifest.model.tl_name}: {e}") from e
            notify("model_loaded")

            sae_id = manifest.sae_id(sae_layer)

            def load_sae(on: str):
                sae_result = SAE.from_pretrained(
                    release=manifest.sae.release,
                    sae_id=sae_id,
                    device=on,
                )
                # sae_lens.SAE.from_pretrained returns a tuple in some versions
                # (sae, cfg_dict, sparsity). Normalize to the SAE object.
                return sae_result[0] if isinstance(sae_result, tuple) else sae_result

            try:
                try:
                    sae = load_sae(device)
                except torch.cuda.OutOfMemoryError as e:
                    if device != "cuda":
                        raise
                    model = model.to("cpu")  # keep model and SAE on one device
                    fall_back_to_cpu("SAE", e)
                    sae = load_sae(device)
            except Exception as e:
                del model
                gc.collect()
                if device == "cuda":
                    torch.cuda.empty_cache()
                raise RuntimeError(f"failed to load SAE {manifest.sae.release}@{sae_id}: {e}") from e

            loaded = LoadedModel(
                preset_id=preset_id,
                model=model,
                sae=sae,
                sae_layer=sae_layer,
                device=device,
                model_revision=resolve_model_revision(manifest.model.hf_id),
                sae_release=manifest.sae.release,
                sae_id=sae_id,
            )
            self._loaded[preset_id] = loaded
            self._last_loaded = preset_id
            return loaded

    # -- custom models (T32) -------------------------------------------------
    # Kept apart from load() on purpose: no manifest, no SAE, no license gate.

    def load_custom(
        self,
        preset_id: str,
        tl_name: str,
        on_stage: Optional[Callable[[str, str], None]] = None,
    ) -> LoadedModel:
        """Load a user-added model (``custom:<hf_id>``) without an SAE.

        Same per-id lock, CUDA-OOM CPU fallback and ``on_stage`` events as
        ``load()``. Passes the user's HF token (if any) so gated repos the
        user has accepted can download.
        """
        if preset_id in self._loaded:
            return self._loaded[preset_id]

        lock = self._get_lock(preset_id)
        with lock:
            if preset_id in self._loaded:
                return self._loaded[preset_id]
            try:
                import torch
                from transformer_lens import HookedTransformer
            except ImportError as e:
                raise RuntimeError(f"required ML deps not available: {e}") from e

            device = "cuda" if torch.cuda.is_available() else "cpu"

            def load_model(on: str):
                # No token= here: TransformerLens passes token=HF_TOKEN to
                # transformers itself, and a second one is a TypeError.
                m = HookedTransformer.from_pretrained(tl_name, device=on)
                m.cfg.use_attn_result = True
                return m

            try:
                try:
                    model = load_model(device)
                except torch.cuda.OutOfMemoryError as e:
                    if device != "cuda":
                        raise
                    logger.warning(
                        "CUDA out of memory loading custom model %r (%s); retrying on CPU",
                        tl_name, e,
                    )
                    gc.collect()
                    torch.cuda.empty_cache()
                    device = "cpu"
                    if on_stage is not None:
                        on_stage("cpu_fallback", device)
                    model = load_model(device)
            except Exception as e:
                raise RuntimeError(f"failed to load model {tl_name}: {e}") from e
            if on_stage is not None:
                on_stage("model_loaded", device)

            hf_id = preset_id.split(":", 1)[1] if preset_id.startswith("custom:") else tl_name
            loaded = LoadedModel(
                preset_id=preset_id, model=model, sae=None, sae_layer=None, device=device,
                model_revision=resolve_model_revision(hf_id),
            )
            self._loaded[preset_id] = loaded
            self._last_loaded = preset_id
            return loaded

    def swap_sae(self, preset_id: str, layer: int, manifest: "PresetManifest") -> LoadedModel:
        """Load the SAE for ``layer`` and swap it in. Model stays resident.

        Updates loaded.sae, loaded.sae_layer. On failure the old SAE and layer
        stay in place, so the engine keeps working at the old layer. If the
        old SAE can't be put back either, the preset is dropped from the
        registry so the next ``/load`` starts clean.

        IMPORTANT: This method does NOT acquire the per-preset lock itself.
        Caller (run_sae_features) must hold the lock for the entire operation
        (swap + forward pass + SAE encode) to prevent race conditions with
        concurrent /generate requests.
        """
        loaded = self._loaded.get(preset_id)
        if loaded is None:
            raise RuntimeError(f"preset {preset_id!r} not loaded")

        import torch
        from sae_lens import SAE

        sae_id = manifest.sae_id(layer)
        old_sae = loaded.sae
        old_layer = loaded.sae_layer

        def load_new():
            if _fault_sae_swap_enabled():
                raise RuntimeError("PRY_FAULT_SAE_SWAP: injected SAE swap failure (dev only)")
            sae_result = SAE.from_pretrained(
                release=manifest.sae.release,
                sae_id=sae_id,
                device=loaded.device,
            )
            return sae_result[0] if isinstance(sae_result, tuple) else sae_result

        try:
            try:
                # Load the new SAE first, so the old one is still there if this fails.
                sae = load_new()
            except torch.cuda.OutOfMemoryError:
                if old_sae is None or loaded.device != "cuda":
                    raise
                # No room for both: park the old SAE on the CPU and retry.
                loaded.sae = None
                old_sae.to("cpu")
                gc.collect()
                torch.cuda.empty_cache()
                sae = load_new()
        except Exception as e:
            # Put the old SAE and layer back so the engine keeps working.
            try:
                if old_sae is not None and loaded.sae is None:
                    old_sae.to(loaded.device)
                loaded.sae = old_sae
                loaded.sae_layer = old_layer
            except Exception as restore_err:
                logger.error(
                    "could not restore the layer-%s SAE for %r (%s); dropping the preset",
                    old_layer, preset_id, restore_err,
                )
                with self._meta_lock:
                    self._loaded.pop(preset_id, None)
                    if self._last_loaded == preset_id:
                        self._last_loaded = next(iter(self._loaded), None)
                loaded.model = None
                loaded.sae = None
            raise RuntimeError(f"failed to load SAE {manifest.sae.release}@{sae_id}: {e}") from e

        loaded.sae = sae
        loaded.sae_layer = layer
        loaded.sae_release = manifest.sae.release
        loaded.sae_id = sae_id
        del old_sae
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
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
