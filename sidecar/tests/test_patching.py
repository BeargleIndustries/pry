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
