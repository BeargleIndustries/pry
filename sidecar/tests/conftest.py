"""Shared fixtures for the sidecar test suite.

Inference tests (marker ``inference``) load real weights from the local HF
cache on CPU and skip cleanly when the cache is cold. The SAE and circuit
tests build on ``gpt2_loaded``, ``gpt2_client`` and ``no_neuronpedia``.
"""

from __future__ import annotations

import os
import random
import sys
from pathlib import Path

import pytest

# Must be set before pry_sidecar.presets is imported.
os.environ.setdefault("PRY_PRESETS_PATH", str(Path(__file__).resolve().parent.parent / "presets.json"))

SEED = 1234


def pytest_addoption(parser):
    """Options for test_lessons.py (plan T6a)."""
    group = parser.getgroup("lessons", "lesson rows (test_lessons.py)")
    group.addoption(
        "--record",
        action="store_true",
        default=False,
        help="re-record every verified row's responses and rows.json",
    )
    group.addoption(
        "--diff",
        action="store_true",
        default=False,
        help="with --record: write a diff report of old vs new responses",
    )
    group.addoption(
        "--from-lessons",
        action="store_true",
        default=False,
        help="also send every request in __generated__/expectations.json not covered by a row",
    )
    group.addoption(
        "--lesson-dir",
        action="store",
        default=None,
        metavar="PATH",
        help="only the requests of a lesson set outside the app: reads <set>/__generated__/expectations.json "
        "(written by `npm run lessons:compile -- --expectations --dir PATH`); rows and rows.json are left alone",
    )
    group.addoption(
        "--network",
        action="store_true",
        default=False,
        help="drift mode also refetches Neuronpedia labels and snippets and compares them",
    )


# The Pythons pyproject.toml's requires-python allows (">=3.11,<3.13"); test_python_support.py holds them equal.
SUPPORTED_PYTHON = ((3, 11), (3, 12))

# Lines test_lessons.py's --lesson-dir run leaves for the closing summary block.
LESSON_DIR_SUMMARY = pytest.StashKey[list]()


def python_problem(version=sys.version_info) -> str | None:
    """A plain message when this Python can't run the sidecar, else None."""
    if tuple(version[:2]) in SUPPORTED_PYTHON:
        return None
    have = f"{version[0]}.{version[1]}"
    return (
        f"This venv runs Python {have}, and Pry's sidecar needs Python 3.11 or 3.12. Make the venv again with a "
        "supported Python: delete .venv, then run `py -3.12 -m venv .venv` (Windows) or `python3.12 -m venv .venv` "
        "(macOS/Linux), and install again (AUTHORING.md, \"Set up the sidecar for recording\")."
    )


def pytest_configure(config):
    # Recording a lesson set on an unsupported Python fails late and unclearly, so refuse it up front.
    if config.getoption("--lesson-dir") or config.getoption("--record"):
        problem = python_problem()
        if problem:
            pytest.exit(problem, returncode=4)


@pytest.hookimpl(trylast=True)
def pytest_terminal_summary(terminalreporter):
    """The --lesson-dir summary, as the last block: after pytest's warnings, before the `1 passed` line."""
    lines = terminalreporter.config.stash.get(LESSON_DIR_SUMMARY, [])
    if lines:
        terminalreporter.section("lesson set")
        for line in lines:
            terminalreporter.write_line(line)


def _seed_all() -> None:
    random.seed(SEED)
    try:
        import numpy as np

        np.random.seed(SEED)
    except ImportError:
        pass
    try:
        import torch

        torch.manual_seed(SEED)
    except ImportError:
        pass


@pytest.fixture(autouse=True)
def _seed_rngs():
    _seed_all()
    yield


def _hf_cached(repo_id: str) -> bool:
    from huggingface_hub import try_to_load_from_cache

    return isinstance(try_to_load_from_cache(repo_id, "config.json"), str)


def _load_preset(preset_id: str, hf_repo: str):
    if not _hf_cached(hf_repo):
        pytest.skip(f"{hf_repo} not in local HF cache")
    from pry_sidecar.presets import PRESETS
    from pry_sidecar.registry import REGISTRY

    _seed_all()
    return REGISTRY.load(preset_id, PRESETS[preset_id])


@pytest.fixture(scope="session")
def gpt2_loaded():
    """LoadedModel for gpt2-small (model + layer-8 SAE), loaded once per session."""
    return _load_preset("gpt2-small", "gpt2")


@pytest.fixture(scope="session")
def pythia_loaded():
    """LoadedModel for pythia-70m, loaded once per session (skips if not cached)."""
    return _load_preset("pythia-70m", "EleutherAI/pythia-70m-deduped")


@pytest.fixture
def no_neuronpedia(monkeypatch):
    """Stub Neuronpedia lookups so inference tests never touch the network."""
    from pry_sidecar import inference

    monkeypatch.setattr(inference, "fetch_feature_description", lambda *a, **k: (None, "none"))
    monkeypatch.setattr(inference, "fetch_top_activating_snippets", lambda *a, **k: ())


@pytest.fixture
def gpt2_client(gpt2_loaded, no_neuronpedia):
    """Starlette TestClient for the sidecar app with gpt2-small already in REGISTRY."""
    from starlette.testclient import TestClient

    from pry_sidecar.main import app

    with TestClient(app) as client:
        yield client
