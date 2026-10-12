"""T13: presets.json ``display`` block + ``cpu_ok`` (contract §1)."""

from __future__ import annotations

import pytest

from pry_sidecar.presets import PRESETS, PresetDisplay

DISPLAY_KEYS = set(PresetDisplay.model_fields)

# Slugs checked against the live Neuronpedia API on 2026-10-11
# (GET /api/feature/{model}/{layer}-{suffix}/{id} -> 200); see sidecar/README.md.
EXPECTED_NEURONPEDIA = {
    "gpt2-small": ("gpt2-small", "8-res-jb"),
    "pythia-70m": ("pythia-70m-deduped", "3-res-sm"),
    "gemma-2-2b": (None, None),
    "gemma-2-9b": (None, None),
}


def _raw_presets() -> list[dict]:
    import json
    import os
    from pathlib import Path

    path = Path(os.environ["PRY_PRESETS_PATH"])
    return json.loads(path.read_text(encoding="utf-8"))["presets"]


def test_presets_display_complete():
    raw = _raw_presets()
    assert {p["id"] for p in raw} == set(PRESETS)
    for p in raw:
        assert "display" in p, p["id"]
        assert set(p["display"]) == DISPLAY_KEYS, p["id"]
        assert isinstance(p.get("cpu_ok"), bool), p["id"]
        d = p["display"]
        assert d["name"] and d["blurb"] and d["params"] and d["size_label"]
        assert d["n_layers"] > 0 and d["n_heads"] > 0
        # Both Neuronpedia fields are set together or not at all.
        assert (d["neuronpedia_model_id"] is None) == (d["neuronpedia_release_suffix"] is None)
    assert [p["id"] for p in raw if p["display"]["recommended"]] == ["gpt2-small"]
    assert PRESETS["gpt2-small"].cpu_ok and PRESETS["pythia-70m"].cpu_ok
    assert not PRESETS["gemma-2-2b"].cpu_ok and not PRESETS["gemma-2-9b"].cpu_ok


@pytest.mark.inference
@pytest.mark.parametrize(
    ("preset_id", "fixture_name"),
    [("gpt2-small", "gpt2_loaded"), ("pythia-70m", "pythia_loaded")],
)
def test_presets_display_matches_model(preset_id, fixture_name, request):
    cfg = request.getfixturevalue(fixture_name).model.cfg
    display = PRESETS[preset_id].display
    assert display.n_layers == cfg.n_layers
    assert display.n_heads == cfg.n_heads


def test_neuronpedia_ids():
    for preset_id, (model_id, release_id) in EXPECTED_NEURONPEDIA.items():
        m = PRESETS[preset_id]
        assert m.neuronpedia_model_id == model_id
        assert m.neuronpedia_release_id(m.sae.layer) == release_id
    assert PRESETS["pythia-70m"].neuronpedia_release_id(5) == "5-res-sm"


def test_neuronpedia_ids_match_saelens_directory():
    """SAELens records the Neuronpedia id of each SAE; ours must agree."""
    from sae_lens.toolkit.pretrained_saes_directory import get_pretrained_saes_directory

    directory = get_pretrained_saes_directory()
    for m in PRESETS.values():
        if m.neuronpedia_model_id is None:
            continue
        entry = directory[m.sae.release]
        for layer in m.available_sae_layers:
            sae_id = f"blocks.{layer}.{m.sae.hook}"
            expected = f"{m.neuronpedia_model_id}/{m.neuronpedia_release_id(layer)}"
            assert entry.neuronpedia_id[sae_id] == expected


def test_models_endpoint_includes_display_and_cpu_ok():
    from starlette.testclient import TestClient

    from pry_sidecar.main import app

    with TestClient(app) as client:
        body = client.get("/models").json()
    by_id = {p["id"]: p for p in body["available"]}
    assert set(by_id) == set(PRESETS)
    for preset_id, p in by_id.items():
        assert set(p["display"]) == DISPLAY_KEYS
        assert p["cpu_ok"] == PRESETS[preset_id].cpu_ok
    assert by_id["pythia-70m"]["display"]["neuronpedia_model_id"] == "pythia-70m-deduped"
