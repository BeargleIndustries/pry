"""Logit lens ``track_tokens``: a tracked token's probability, logit and rank
at every layer, last position, so a lesson can follow a token that is not
the layer's top guess (T6a row 50: " basketball" at L5-L7)."""

from __future__ import annotations

import pytest
import torch

from tests.tiny_models import TOKENS, loaded_for, tiny_model


def _tiny():
    """Tiny model whose vocabulary is t0..t10: ``to_tokens("t3", prepend_bos=False)``
    is [[3]]; "t3 t4" is two tokens. The prompt is always TOKENS."""
    model = tiny_model(post_norm=False)
    prompt = torch.tensor([TOKENS])

    def to_tokens(text, prepend_bos=True, *a, **k):
        if prepend_bos:
            return prompt
        return torch.tensor([[int(w[1:]) for w in text.split()]])

    model.to_tokens = to_tokens
    return model


def _layer_probs(model, layer: int) -> torch.Tensor:
    """Softmax of the unembedded resid_post at ``layer``, last position."""
    with torch.no_grad():
        _, cache = model.run_with_cache(torch.tensor([TOKENS]))
        resid = cache[f"blocks.{layer}.hook_resid_post"][0, -1]
        logits = (model.ln_final(resid) @ model.W_U + model.b_U).float()
    return torch.softmax(logits, dim=-1)


def test_tracked_rank_prob_and_top_token():
    from pry_sidecar.inference import run_logit_lens
    from pry_sidecar.schemas import LogitLensRequest

    model = _tiny()
    vocab = [f"t{i}" for i in range(model.cfg.d_vocab)]
    resp = run_logit_lens(
        LogitLensRequest(preset_id="tiny", prompt="x", track_tokens=vocab), loaded_for(model)
    )
    assert resp.tracked is not None and len(resp.tracked) == model.cfg.n_layers
    for layer, readouts in enumerate(resp.tracked):
        probs = _layer_probs(model, layer)
        assert sorted(r.rank for r in readouts.values()) == list(range(1, len(vocab) + 1))
        top = [t for t, r in readouts.items() if r.rank == 1]
        assert top == [resp.grid[layer][-1].predicted_token]
        for text, r in readouts.items():
            assert r.prob == pytest.approx(float(probs[int(text[1:])]), abs=1e-6)


def test_no_track_tokens_means_no_tracked():
    from pry_sidecar.inference import run_logit_lens
    from pry_sidecar.schemas import LogitLensRequest

    resp = run_logit_lens(LogitLensRequest(preset_id="tiny", prompt="x"), loaded_for(_tiny()))
    assert resp.tracked is None


def test_multi_token_track_is_unprocessable():
    from pry_sidecar.inference import UnprocessableError, run_logit_lens
    from pry_sidecar.schemas import LogitLensRequest

    with pytest.raises(UnprocessableError):
        run_logit_lens(
            LogitLensRequest(preset_id="tiny", prompt="x", track_tokens=["t1 t2"]),
            loaded_for(_tiny()),
        )


JORDAN = "Michael Jordan played the sport of"


@pytest.mark.inference
def test_gpt2_basketball_rank_l5_l7(gpt2_client):
    base = {"preset_id": "gpt2-small", "prompt": JORDAN}

    r = gpt2_client.post("/logit-lens", json={**base, "track_tokens": [" basketball game"]})
    assert r.status_code == 422, r.text

    r = gpt2_client.post("/logit-lens", json=base)
    assert r.status_code == 200, r.text
    assert "tracked" not in r.json()

    r = gpt2_client.post("/logit-lens", json={**base, "track_tokens": [" basketball"]})
    assert r.status_code == 200, r.text
    tracked = r.json()["tracked"]
    ranks = {layer: tracked[layer][" basketball"]["rank"] for layer in (5, 6, 7)}
    print(f"gpt2-small ' basketball' rank by layer: {ranks}")
    for rank in ranks.values():
        assert isinstance(rank, int) and rank >= 1
