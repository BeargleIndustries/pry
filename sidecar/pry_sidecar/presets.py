"""Load and expose the preset manifest from presets.json.

PRESETS is a dict keyed by preset id (e.g. "gpt2-small").
Loaded once at import time; the file is small enough to keep in memory.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field


class ModelSpec(BaseModel):
    hf_id: str
    size_mb: int
    tl_name: str


class SAESpec(BaseModel):
    source: str
    release: str
    hook: str = "hook_resid_pre"
    layer: int
    size_mb: int


class PresetDisplay(BaseModel):
    """User-facing preset metadata (contract §1). The UI and Rust lanes
    read this block instead of keeping their own per-preset maps."""

    name: str
    blurb: str
    params: str
    size_label: str
    n_layers: int
    n_heads: int
    # Neuronpedia coverage; both null when the preset has none.
    neuronpedia_model_id: Optional[str] = None
    neuronpedia_release_suffix: Optional[str] = None
    recommended: bool = False


class PresetManifest(BaseModel):
    id: str
    model: ModelSpec
    sae: SAESpec
    total_download_mb: int
    vram_estimate_mb: int
    license_gate: Optional[str] = None
    tier: str
    enabled: bool = True
    enabled_comment: Optional[str] = Field(default=None)
    display: PresetDisplay
    cpu_ok: bool = False  # small enough to run on CPU (T11)

    @property
    def available_sae_layers(self) -> list[int]:
        """Layers with SAE checkpoints available for this preset's release."""
        # Hard-coded per known release. SAELens doesn't expose a catalog API.
        _LAYER_CATALOG: dict[str, list[int]] = {
            "gpt2-small-res-jb": list(range(12)),       # 0-11
            "pythia-70m-deduped-res-sm": list(range(6)), # blocks.0-5.hook_resid_post
            "gemma-scope-2b-pt-res": [12],               # only configured layer
            "gemma-scope-9b-pt-res": [20],               # only configured layer
        }
        return _LAYER_CATALOG.get(self.sae.release, [self.sae.layer])

    @property
    def neuronpedia_model_id(self) -> Optional[str]:
        """Neuronpedia model slug from ``display``, or None if no coverage."""
        return self.display.neuronpedia_model_id

    def neuronpedia_release_id(self, sae_layer: int) -> Optional[str]:
        """Neuronpedia SAE-set id ``{layer}-{suffix}`` (e.g. ``8-res-jb``).

        None when the preset has no Neuronpedia coverage, so callers skip the
        fetch instead of producing a bogus id.
        """
        suffix = self.display.neuronpedia_release_suffix
        if self.neuronpedia_model_id is None or suffix is None:
            return None
        return f"{sae_layer}-{suffix}"


def _load_presets() -> dict[str, PresetManifest]:
    # Resolution order (all presets.json candidates tried in order):
    #   1. PRY_PRESETS_PATH env var — explicit override
    #   2. PRY_SIDECAR_DIR env var — Rust setup hook points this at the
    #      Tauri-bundled resource dir which contains presets.json alongside
    #      the sidecar Python sources
    #   3. Path(__file__).parent.parent / "presets.json" — dev/source layout
    #      where the package lives at sidecar/pry_sidecar/ and presets.json at
    #      sidecar/presets.json (one level up from the package)
    #   4. Path(__file__).parent / "presets.json" — fallback for wheel installs
    #      if presets.json ever gets moved INSIDE the package as package_data
    candidates: list[Path] = []
    env_path = os.environ.get("PRY_PRESETS_PATH")
    if env_path:
        candidates.append(Path(env_path))
    sidecar_dir = os.environ.get("PRY_SIDECAR_DIR")
    if sidecar_dir:
        candidates.append(Path(sidecar_dir) / "presets.json")
    candidates.append(Path(__file__).parent.parent / "presets.json")
    candidates.append(Path(__file__).parent / "presets.json")

    presets_path: Path | None = None
    for candidate in candidates:
        if candidate.exists():
            presets_path = candidate
            break
    if presets_path is None:
        tried = "\n  ".join(str(c) for c in candidates)
        raise FileNotFoundError(
            "presets.json not found. Tried:\n  " + tried +
            "\nSet PRY_PRESETS_PATH to the correct location."
        )
    try:
        with presets_path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        return {p["id"]: PresetManifest(**p) for p in raw["presets"]}
    except Exception as exc:
        raise RuntimeError(
            f"Invalid presets.json at {presets_path}: {exc}"
        ) from exc


PRESETS: dict[str, PresetManifest] = _load_presets()
