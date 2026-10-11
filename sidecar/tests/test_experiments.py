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
