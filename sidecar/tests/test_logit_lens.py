"""code:A3: the logit lens applies the output soft cap (Gemma 2) like the
real logits do, so its last row matches the Predictions panel."""

from __future__ import annotations

import pytest
import torch

from tests.tiny_models import loaded_for, tiny_model


@pytest.mark.parametrize("soft_cap", [1.0, -1.0], ids=["capped", "no_cap"])
def test_softcap_matches_predictions(soft_cap):
    from pry_sidecar.inference import run_logit_lens
    from pry_sidecar.schemas import LogitLensRequest

    model = tiny_model(post_norm=True, soft_cap=soft_cap)
    resp = run_logit_lens(LogitLensRequest(preset_id="tiny", prompt="x"), loaded_for(model))

    with torch.no_grad():
        logits = model(model.to_tokens(""))
    probs = torch.softmax(logits[0].float(), dim=-1)
    last = resp.grid[-1]
    for pos, cell in enumerate(last):
        pred = int(probs[pos].argmax())
        assert cell.matches_final
        assert cell.predicted_token == f"t{pred}"
        assert cell.probability == pytest.approx(float(probs[pos, pred]), abs=1e-6)
