"""Drift comparison for ranked lists in test_lessons.compare (plan T6a tolerances)."""

from __future__ import annotations

import copy

from tests.test_lessons import compare


def _cells():
    # Patching cells as recorded: L4@13 and L8@13 are a near tie, MLP.9 is far ahead.
    return {
        "components": [
            {"name": "MLP.9", "layer": 9, "position": None, "patched_logit": 25.47, "share": 1.3667},
            {"name": "L4@13", "layer": 4, "position": 13, "patched_logit": 14.959481, "share": -0.0020956},
            {"name": "L8@13", "layer": 8, "position": 13, "patched_logit": 14.959483, "share": -0.0020951},
        ]
    }


def _run(old, new):
    return compare(old, new, {}, "cuda:0", "cpu")


def test_unchanged_list_passes():
    assert _run(_cells(), _cells()) == ([], [])


def test_near_tie_swap_passes():
    old, new = _cells(), _cells()
    c = new["components"]
    c[1], c[2] = c[2], c[1]
    c[1]["share"] += 3e-5  # cross-device noise on top of the swap
    assert _run(old, new) == ([], [])


def test_near_tie_swap_of_top_predictions_ignores_rank():
    old = {"top_predictions": [
        {"token": " a", "probability": 0.3, "rank": 1, "logit": 12.0},
        {"token": " b", "probability": 0.10001, "rank": 2, "logit": 11.0001},
        {"token": " c", "probability": 0.10000, "rank": 3, "logit": 11.0000},
    ]}
    new = copy.deepcopy(old)
    p = new["top_predictions"]
    p[1], p[2] = p[2], p[1]
    p[1]["rank"], p[2]["rank"] = 2, 3
    assert _run(old, new) == ([], [])


def test_non_tie_swap_fails():
    old, new = _cells(), _cells()
    c = new["components"]
    c[0], c[1] = c[1], c[0]
    diffs, _ = _run(old, new)
    assert any("'MLP.9' and 'L4@13' swapped places but are not a near tie" in d for d in diffs), diffs


def test_value_drift_fails():
    old, new = _cells(), _cells()
    new["components"][1]["share"] += 0.03  # beyond the 0.02 share tolerance
    diffs, _ = _run(old, new)
    assert len(diffs) == 1 and diffs[0].startswith("response.components[1].share: ") and diffs[0].endswith("(tolerance 0.02)"), diffs


def test_value_drift_on_a_swapped_item_fails():
    old, new = _cells(), _cells()
    c = new["components"]
    c[1], c[2] = c[2], c[1]
    c[1]["patched_logit"] += 0.2  # L8@13, now first of the pair, moved past 0.05
    diffs, _ = _run(old, new)
    assert any("components[name='L8@13'].patched_logit" in d for d in diffs), diffs


def test_different_item_fails():
    old, new = _cells(), _cells()
    new["components"][2] = {**new["components"][2], "name": "L9@13", "layer": 9}
    diffs, _ = _run(old, new)
    assert "response.components[2].name: 'L8@13' -> 'L9@13'" in diffs
    assert "response.components[2].layer: 8 -> 9" in diffs


def test_layers_stay_exact():
    old, new = _cells(), _cells()
    new["components"][1]["layer"] = 5
    diffs, _ = _run(old, new)
    assert diffs == ["response.components[1].layer: 4 -> 5"]


def test_token_sequences_stay_exact():
    old = {"tokens": [{"index": 0, "text": "a"}, {"index": 1, "text": "b"}]}
    new = {"tokens": [{"index": 0, "text": "b"}, {"index": 1, "text": "a"}]}
    diffs, _ = _run(old, new)
    assert len(diffs) == 2
    steps = {"generation_steps": [{"token": " x", "token_id": 1, "probability": 0.5}, {"token": " y", "token_id": 2, "probability": 0.5}]}
    swapped = copy.deepcopy(steps)
    swapped["generation_steps"].reverse()
    diffs, _ = compare(steps, swapped, {}, "cpu", "cpu")
    assert diffs, "generation steps are a sequence, never a ranked set"
