"""MF-2 / MF-2b: DLA answer and contrast tokens, and the total / real logit / gap.

The bars are each head's and MLP's direct push on the answer logit (or on the
answer - contrast difference). What no bar is drawn for is the gap: the
embeddings' own direct path plus the bias terms. On a model without an output
soft cap, bars_total + embedding_direct + biases is exactly the real logit.
"""

from __future__ import annotations

import pytest
import torch

from tests.tiny_models import TOKENS, loaded_for, tiny_model


def _tiny(post_norm: bool):
    """Tiny model whose vocabulary is t0..t10: ``to_tokens("t3", prepend_bos=False)``
    is [[3]]; "t3 t4" is two tokens. The prompt is always TOKENS."""
    model = tiny_model(post_norm=post_norm)
    prompt = torch.tensor([TOKENS])

    def to_tokens(text, prepend_bos=True, *a, **k):
        if prepend_bos:
            return prompt
        return torch.tensor([[int(w[1:]) for w in text.split()]])

    model.to_tokens = to_tokens
    return model


def _logits(model):
    with torch.no_grad():
        return model(torch.tensor([TOKENS]))[0, -1].float()


def _run(model, **kw):
    from pry_sidecar.inference import run_dla
    from pry_sidecar.schemas import DLARequest

    return run_dla(DLARequest(preset_id="tiny", prompt="x", **kw), loaded_for(model))


@pytest.mark.parametrize("post_norm", [True, False], ids=["post_ln", "no_post_ln"])
def test_answer_token_changes_the_target(post_norm):
    model = _tiny(post_norm)
    logits = _logits(model)
    pred = int(logits.argmax())
    other = (pred + 1) % 11

    default = _run(model)
    chosen = _run(model, answer_token=f"t{other}")

    assert default.answer_token == f"t{pred}" == default.predicted_token
    assert chosen.answer_token == f"t{other}"
    assert chosen.predicted_token == f"t{pred}"  # the top guess is still reported
    assert chosen.answer_logit == pytest.approx(float(logits[other]), abs=1e-6)
    assert chosen.contrast_token is None and chosen.contrast_logit is None
    a = {c.name: c.contribution for c in default.components}
    b = {c.name: c.contribution for c in chosen.components}
    assert any(abs(a[k] - b[k]) > 1e-6 for k in a)


@pytest.mark.parametrize("post_norm", [True, False], ids=["post_ln", "no_post_ln"])
def test_contrast_sums_to_logit_difference(post_norm):
    model = _tiny(post_norm)
    logits = _logits(model)
    resp = _run(model, answer_token="t2", contrast_token="t5")

    diff = float(logits[2] - logits[5])
    total = sum(c.contribution for c in resp.components)
    assert total == pytest.approx(resp.bars_total, abs=1e-9)
    parts = resp.gap_parts["embedding_direct"] + resp.gap_parts["biases"]
    assert total + parts == pytest.approx(diff, abs=1e-3)


def test_actual_equals_answer_logit_minus_contrast_logit():
    model = _tiny(post_norm=False)
    logits = _logits(model)
    resp = _run(model, answer_token="t2", contrast_token="t5")

    assert resp.answer_token == "t2" and resp.contrast_token == "t5"
    assert resp.answer_logit == pytest.approx(float(logits[2]), abs=1e-6)
    assert resp.contrast_logit == pytest.approx(float(logits[5]), abs=1e-6)
    assert resp.actual == pytest.approx(resp.answer_logit - resp.contrast_logit, abs=1e-12)
    assert resp.gap == pytest.approx(resp.actual - resp.bars_total, abs=1e-12)


@pytest.mark.parametrize("post_norm", [True, False], ids=["post_ln", "no_post_ln"])
def test_bars_total_plus_gap_parts_equals_actual(post_norm):
    model = _tiny(post_norm)
    logits = _logits(model)
    resp = _run(model)

    assert resp.actual == pytest.approx(float(logits.max()), abs=1e-6)
    assert set(resp.gap_parts) == {"embedding_direct", "biases"}
    total = resp.bars_total + resp.gap_parts["embedding_direct"] + resp.gap_parts["biases"]
    assert total == pytest.approx(resp.actual, abs=1e-3)
    assert resp.gap == pytest.approx(
        resp.gap_parts["embedding_direct"] + resp.gap_parts["biases"], abs=1e-3
    )


def test_multi_token_answer_is_unprocessable():
    from pry_sidecar.inference import UnprocessableError

    model = _tiny(post_norm=False)
    with pytest.raises(UnprocessableError):
        _run(model, answer_token="t1 t2")
    with pytest.raises(UnprocessableError):
        _run(model, contrast_token="t1 t2")


@pytest.mark.inference
def test_multi_token_answer_is_a_422(gpt2_client):
    base = {"preset_id": "gpt2-small", "prompt": "The capital of France is"}
    r = gpt2_client.post("/dla", json={**base, "answer_token": " Paris is"})
    assert r.status_code == 422, r.text
    r = gpt2_client.post("/dla", json={**base, "answer_token": " Paris", "contrast_token": ""})
    assert r.status_code == 422, r.text

    r = gpt2_client.post("/dla", json={**base, "answer_token": " Paris", "contrast_token": " London"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer_token"] == " Paris" and body["contrast_token"] == " London"
    assert body["actual"] == pytest.approx(body["answer_logit"] - body["contrast_logit"], abs=1e-4)
    # GPT-2 has no output soft cap, so the gap is exactly its two parts.
    parts = body["gap_parts"]["embedding_direct"] + body["gap_parts"]["biases"]
    assert body["gap"] == pytest.approx(parts, abs=1e-3)
