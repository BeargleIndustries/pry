"""T26 "watch it write": stepwise /generate data on real gpt2-small (CPU)."""

from __future__ import annotations

import pytest

from pry_sidecar.schemas import GenerateRequest

pytestmark = pytest.mark.inference

PROMPT = "The capital of France is"


def _gen(loaded, **kw):
    from pry_sidecar.inference import run_generate

    return run_generate(GenerateRequest(preset_id="gpt2-small", prompt=PROMPT, **kw), loaded)


def test_generate_stepwise_probs(gpt2_loaded, gpt2_client):
    import torch

    model = gpt2_loaded.model

    # -- temperature 0: chosen is the argmax, so chosen >= runner-up --------
    resp = _gen(gpt2_loaded, max_new_tokens=8)
    assert resp.temperature_used == 0.0 and resp.seed_used is None
    assert len(resp.generation_steps) == 8
    ids = model.to_tokens(PROMPT)
    with torch.no_grad():
        for step in resp.generation_steps:
            assert step.runner_up is not None and step.runner_up_probability is not None
            assert step.probability >= step.runner_up_probability
            assert step.token != step.runner_up
            assert step.token_id == int(model(ids)[0, -1].argmax())
            ids = torch.cat([ids, torch.tensor([[step.token_id]])], dim=1)

    # Unchanged `generation` field: identical to the old greedy TL generate.
    with torch.no_grad():
        old = model.generate(PROMPT, max_new_tokens=8, temperature=0.0, verbose=False)
    assert resp.generation == old
    assert resp.generation == PROMPT + "".join(s.token for s in resp.generation_steps)

    # -- seeded sampling at temperature 1 is reproducible -------------------
    a = _gen(gpt2_loaded, max_new_tokens=12, temperature=1.0, seed=7)
    b = _gen(gpt2_loaded, max_new_tokens=12, temperature=1.0, seed=7)
    assert a.seed_used == 7
    assert [s.token_id for s in a.generation_steps] == [s.token_id for s in b.generation_steps]
    assert [s.probability for s in a.generation_steps] == pytest.approx(
        [s.probability for s in b.generation_steps]
    )
    runs = {
        tuple(s.token_id for s in _gen(gpt2_loaded, max_new_tokens=12, temperature=1.0,
                                       seed=seed).generation_steps)
        for seed in (1, 2, 3, 4)
    }
    assert len(runs) > 1, "different seeds should be able to give different text"
    # Runner-up is always the most likely *other* token.
    for s in a.generation_steps:
        assert s.runner_up_probability is not None and s.runner_up != s.token
    # No seed given: one is picked and reported so the run can be replayed.
    c = _gen(gpt2_loaded, max_new_tokens=4, temperature=0.8)
    assert c.seed_used is not None
    d = _gen(gpt2_loaded, max_new_tokens=4, temperature=0.8, seed=c.seed_used)
    assert [s.token_id for s in c.generation_steps] == [s.token_id for s in d.generation_steps]

    # -- bounds enforced at the endpoint ------------------------------------
    base = {"preset_id": "gpt2-small", "prompt": PROMPT}
    for bad in (
        {"max_new_tokens": 257},
        {"max_new_tokens": -1},
        {"temperature": -0.1},
        {"temperature": 2.5},
        {"seed": -1},
    ):
        r = gpt2_client.post("/generate", json={**base, **bad})
        assert r.status_code == 400, bad
    ok = gpt2_client.post("/generate", json={**base, "max_new_tokens": 3})
    assert ok.status_code == 200
    body = ok.json()
    assert len(body["generation_steps"]) == 3
    assert set(body["generation_steps"][0]) == {
        "token", "token_id", "probability", "runner_up", "runner_up_probability"
    }
