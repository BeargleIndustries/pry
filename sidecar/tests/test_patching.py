"""Residual patching is per (layer, position), so it shows where information sits."""

from __future__ import annotations

import pytest

IOI_CLEAN = "When Mary and John went to the store, John gave a drink to"
IOI_CHANGED = "When Mary and John went to the store, Mary gave a drink to"


@pytest.mark.inference
def test_resid_patching_is_per_position(gpt2_client):
    r = gpt2_client.post(
        "/patch",
        json={
            "preset_id": "gpt2-small",
            "clean_prompt": IOI_CLEAN,
            "corrupted_prompt": IOI_CHANGED,
            "patch_type": "resid",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    tokens = body["tokens"]
    comps = body["components"]
    assert len(comps) == 12 * len(tokens)
    assert all(c["position"] is not None for c in comps)

    # The prompts first differ at the second-sentence name.
    diff_pos = next(i for i, t in enumerate(tokens) if i > 5 and t in (" John", " Mary"))
    effect = {(c["layer"], c["position"]): c["effect"] for c in comps}

    # Before that word the two runs are identical, so swapping changes nothing.
    for (layer, pos), e in effect.items():
        if pos < diff_pos:
            assert abs(e) < 1e-4, (layer, pos, e)

    # In layer 0 the changed name itself carries the answer back...
    total = comps[0]["clean_logit"] - comps[0]["corrupted_logit"]
    assert total > 1.0
    assert effect[(0, diff_pos)] > 0.5 * total
    # ...and by the last layer it has moved to the final position.
    last = len(tokens) - 1
    assert effect[(11, last)] > 0.5 * total
    assert abs(effect[(11, diff_pos)]) < 0.2 * total


@pytest.mark.inference
def test_resid_patching_is_capped(gpt2_client):
    # Differ at the start of a long prompt: 12 layers x ~80 positions > the cap.
    tail = " and then they walked home" * 12
    r = gpt2_client.post(
        "/patch",
        json={
            "preset_id": "gpt2-small",
            "clean_prompt": "Mary" + tail,
            "corrupted_prompt": "John" + tail,
            "patch_type": "resid",
        },
    )
    assert r.status_code == 400
    assert "model runs" in r.json()["error"]


# ---------------------------------------------------------------------------
# MF-3: the Swap test's three logits and the share derived from them
# ---------------------------------------------------------------------------


def _patch(client, clean, corrupted, patch_type):
    r = client.post(
        "/patch",
        json={
            "preset_id": "gpt2-small",
            "clean_prompt": clean,
            "corrupted_prompt": corrupted,
            "patch_type": patch_type,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.inference
def test_clean_corrupted_and_patched_logits_reported(gpt2_client):
    body = _patch(gpt2_client, IOI_CLEAN, IOI_CHANGED, "mlp")
    assert body["target_token"] == body["clean_predicted_token"]
    clean, corrupted = body["clean_logit"], body["corrupted_logit"]
    assert clean - corrupted > 1.0
    assert len(body["components"]) == 12
    for c in body["components"]:
        assert c["clean_logit"] == clean and c["corrupted_logit"] == corrupted
        assert c["effect"] == pytest.approx(c["patched_logit"] - corrupted, abs=1e-6)
        assert c["share"] == pytest.approx((c["patched_logit"] - corrupted) / (clean - corrupted), abs=1e-9)


@pytest.mark.inference
def test_share_is_one_at_the_clean_run(gpt2_client):
    # Swapping layer 0's residual input at the one differing word turns the
    # changed run into the original run: the logit comes back exactly.
    body = _patch(gpt2_client, IOI_CLEAN, IOI_CHANGED, "resid")
    diff_pos = next(i for i, t in enumerate(body["tokens"]) if i > 5 and t in (" John", " Mary"))
    cell = next(c for c in body["components"] if c["layer"] == 0 and c["position"] == diff_pos)
    assert cell["patched_logit"] == pytest.approx(body["clean_logit"], abs=1e-4)
    assert cell["share"] == pytest.approx(1.0, abs=1e-4)


def test_share_null_under_a_0_1_gap():
    from pry_sidecar.inference import SHARE_MIN_GAP, patch_share

    assert SHARE_MIN_GAP == 0.1
    assert patch_share(10.0, 9.95, 9.97) is None
    assert patch_share(10.0, 10.0, 10.0) is None
    assert patch_share(10.0, 9.8, 10.0) == pytest.approx(1.0)
    assert patch_share(12.0, 10.0, 11.0) == pytest.approx(0.5)
    assert patch_share(12.0, 10.0, 9.0) == pytest.approx(-0.5)  # moved away
    assert patch_share(12.0, 10.0, 13.0) == pytest.approx(1.5)  # overshot


@pytest.mark.inference
def test_share_null_when_prompts_give_the_same_logit(gpt2_client):
    body = _patch(gpt2_client, IOI_CLEAN, IOI_CLEAN, "mlp")
    assert body["clean_logit"] == pytest.approx(body["corrupted_logit"], abs=1e-5)
    assert all(c["share"] is None for c in body["components"])
