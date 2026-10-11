"""Shared fixtures for the sidecar test suite.

Inference tests (marker ``inference``) load real weights from the local HF
cache on CPU and skip cleanly when the cache is cold. Later tasks (SAE hook
tests, circuit tests) build on ``gpt2_loaded``, ``gpt2_client`` and
``no_neuronpedia``.
"""

from __future__ import annotations

import os
import random
from pathlib import Path

import pytest

# Must be set before pry_sidecar.presets is imported.
os.environ.setdefault("PRY_PRESETS_PATH", str(Path(__file__).resolve().parent.parent / "presets.json"))

SEED = 1234


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
