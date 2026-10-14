"""TN-1: POST /embedding reads hook_embed and hook_pos_embed per position."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.inference


def _embed(client, prompt, positions):
    return client.post(
        "/embedding",
        json={"preset_id": "gpt2-small", "prompt": prompt, "positions": positions},
    )


def test_returns_768_plus_768_numbers_per_position(gpt2_client, gpt2_loaded):
    import torch

    prompt = "The bank and the bank"
    r = _embed(gpt2_client, prompt, [0, 2])
    assert r.status_code == 200, r.text
    body = r.json()
    # BOS is prepended, as everywhere else in Pry.
    assert body["tokens"][0] == "<|endoftext|>"
    assert [p["position"] for p in body["positions"]] == [0, 2]
    for p in body["positions"]:
        assert len(p["embed"]) == 768 and len(p["pos_embed"]) == 768
        assert p["token"] == body["tokens"][p["position"]]

    model = gpt2_loaded.model
    toks = model.to_tokens(prompt)
    p2 = body["positions"][1]
    assert torch.allclose(torch.tensor(p2["embed"]), model.W_E[toks[0, 2]].float().cpu(), atol=1e-5)
    assert torch.allclose(torch.tensor(p2["pos_embed"]), model.W_pos[2].float().cpu(), atol=1e-5)


def test_same_token_same_position_gives_identical_embed_and_pos_embed(gpt2_client):
    a = _embed(gpt2_client, "The cat sat", [1]).json()["positions"][0]
    b = _embed(gpt2_client, "The dog ran far", [1]).json()["positions"][0]
    assert a["token"] == b["token"] == "The"
    assert a["embed"] == b["embed"]
    assert a["pos_embed"] == b["pos_embed"]


def test_gpt2_bank_at_5_vs_2_has_identical_embed_different_pos_embed(gpt2_client):
    body = _embed(gpt2_client, "The bank and the bank", [2, 5]).json()
    at2, at5 = body["positions"]
    assert at2["token"] == at5["token"] == " bank"
    assert at2["embed"] == at5["embed"]
    assert at2["pos_embed"] != at5["pos_embed"]


def test_bad_position_is_a_422(gpt2_client):
    for bad in ([6], [-1], [0, 99]):
        r = _embed(gpt2_client, "The bank and the bank", bad)
        assert r.status_code == 422, (bad, r.text)
        assert "out of range" in r.json()["error"]
