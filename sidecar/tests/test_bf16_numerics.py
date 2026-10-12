"""Gemma 2 2B loads in bfloat16. Its DLA, Key parts and patching must run and
agree with float32 (stand-in: GPT-2 small loaded in bf16)."""

from __future__ import annotations

import pytest

IOI_CLEAN = "When Mary and John went to the store, John gave a drink to"
IOI_CHANGED = "When Mary and John went to the store, Mary gave a drink to"
BF16_ID = "gpt2-small-bf16-test"


@pytest.fixture(scope="module")
def gpt2_bf16(gpt2_loaded):
    from pry_sidecar.presets import PRESETS
    from pry_sidecar.registry import REGISTRY

    manifest = PRESETS["gpt2-small"].model_copy(deep=True)
    manifest.model.dtype = "bfloat16"
    loaded = REGISTRY.load(BF16_ID, manifest)
    yield loaded
    REGISTRY.unload(BF16_ID)


@pytest.mark.inference
def test_bf16_dla_circuit_and_patching_match_fp32(gpt2_loaded, gpt2_bf16):
    import torch
    from pry_sidecar.inference import run_circuit, run_dla, run_patching
    from pry_sidecar.schemas import CircuitRequest, DLARequest, PatchRequest

    assert gpt2_bf16.model.cfg.dtype == torch.bfloat16

    def dla(loaded):
        r = run_dla(DLARequest(preset_id="gpt2-small", prompt=IOI_CLEAN), loaded)
        return {(c.layer, c.head): c.contribution for c in r.components}

    full, half = dla(gpt2_loaded), dla(gpt2_bf16)
    top = sorted(full, key=lambda k: abs(full[k]), reverse=True)[:5]
    for k in top:
        assert half[k] == pytest.approx(full[k], rel=0.1, abs=0.1), k

    circ = run_circuit(CircuitRequest(preset_id="gpt2-small", prompt=IOI_CLEAN), gpt2_bf16)
    assert circ.nodes and circ.edges_method == "direct_value_path"

    def patch(loaded):
        r = run_patching(
            PatchRequest(preset_id="gpt2-small", clean_prompt=IOI_CLEAN,
                         corrupted_prompt=IOI_CHANGED, patch_type="mlp"),
            loaded,
        )
        return {c.layer: c.effect for c in r.components}, r.components[0]

    pf, c32 = patch(gpt2_loaded)
    ph, c16 = patch(gpt2_bf16)
    gap = c32.clean_logit - c32.corrupted_logit
    assert c16.clean_logit - c16.corrupted_logit == pytest.approx(gap, abs=0.15 * abs(gap))
    for layer, effect in pf.items():
        assert ph[layer] == pytest.approx(effect, abs=0.15 * abs(gap)), layer


@pytest.mark.inference
def test_fp32_logit_helper_equals_model_logit(gpt2_loaded):
    """For a float32 model the helper's logit is the model's own logit."""
    import torch
    from pry_sidecar.inference import _forward_with_fp32_logit

    m = gpt2_loaded.model
    tok = m.to_tokens(IOI_CLEAN)
    t = tok.shape[1] - 1
    with torch.no_grad():
        logits, value = _forward_with_fp32_logit(m, tok, t, 1234)
    assert value == pytest.approx(float(logits[0, t, 1234]), abs=1e-3)
