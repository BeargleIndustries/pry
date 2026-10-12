"""code:A1: DLA on post-norm models (Gemma 2's ln1_post) is in logits.

Gemma 2 sends the summed head output through ``ln1_post`` (a weighted
RMSNorm) before the residual stream. Per-head DLA must map each head's
output through ``x * w_ln1_post / scale`` (scale frozen from the clean run),
or the bars don't add up to the logit.
"""

from __future__ import annotations

import pytest
import torch

from tests.tiny_models import dla_bias, loaded_for, tiny_model


@pytest.mark.parametrize("post_norm", [True, False], ids=["post_ln", "no_post_ln"])
def test_dla_sums_to_logit_with_post_ln(post_norm):
    from pry_sidecar.inference import run_dla
    from pry_sidecar.schemas import DLARequest

    model = tiny_model(post_norm=post_norm)
    loaded = loaded_for(model)
    for t in (len(model.to_str_tokens("")) - 1, 2):
        resp = run_dla(DLARequest(preset_id="tiny", prompt="x", target_token_index=t), loaded)

        with torch.no_grad():
            logits, cache = model.run_with_cache(model.to_tokens(""))
        pred = int(logits[0, t].argmax())
        assert resp.predicted_token == f"t{pred}"

        total = sum(c.contribution for c in resp.components) + dla_bias(model, cache, pred, t)
        assert total == pytest.approx(float(logits[0, t, pred]), abs=1e-3)
