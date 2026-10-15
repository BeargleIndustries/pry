"""MF-1: /generate's top-10 predictions carry the logit beside the probability."""

from __future__ import annotations

import math

import pytest


@pytest.mark.inference
def test_top_predictions_carry_logit_and_softmax_matches_prob(gpt2_client, gpt2_loaded):
    import torch

    prompt = "The capital of France is"
    r = gpt2_client.post("/generate", json={"preset_id": "gpt2-small", "prompt": prompt})
    assert r.status_code == 200, r.text
    preds = r.json()["top_predictions"]
    assert len(preds) == 10
    assert all(isinstance(p["logit"], float) for p in preds)

    model = gpt2_loaded.model
    with torch.no_grad():
        logits = model(model.to_tokens(prompt))[0, -1].float()
    log_z = float(torch.logsumexp(logits, dim=-1))
    for p in preds:
        tid = model.to_single_token(p["token"])
        assert p["logit"] == pytest.approx(float(logits[tid]), abs=1e-4)
        # probability = softmax(logits)[token] = exp(logit - logsumexp(logits))
        assert p["probability"] == pytest.approx(math.exp(p["logit"] - log_z), rel=1e-4)
    # Logits order the list the same way the probabilities do.
    assert [p["logit"] for p in preds] == sorted((p["logit"] for p in preds), reverse=True)
