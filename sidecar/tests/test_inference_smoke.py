"""Smoke tests: real gpt2-small inference on CPU. Run with ``pytest -m inference``."""

from __future__ import annotations

import pytest

from pry_sidecar.schemas import GenerateRequest

pytestmark = pytest.mark.inference


def test_run_generate_smoke(gpt2_loaded, no_neuronpedia):
    from pry_sidecar.inference import run_generate

    req = GenerateRequest(preset_id="gpt2-small", prompt="The capital of France is", top_k_features=5)
    resp = run_generate(req, gpt2_loaded)

    # TransformerLens prepends BOS.
    assert [t.text for t in resp.tokens] == ["<|endoftext|>", "The", " capital", " of", " France", " is"]
    assert len(resp.attention) == 12
    assert len(resp.attention[0].heads) == 12
    assert len(resp.attention[0].heads[0]) == 6
    assert not resp.attention_truncated

    assert len(resp.top_predictions) == 10
    assert [p.rank for p in resp.top_predictions] == list(range(1, 11))
    probs = [p.probability for p in resp.top_predictions]
    assert probs == sorted(probs, reverse=True)
    assert 0 < sum(probs) <= 1.0

    assert resp.sae_layer_used == gpt2_loaded.sae_layer
    assert len(resp.sae_features) == 6
    assert [f.token_index for f in resp.sae_features] == list(range(6))
    assert all(len(f.top_k) <= 5 for f in resp.sae_features)
    assert any(f.top_k for f in resp.sae_features)


def test_generate_endpoint(gpt2_client):
    r = gpt2_client.post("/generate", json={"preset_id": "gpt2-small", "prompt": "Hello world"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["tokens"]) == 3
    assert len(body["attention"]) == 12
