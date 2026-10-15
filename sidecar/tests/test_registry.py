"""ModelRegistry.swap_sae failure handling (code:D1).

A failed SAE layer switch must leave the engine on the old SAE and layer,
not half-loaded with ``sae=None``.
"""

from __future__ import annotations

import pytest

def _boom(*_a, **_k):
    raise OSError("simulated: SAE not cached and offline")


@pytest.mark.inference
def test_swap_sae_failure_restores_previous_sae(gpt2_client, gpt2_loaded, monkeypatch):
    import sae_lens

    old_sae = gpt2_loaded.sae
    old_layer = gpt2_loaded.sae_layer
    other = 6 if old_layer != 6 else 7
    monkeypatch.setattr(sae_lens.SAE, "from_pretrained", _boom)

    r = gpt2_client.post(
        "/sae-features",
        json={"preset_id": "gpt2-small", "prompt": "Hi", "sae_layer": other},
    )
    assert r.status_code >= 400

    assert gpt2_loaded.sae is not None
    assert gpt2_loaded.sae is old_sae
    assert gpt2_loaded.sae_layer == old_layer

    g = gpt2_client.post("/generate", json={"preset_id": "gpt2-small", "prompt": "Hello world"})
    assert g.status_code == 200, g.text


@pytest.mark.inference
def test_model_revision_reported(gpt2_client, gpt2_loaded):
    """MF-5: the resolved snapshot hash and the SAE ride on load and generate."""
    import json
    import re

    from huggingface_hub import try_to_load_from_cache

    rev = gpt2_loaded.model_revision
    assert isinstance(rev, str) and re.fullmatch(r"[0-9a-f]{40}", rev), rev
    # It is the snapshot the weights were read from.
    assert f"snapshots/{rev}/" in try_to_load_from_cache("gpt2", "config.json").replace("\\", "/")

    g = gpt2_client.post("/generate", json={"preset_id": "gpt2-small", "prompt": "Hello world"})
    assert g.status_code == 200, g.text
    body = g.json()
    assert body["model_revision"] == rev
    assert body["sae"] == {
        "release": "gpt2-small-res-jb",
        "id": f"blocks.{gpt2_loaded.sae_layer}.hook_resid_pre",
    }

    # /load on an already-loaded preset answers at once, with the same provenance.
    r = gpt2_client.post("/load", json={"preset_id": "gpt2-small"})
    events = [json.loads(x[len("data: "):]) for x in r.text.splitlines() if x.startswith("data: ")]
    assert events[-1]["stage"] == "already_loaded"
    assert events[-1]["model_revision"] == rev
    assert events[-1]["sae"] == body["sae"]


def test_fault_hook_requires_pry_dev(monkeypatch):
    from pry_sidecar.registry import _fault_sae_swap_enabled

    monkeypatch.delenv("PRY_DEV", raising=False)
    monkeypatch.setenv("PRY_FAULT_SAE_SWAP", "1")
    assert _fault_sae_swap_enabled() is False

    monkeypatch.setenv("PRY_DEV", "1")
    assert _fault_sae_swap_enabled() is True

    monkeypatch.delenv("PRY_FAULT_SAE_SWAP")
    assert _fault_sae_swap_enabled() is False


@pytest.mark.inference
def test_fault_hook_fails_swap_and_keeps_old_sae(gpt2_loaded, monkeypatch):
    from pry_sidecar.presets import PRESETS
    from pry_sidecar.registry import REGISTRY

    monkeypatch.setenv("PRY_DEV", "1")
    monkeypatch.setenv("PRY_FAULT_SAE_SWAP", "1")
    old_sae, old_layer = gpt2_loaded.sae, gpt2_loaded.sae_layer
    with pytest.raises(RuntimeError, match="PRY_FAULT_SAE_SWAP"):
        REGISTRY.swap_sae("gpt2-small", 6 if old_layer != 6 else 7, PRESETS["gpt2-small"])
    assert gpt2_loaded.sae is old_sae
    assert gpt2_loaded.sae_layer == old_layer


class _StuckSae:
    """An SAE that can go to the CPU but can't come back to the GPU."""

    def to(self, device):
        if device != "cpu":
            raise RuntimeError("simulated: no VRAM to restore the old SAE")
        return self


def test_swap_sae_drops_preset_when_restore_fails(monkeypatch):
    import sae_lens
    import torch

    from pry_sidecar.presets import PRESETS
    from pry_sidecar.registry import LoadedModel, ModelRegistry

    def oom(*_a, **_k):
        raise torch.cuda.OutOfMemoryError("simulated OOM")

    monkeypatch.setattr(sae_lens.SAE, "from_pretrained", oom)
    monkeypatch.setattr(torch.cuda, "empty_cache", lambda: None)
    reg = ModelRegistry()
    reg._loaded["gpt2-small"] = LoadedModel("gpt2-small", object(), _StuckSae(), 8, "cuda")
    reg._last_loaded = "gpt2-small"

    with pytest.raises(RuntimeError, match="failed to load SAE"):
        reg.swap_sae("gpt2-small", 6, PRESETS["gpt2-small"])

    assert reg.get("gpt2-small") is None
    assert reg.last_loaded is None
