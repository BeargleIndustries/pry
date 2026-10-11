"""T24: find a concept on Neuronpedia, then steer with any in-range feature.

Neuronpedia is always mocked here. The fixture
``fixtures/neuronpedia_search_ocean.json`` is a trimmed real answer from
POST https://www.neuronpedia.org/api/explanation/search for
{"modelId": "gpt2-small", "layers": ["8-res-jb"], "query": "the ocean"}
(fetched 2026-10-11).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import requests

FIXTURE = Path(__file__).parent / "fixtures" / "neuronpedia_search_ocean.json"
OCEAN_FEATURE = 8548  # "references to the ocean" (top hit in the fixture)
PROMPT = "I went for a walk and"


def _ocean_json() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class _FakeResp:
    def __init__(self, status: int, data: object):
        self.status_code = status
        self._data = data

    def json(self):
        return self._data


# ---------------------------------------------------------------------------
# Parsing (no model, no network)
# ---------------------------------------------------------------------------


def test_parse_dedupes_and_keeps_best_row():
    from pry_sidecar.concept_search import parse_search_results

    hits = parse_search_results(_ocean_json(), d_sae=24576)
    ids = [h.feature_id for h in hits]
    assert ids[0] == OCEAN_FEATURE
    assert len(ids) == len(set(ids))  # 8548 appears twice in the raw answer
    top = hits[0]
    assert top.description == "references to the ocean"
    assert top.similarity == pytest.approx(0.7028, abs=1e-3)
    assert top.top_boosted_tokens[:3] == ["ographer", "front", " basin"]


def test_parse_drops_out_of_range_and_junk():
    from pry_sidecar.concept_search import parse_search_results

    data = {
        "results": [
            {"index": "5", "description": "ok", "cosine_similarity": 0.4},
            {"index": "10", "description": "too big"},
            {"index": "-1", "description": "negative"},
            {"index": "x", "description": "not a number"},
            {"index": "3", "description": "  "},
            "garbage",
        ]
    }
    hits = parse_search_results(data, d_sae=10)
    assert [h.feature_id for h in hits] == [5]
    assert parse_search_results({"nope": 1}, d_sae=10) == []
    assert parse_search_results(None, d_sae=10) == []


def test_search_concepts_request_shape(monkeypatch):
    from pry_sidecar import concept_search

    seen = {}

    def fake_post(url, json=None, timeout=None, headers=None):
        seen.update(url=url, json=json, timeout=timeout, headers=headers)
        return _FakeResp(200, _ocean_json())

    monkeypatch.setattr(concept_search.requests, "post", fake_post)
    hits = concept_search.search_concepts("gpt2-small", "8-res-jb", "the ocean", 24576)
    assert seen["url"] == "https://www.neuronpedia.org/api/explanation/search"
    assert seen["json"] == {"modelId": "gpt2-small", "layers": ["8-res-jb"], "query": "the ocean"}
    assert seen["headers"]["User-Agent"].startswith("pry/")
    assert hits[0].feature_id == OCEAN_FEATURE


@pytest.mark.parametrize("failure", ["offline", "http500"])
def test_search_concepts_unavailable(monkeypatch, failure):
    from pry_sidecar import concept_search

    def fake_post(*a, **k):
        if failure == "offline":
            raise requests.ConnectionError("no network")
        return _FakeResp(500, {})

    monkeypatch.setattr(concept_search.requests, "post", fake_post)
    with pytest.raises(concept_search.NeuronpediaUnavailable):
        concept_search.search_concepts("gpt2-small", "8-res-jb", "the ocean", 24576)


# ---------------------------------------------------------------------------
# Real model (GPT-2 small, layer-8 SAE)
# ---------------------------------------------------------------------------


def _active_features(loaded, prompt: str) -> set[int]:
    """Every feature with a nonzero activation at any position of ``prompt``."""
    import torch

    from pry_sidecar.inference import sae_hook_name
    from pry_sidecar.presets import PRESETS

    hook = sae_hook_name(PRESETS["gpt2-small"], loaded.sae_layer)
    with torch.no_grad():
        _, cache = loaded.model.run_with_cache(
            loaded.model.to_tokens(prompt), names_filter=lambda n: n == hook
        )
        resid = cache[hook][0].to(device=loaded.sae.device, dtype=loaded.sae.dtype)
        acts = loaded.sae.encode(resid)  # [seq, d_sae]
    return set((acts > 0).any(dim=0).nonzero().flatten().tolist())


@pytest.mark.inference
def test_steer_arbitrary_feature_id(gpt2_client, gpt2_loaded):
    """A feature that never fired on the prompt can still be steered; out-of-range is a 400."""
    layer = gpt2_loaded.sae_layer
    assert layer == 8  # the fixture's Neuronpedia SAE set is 8-res-jb
    d_sae = int(gpt2_loaded.sae.cfg.d_sae)

    active = _active_features(gpt2_loaded, PROMPT)
    assert active, "sanity: the prompt activates some features"
    assert OCEAN_FEATURE not in active, "pick a prompt where the ocean feature is silent"

    r = gpt2_client.post(
        "/steer",
        json={
            "preset_id": "gpt2-small",
            "prompt": PROMPT,
            "feature_id": OCEAN_FEATURE,
            "sae_layer": layer,
            "alpha": 10.0,
            "max_new_tokens": 12,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["feature_id"] == OCEAN_FEATURE
    assert body["steered_generation"] != body["original_generation"]

    for bad in (d_sae, d_sae + 1000):
        r = gpt2_client.post(
            "/steer",
            json={"preset_id": "gpt2-small", "prompt": PROMPT, "feature_id": bad,
                  "sae_layer": layer, "max_new_tokens": 1},
        )
        assert r.status_code == 400, r.text
        msg = r.json()["error"]
        assert "out of range" in msg and f"0-{d_sae - 1}" in msg

    r = gpt2_client.post(
        "/steer",
        json={"preset_id": "gpt2-small", "prompt": PROMPT, "feature_id": -1,
              "sae_layer": layer, "max_new_tokens": 1},
    )
    assert r.status_code == 400, r.text


@pytest.mark.inference
def test_run_steer_rejects_out_of_range_directly(gpt2_loaded):
    """run_steer checks the range itself (a negative index would wrap in W_dec)."""
    from pry_sidecar.inference import run_steer
    from pry_sidecar.schemas import SteerRequest

    d_sae = int(gpt2_loaded.sae.cfg.d_sae)
    req = SteerRequest(preset_id="gpt2-small", prompt=PROMPT, feature_id=0,
                       sae_layer=gpt2_loaded.sae_layer, max_new_tokens=1)
    req.feature_id = d_sae  # bypass schema validation, as a racing caller could
    with pytest.raises(ValueError, match="out of range"):
        run_steer(req, gpt2_loaded)


@pytest.mark.inference
def test_concept_search_endpoint(gpt2_client, monkeypatch):
    from pry_sidecar import concept_search

    monkeypatch.setattr(concept_search.requests, "post", lambda *a, **k: _FakeResp(200, _ocean_json()))
    r = gpt2_client.post("/concept-search", json={"preset_id": "gpt2-small", "query": "  the ocean "})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok" and body["query"] == "the ocean" and body["sae_layer"] == 8
    assert body["results"][0]["feature_id"] == OCEAN_FEATURE

    # preset_id defaults to the loaded model
    r = gpt2_client.post("/concept-search", json={"query": "the ocean"})
    assert r.status_code == 200 and r.json()["preset_id"] == "gpt2-small"


@pytest.mark.inference
def test_concept_search_errors(gpt2_client, monkeypatch):
    from pry_sidecar import concept_search

    r = gpt2_client.post("/concept-search", json={"query": "ab"})
    assert r.status_code == 400
    assert r.json()["error"] == "Type at least 3 characters to search."

    def offline(*a, **k):
        raise requests.ConnectionError("no network")

    monkeypatch.setattr(concept_search.requests, "post", offline)
    r = gpt2_client.post("/concept-search", json={"query": "the ocean"})
    assert r.status_code == 502
    assert r.json()["error"] == "neuronpedia_unavailable"
    assert "neuronpedia.org" in r.json()["detail"]
