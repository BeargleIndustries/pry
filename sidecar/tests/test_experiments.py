"""Experiment cards (T22): every clean/corrupted patching pair must tokenize to
the same length under the GPT-2 tokenizer, because `/patch` rejects pairs whose
lengths differ. Uses only the tokenizer files from the local HF cache (no
model weights), and skips when they aren't cached.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

EXPERIMENTS_JSON = (
    Path(__file__).resolve().parents[2] / "ui" / "src" / "lib" / "experiments" / "experiments.json"
)


def _gpt2_tokenizer():
    from huggingface_hub import try_to_load_from_cache

    if not isinstance(try_to_load_from_cache("gpt2", "tokenizer.json"), str):
        pytest.skip("gpt2 tokenizer not in local HF cache")
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained("gpt2", local_files_only=True)


def _patching_pairs() -> list[tuple[str, str, str]]:
    data = json.loads(EXPERIMENTS_JSON.read_text(encoding="utf-8"))
    return [
        (exp["id"], exp["patching"]["clean"], exp["patching"]["corrupted"])
        for exp in data["experiments"]
        if exp.get("patching")
    ]


def test_experiment_pairs_same_length():
    pairs = _patching_pairs()
    assert pairs, "expected at least one patching experiment"
    tok = _gpt2_tokenizer()
    for exp_id, clean, corrupted in pairs:
        n_clean = len(tok(clean)["input_ids"])
        n_corrupted = len(tok(corrupted)["input_ids"])
        assert n_clean == n_corrupted, (
            f"{exp_id}: clean has {n_clean} tokens, corrupted has {n_corrupted}"
        )
        assert clean != corrupted, f"{exp_id}: clean and corrupted prompts are identical"


# GPU/CPU float differences are ~1e-3 logits; a card whose answer wins by less
# than this could flip on another machine (the old Eiffel card was a 0.005 tie).
MIN_LOGIT_GAP = 0.25


def _top_two(model, prompt: str) -> tuple[str, float]:
    import torch

    with torch.no_grad():
        logits = model(prompt)[0, -1]
    top = torch.topk(logits, 2)
    word = model.to_single_str_token(int(top.indices[0]))
    return word, float(top.values[0] - top.values[1])


@pytest.mark.inference
def test_experiment_expected_answers(gpt2_loaded):
    """Every card's stated answer is GPT-2 small's top guess, by a clear margin."""
    model = gpt2_loaded.model
    data = json.loads(EXPERIMENTS_JSON.read_text(encoding="utf-8"))
    checked = 0
    for exp in data["experiments"]:
        cases = []
        if exp.get("expect"):
            cases.append((exp["prompt"], exp["expect"]))
        if exp.get("expectCorrupted"):
            cases.append((exp["patching"]["corrupted"], exp["expectCorrupted"]))
        for prompt, expected in cases:
            word, gap = _top_two(model, prompt)
            assert word == expected, f"{exp['id']}: {prompt!r} -> {word!r}, card says {expected!r}"
            assert gap >= MIN_LOGIT_GAP, f"{exp['id']}: {expected!r} wins by only {gap:.3f} logits"
            checked += 1
    assert checked >= 5
