"""T20 induction-heads demo: POST /head-scores."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient

from pry_sidecar import main
from pry_sidecar.registry import ModelRegistry
from pry_sidecar.schemas import HeadScoresRequest

# GPT-2 small's known induction heads (layer.head), from the induction-heads
# literature (Olsson et al. 2022; ARENA / TransformerLens demos).
GPT2_INDUCTION_HEADS = {(5, 1), (5, 5), (6, 9), (7, 2), (7, 10)}


@pytest.mark.inference
def test_gpt2_induction_heads(gpt2_loaded):
    from pry_sidecar.inference import run_head_scores

    resp = run_head_scores(HeadScoresRequest(preset_id="gpt2-small"), gpt2_loaded)

    top8 = {(s.layer, s.head) for s in resp.top_induction[:8]}
    assert len(top8 & GPT2_INDUCTION_HEADS) >= 3, resp.top_induction

    # 4.11 is GPT-2 small's well-known previous-token head.
    assert (resp.top_previous_token[0].layer, resp.top_previous_token[0].head) == (4, 11)

    assert (resp.n_layers, resp.n_heads) == (12, 12)
    assert len(resp.scores) == 144
    assert all(0.0 <= s.induction <= 1.0 and 0.0 <= s.previous_token <= 1.0 for s in resp.scores)
    inductions = [s.induction for s in resp.top_induction]
    assert inductions == sorted(inductions, reverse=True)

    # The test sequence is shown in the UI: 25 tokens, then the same 25 again.
    seq = resp.sequence_tokens
    assert resp.repeat_len == 25 and len(seq) == 50
    assert seq[:25] == seq[25:]


@pytest.mark.inference
def test_head_scores_deterministic(gpt2_loaded):
    from pry_sidecar.inference import run_head_scores

    req = HeadScoresRequest(preset_id="gpt2-small")
    a = run_head_scores(req, gpt2_loaded)
    b = run_head_scores(req, gpt2_loaded)
    assert a.sequence_tokens == b.sequence_tokens
    assert [(s.layer, s.head) for s in a.top_induction] == [(s.layer, s.head) for s in b.top_induction]


@pytest.mark.inference
def test_pythia_head_scores_shape(pythia_loaded):
    from pry_sidecar.inference import run_head_scores

    resp = run_head_scores(HeadScoresRequest(preset_id="pythia-70m", top_k=5), pythia_loaded)
    assert (resp.n_layers, resp.n_heads) == (6, 8)
    assert len(resp.scores) == 48
    assert len(resp.top_induction) == 5
    # A 6-layer model still forms induction heads: the best one is clear.
    assert resp.top_induction[0].induction > 0.5


@pytest.mark.inference
def test_head_scores_endpoint(gpt2_client):
    r = gpt2_client.post("/head-scores", json={"preset_id": "gpt2-small", "top_k": 3})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["top_induction"]) == 3
    assert body["previous_token_source"] == "repeated_sequence"

    r = gpt2_client.post(
        "/head-scores", json={"preset_id": "gpt2-small", "prompt": "The cat sat on the mat."}
    )
    assert r.status_code == 200, r.text
    assert r.json()["previous_token_source"] == "prompt"

    # BOS + one token has no word pair after the first word.
    r = gpt2_client.post("/head-scores", json={"preset_id": "gpt2-small", "prompt": "Hi"})
    assert r.status_code == 400
    assert "too short" in r.json()["error"]


# ---------------------------------------------------------------------------
# Fast checks (no model weights)
# ---------------------------------------------------------------------------


def test_head_scores_request_validation():
    assert HeadScoresRequest().top_k == 8
    assert HeadScoresRequest().prompt is None
    with pytest.raises(ValidationError):
        HeadScoresRequest(top_k=0)
    with pytest.raises(ValidationError):
        HeadScoresRequest(top_k=65)
    with pytest.raises(ValidationError):
        HeadScoresRequest(prompt="x" * 4001)


def test_head_scores_endpoint_errors(monkeypatch):
    monkeypatch.delenv("PRY_TOKEN", raising=False)
    monkeypatch.setattr(main, "REGISTRY", ModelRegistry())
    with TestClient(main.app) as c:
        r = c.post("/head-scores", json={"preset_id": "nope"})
        assert r.status_code == 400 and "Unknown preset" in r.json()["error"]

        r = c.post("/head-scores", json={"preset_id": "gpt2-small"})
        assert r.status_code == 409 and "not loaded" in r.json()["error"]

        r = c.post("/head-scores", json={"preset_id": "gpt2-small", "top_k": 0})
        assert r.status_code == 400 and r.json()["error"] == "validation_error"
