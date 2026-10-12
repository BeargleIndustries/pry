"""T8 circuit honesty + T9 label_detail / downloaded flag."""

from __future__ import annotations

import pytest


@pytest.mark.inference
def test_circuit_edges_are_labelled(gpt2_client):
    # T23: edges are only returned with a named method (see test_circuit_edges.py).
    r = gpt2_client.post("/circuit", json={"preset_id": "gpt2-small", "prompt": "The capital of France is"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["edges_method"] == "direct_value_path"
    assert len(body["nodes"]) > 0


@pytest.mark.inference
def test_circuit_patching_source_501(gpt2_client):
    r = gpt2_client.post(
        "/circuit", json={"preset_id": "gpt2-small", "prompt": "Hello world", "source": "patching"}
    )
    assert r.status_code == 501, r.text


@pytest.mark.inference
def test_models_reports_downloaded(gpt2_client):
    r = gpt2_client.get("/models")
    assert r.status_code == 200
    by_id = {p["id"]: p for p in r.json()["available"]}
    assert by_id["gpt2-small"]["downloaded"] is True


@pytest.mark.parametrize(
    "label,bucket,detail",
    [
        ("references to French cities", "high", "detailed"),
        ("French cities", "medium", "short"),
        ("France", "low", "short"),
    ],
)
def test_label_detail_mapping(label, bucket, detail):
    from pry_sidecar.inference import LABEL_DETAIL, _label_length_bucket

    assert _label_length_bucket(label) == bucket
    assert LABEL_DETAIL[bucket] == detail
    assert LABEL_DETAIL["none"] == "none"


def test_feature_hit_label_detail_default():
    from pry_sidecar.schemas import FeatureHit, FeatureResponse

    assert FeatureHit(id=1, activation=1.0).label_detail == "none"
    assert FeatureResponse(feature_id=1).label_detail == "none"
