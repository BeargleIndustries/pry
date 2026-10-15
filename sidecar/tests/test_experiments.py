"""The eight 0.3.8 experiments, now lessons (plan T6): read from the lessons'
expectations.json, written by `npm run lessons:compile -- --expectations`.

Each experiment's prompt must reach the lesson it landed in; every
clean/corrupted patching pair the lessons send must tokenize to the same
length under the GPT-2 tokenizer (`/patch` rejects pairs whose lengths
differ); and every "top guess is X" check a lesson makes must be GPT-2 small's
top guess by a clear margin. The tokenizer tests use only the tokenizer files
from the local HF cache (no model weights) and skip when they aren't cached.

While the T6 lanes run apart, an experiment whose lesson another lane writes
is skipped until that lesson is in expectations.json.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

EXPECTATIONS_JSON = (
    Path(__file__).resolve().parents[2] / "ui" / "src" / "lessons" / "__generated__" / "expectations.json"
)

# Experiment -> (its prompt in 0.3.8, the lessons it landed in): plan T6, ui/src/lessons/MAPPING.md.
EXPERIMENTS: dict[str, tuple[str, list[str]]] = {
    "induction": ("Pip ordered zebra lamps from Quorn. Pip ordered zebra lamps from", ["pry.p2-2"]),
    "logit-lens": ("Michael Jordan played the sport of", ["pry.p2-3"]),
    # P2.4 also uses the nurse prompt, but only as its transfer: the learner runs
    # that DLA in a task (expect: learner), so no recorded lesson request has it.
    "he-or-she": ("The nurse said that", ["pry.p3-1"]),
    "ioi-knockout": ("When Mary and John went to the store, John gave a drink to", ["pry.p3-2"]),
    "ioi-swap": ("When Mary and John went to the store, John gave a drink to", ["pry.p3-3"]),
    "features-steering": ("On our trip we walked along the beach and watched the ocean", ["pry.p3-5"]),
    "fact-recall": ("Michael Jordan played the sport of", ["pry.p3-6"]),
    "greater-than": ("The war lasted from the year 1732 to the year 17", ["pry.p3-7"]),
}

# Who writes each lesson the experiments landed in (ralph-t6-brief).
LANE = {
    **{f"pry.p2-{i}": "lane/t6-s2" for i in range(1, 6)},
    **{f"pry.p3-{i}": "lane/t6-s3" for i in range(1, 8)},
    "pry.p4-1": "lane/t6-s3",
}

# GPU/CPU float differences are ~1e-3 logits; a top guess that wins by less
# than this could flip on another machine. The 0.3.8 experiment cards used
# 0.25; lesson checks also cover ordinary prompts (P1.1's France transfer wins
# by 0.24), so they get 0.1, still two orders of magnitude above the noise.
MIN_LOGIT_GAP = 0.1


def _doc() -> dict:
    if not EXPECTATIONS_JSON.exists():
        pytest.fail("no expectations.json: run `npm run lessons:compile -- --expectations` in ui/")
    return json.loads(EXPECTATIONS_JSON.read_text(encoding="utf-8"))


def _gpt2_tokenizer():
    from huggingface_hub import try_to_load_from_cache

    if not isinstance(try_to_load_from_cache("gpt2", "tokenizer.json"), str):
        pytest.skip("gpt2 tokenizer not in local HF cache")
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained("gpt2", local_files_only=True)


def test_expectations_schema():
    """Every request has its endpoint, model, body and key; every lesson its prompts and checks."""
    doc = _doc()
    assert doc["requests"], "expectations.json lists no requests"
    for req in doc["requests"]:
        assert req["endpoint"].startswith("/") and req["model"] and isinstance(req["body"], dict) and len(req["key"]) == 64, req
        assert req["lessons"], f"{req['key']}: no lesson sends it"
    for lesson_id, lesson in doc["lessons"].items():
        assert isinstance(lesson["prompts"], list) and isinstance(lesson["checks"], list), lesson_id


@pytest.mark.parametrize("exp_id", list(EXPERIMENTS))
def test_experiment_lands_in_its_lesson(exp_id):
    """The experiment's prompt is one the lesson it landed in sends."""
    prompt, lesson_ids = EXPERIMENTS[exp_id]
    lessons = _doc()["lessons"]
    waiting = [lid for lid in lesson_ids if lid not in lessons]
    if waiting:
        pytest.skip(f"{exp_id}: waiting for {', '.join(f'{lid} ({LANE[lid]})' for lid in waiting)}")
    doc = _doc()
    for lid in lesson_ids:
        # A /patch request sends its pair as clean_prompt / corrupted_prompt (P3.3).
        sent = set(lessons[lid]["prompts"]) | {
            req["body"][f]
            for req in doc["requests"]
            if lid in req["lessons"]
            for f in ("clean_prompt", "corrupted_prompt")
            if f in req["body"]
        }
        assert prompt in sent, f"{exp_id}: {lid} never sends {prompt!r}"


def _patch_pairs() -> list[tuple[str, str, str]]:
    return [
        (",".join(req["lessons"]), req["body"]["clean_prompt"], req["body"]["corrupted_prompt"])
        for req in _doc()["requests"]
        if req["endpoint"] == "/patch"
    ]


def test_lesson_patch_pairs_same_length():
    pairs = _patch_pairs()
    if not pairs:
        pytest.skip("no /patch request yet: P3.3, P3.6 and P3.7 come from lane/t6-s3")
    tok = _gpt2_tokenizer()
    for where, clean, corrupted in pairs:
        n_clean = len(tok(clean)["input_ids"])
        n_corrupted = len(tok(corrupted)["input_ids"])
        assert n_clean == n_corrupted, f"{where}: clean has {n_clean} tokens, corrupted has {n_corrupted}"
        assert clean != corrupted, f"{where}: clean and corrupted prompts are identical"


def _top_two(model, prompt: str) -> tuple[str, float]:
    import torch

    with torch.no_grad():
        logits = model(prompt)[0, -1]
    top = torch.topk(logits, 2)
    word = model.to_single_str_token(int(top.indices[0]))
    return word, float(top.values[0] - top.values[1])


def _top_guess_checks() -> list[tuple[str, str, str]]:
    out = []
    for lesson_id, lesson in _doc()["lessons"].items():
        for c in lesson["checks"]:
            chk = c.get("check") or {}
            if chk.get("read") == "top_guess.token" and chk.get("op") == "equals" and not chk.get("not") and c.get("prompt"):
                out.append((f"{lesson_id} {c['where']}", c["prompt"], chk["value"]))
    return out


@pytest.mark.inference
def test_lesson_top_guess_checks(gpt2_loaded):
    """Every lesson check that says "the top guess is X" holds on GPT-2 small, by a clear margin."""
    checks = _top_guess_checks()
    assert checks, "no top-guess checks in expectations.json"
    model = gpt2_loaded.model
    for where, prompt, expected in checks:
        word, gap = _top_two(model, prompt)
        assert word == expected, f"{where}: {prompt!r} -> {word!r}, the lesson says {expected!r}"
        assert gap >= MIN_LOGIT_GAP, f"{where}: {expected!r} wins by only {gap:.3f} logits"
