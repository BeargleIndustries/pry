"""Pydantic schema round-trip tests for pry_sidecar.schemas.

Catches accidental schema drift between the sidecar's request/response
contract and the Tauri frontend's expectations.
"""

import pytest
from pydantic import ValidationError

from pry_sidecar.schemas import (
    ActivatingSnippet,
    AttentionLayer,
    FeatureHit,
    FeatureResponse,
    GenerateRequest,
    GenerateResponse,
    LoadProgressEvent,
    LoadRequest,
    ModelInfo,
    ModelSAEInfo,
    ModelSpec,
    SAEFeatureResult,  # alias → TokenFeatures
    TokenFeatures,
    TokenInfo,
    TopKFeature,  # alias → FeatureHit
)


# ---------------------------------------------------------------------------
# LoadRequest
# ---------------------------------------------------------------------------


def test_load_request_roundtrip():
    req = LoadRequest(preset_id="gpt2-small")
    restored = LoadRequest.model_validate_json(req.model_dump_json())
    assert req == restored


def test_load_request_missing_preset_id_raises():
    with pytest.raises(ValidationError):
        LoadRequest.model_validate({})


# ---------------------------------------------------------------------------
# GenerateRequest
# ---------------------------------------------------------------------------


def test_generate_request_roundtrip():
    original = GenerateRequest(
        preset_id="gpt2-small",
        prompt="hello world",
        max_new_tokens=10,
        sae_layer=8,
        top_k_features=5,
    )
    restored = GenerateRequest.model_validate_json(original.model_dump_json())
    assert original == restored


def test_generate_request_defaults():
    req = GenerateRequest(prompt="hi")
    assert req.prompt == "hi"
    assert req.max_new_tokens == 0
    assert req.sae_layer is None
    assert req.top_k_features == 5
    assert req.preset_id == "gpt2-small"


def test_generate_request_null_layer_roundtrip():
    req = GenerateRequest(prompt="test", max_new_tokens=5, sae_layer=None)
    restored = GenerateRequest.model_validate_json(req.model_dump_json())
    assert restored.sae_layer is None


def test_generate_request_missing_prompt_raises():
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate({})


# ---------------------------------------------------------------------------
# LoadProgressEvent
# ---------------------------------------------------------------------------


def test_load_progress_event_all_stages():
    stages = ["download_model", "download_sae", "load_model", "load_sae", "ready", "error"]
    for stage in stages:
        event = LoadProgressEvent(stage=stage, progress=0.5, message=f"working on {stage}")
        restored = LoadProgressEvent.model_validate_json(event.model_dump_json())
        assert restored.stage == stage
        assert restored.progress == 0.5


def test_load_progress_event_boundary_progress():
    for p in [0.0, 1.0]:
        event = LoadProgressEvent(stage="ready", progress=p, message="ok")
        restored = LoadProgressEvent.model_validate_json(event.model_dump_json())
        assert restored.progress == p


def test_load_progress_event_invalid_stage_raises():
    with pytest.raises(ValidationError):
        LoadProgressEvent.model_validate({"stage": "unknown", "progress": 0.5, "message": "x"})


# ---------------------------------------------------------------------------
# TokenInfo
# ---------------------------------------------------------------------------


def test_token_info_roundtrip():
    t = TokenInfo(index=3, text=" hello")
    restored = TokenInfo.model_validate_json(t.model_dump_json())
    assert restored == t


# ---------------------------------------------------------------------------
# AttentionLayer
# ---------------------------------------------------------------------------


def test_attention_layer_roundtrip():
    layer = AttentionLayer(
        layer=0,
        heads=[
            [[0.9, 0.1], [0.4, 0.6]],  # head 0
            [[0.5, 0.5], [0.2, 0.8]],  # head 1
        ],
    )
    restored = AttentionLayer.model_validate_json(layer.model_dump_json())
    assert restored.layer == 0
    assert len(restored.heads) == 2
    assert restored.heads[0][0] == [0.9, 0.1]


# ---------------------------------------------------------------------------
# FeatureHit / TokenFeatures / GenerateResponse
# ---------------------------------------------------------------------------


def test_feature_hit_roundtrip():
    hit = FeatureHit(
        id=42,
        activation=3.14,
        description="a curve token",
        confidence="high",
        top_activating_snippets=["The curve of", "curved line"],
    )
    restored = FeatureHit.model_validate_json(hit.model_dump_json())
    assert restored == hit


def test_feature_hit_defaults():
    hit = FeatureHit(id=1, activation=0.5)
    assert hit.description is None
    assert hit.confidence == "none"
    assert hit.top_activating_snippets == []
    restored = FeatureHit.model_validate_json(hit.model_dump_json())
    assert restored == hit


def test_topk_feature_alias_is_feature_hit():
    assert TopKFeature is FeatureHit


def test_sae_feature_result_alias_is_token_features():
    assert SAEFeatureResult is TokenFeatures


def test_token_features_roundtrip():
    result = TokenFeatures(
        token_index=3,
        top_k=[
            FeatureHit(id=100, activation=5.0, description="France", confidence="high"),
            FeatureHit(id=200, activation=2.1),
        ],
    )
    restored = TokenFeatures.model_validate_json(result.model_dump_json())
    assert restored.token_index == 3
    assert len(restored.top_k) == 2
    assert restored.top_k[0].id == 100


def test_generate_response_roundtrip():
    response = GenerateResponse(
        preset_id="gpt2-small",
        prompt="hello world",
        tokens=[TokenInfo(index=0, text="hello"), TokenInfo(index=1, text=" world")],
        generation=None,
        attention=[
            AttentionLayer(layer=0, heads=[[[1.0, 0.0], [0.3, 0.7]]]),
        ],
        sae_features=[
            TokenFeatures(
                token_index=0,
                top_k=[FeatureHit(id=14882, activation=5.2)],
            )
        ],
        sae_layer_used=8,
        timing_ms={"forward_ms": 12.3, "sae_ms": 4.1, "total_ms": 20.0},
    )
    restored = GenerateResponse.model_validate_json(response.model_dump_json())
    assert restored.preset_id == "gpt2-small"
    assert restored.prompt == "hello world"
    assert len(restored.tokens) == 2
    assert restored.tokens[1].text == " world"
    assert len(restored.attention) == 1
    assert restored.attention[0].layer == 0
    assert restored.sae_features[0].top_k[0].id == 14882
    assert restored.sae_layer_used == 8
    assert restored.timing_ms["total_ms"] == 20.0
    assert restored.status == "ok"


def test_generate_response_defaults():
    resp = GenerateResponse()
    assert resp.tokens == []
    assert resp.attention == []
    assert resp.sae_features == []
    assert resp.status == "ok"


# ---------------------------------------------------------------------------
# ActivatingSnippet / FeatureResponse
# ---------------------------------------------------------------------------


def test_activating_snippet_roundtrip():
    snip = ActivatingSnippet(snippet="Paris is the capital", activation=5.2)
    restored = ActivatingSnippet.model_validate_json(snip.model_dump_json())
    assert restored == snip


def test_feature_response_roundtrip():
    resp = FeatureResponse(
        feature_id=14882,
        description="Paris / France context",
        confidence="high",
        top_activating_snippets=[
            ActivatingSnippet(snippet="Paris is the capital of France", activation=5.2),
            ActivatingSnippet(snippet="the Eiffel Tower", activation=4.1),
        ],
    )
    restored = FeatureResponse.model_validate_json(resp.model_dump_json())
    assert restored.feature_id == 14882
    assert restored.description == "Paris / France context"
    assert restored.confidence == "high"
    assert len(restored.top_activating_snippets) == 2


def test_feature_response_empty_snippets():
    resp = FeatureResponse(feature_id=0)
    restored = FeatureResponse.model_validate_json(resp.model_dump_json())
    assert restored.top_activating_snippets == []
    assert restored.confidence == "none"
    assert restored.description is None


# ---------------------------------------------------------------------------
# ModelInfo (nested ModelSpec + ModelSAEInfo)
# ---------------------------------------------------------------------------


def test_model_info_roundtrip():
    info = ModelInfo(
        id="gpt2-small",
        model=ModelSpec(hf_id="openai-community/gpt2", size_mb=548, tl_name="gpt2"),
        sae=ModelSAEInfo(source="eleutherai", release="gpt2-small-res-jb", layer=8, size_mb=250),
        total_download_mb=798,
        vram_estimate_mb=1800,
        license_gate=None,
        tier="free",
    )
    restored = ModelInfo.model_validate_json(info.model_dump_json())
    assert restored.id == "gpt2-small"
    assert restored.model.tl_name == "gpt2"
    assert restored.sae.layer == 8


def test_model_info_with_license_gate_roundtrip():
    info = ModelInfo(
        id="gemma-2-2b",
        model=ModelSpec(hf_id="google/gemma-2-2b", size_mb=5000, tl_name="gemma-2-2b"),
        sae=ModelSAEInfo(source="google", release="gemma-scope-2b-pt-res", layer=12, size_mb=1000),
        total_download_mb=6000,
        vram_estimate_mb=8000,
        license_gate="huggingface_gemma",
        tier="gated",
        enabled=False,
    )
    restored = ModelInfo.model_validate_json(info.model_dump_json())
    assert restored.license_gate == "huggingface_gemma"
    assert restored.enabled is False


# ---------------------------------------------------------------------------
# Module import smoke tests
# ---------------------------------------------------------------------------


def test_inference_module_imports():
    """Importing inference should not trigger heavy ML deps or model loading."""
    import pry_sidecar.inference as inference  # noqa: F401

    assert hasattr(inference, "run_generate")
    assert hasattr(inference, "fetch_feature_description")
    assert hasattr(inference, "fetch_top_activating_snippets")


def test_main_app_imports():
    """The Starlette app should construct without errors."""
    from pry_sidecar.main import app

    assert app is not None
