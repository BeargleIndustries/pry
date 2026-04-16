"""Pydantic request/response schemas for the Pry sidecar API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class LoadRequest(BaseModel):
    preset_id: str


class UnloadRequest(BaseModel):
    preset_id: str


class UnloadResponse(BaseModel):
    preset_id: str
    unloaded: bool


class GenerateRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    # M5 fix: add validation bounds to prevent runaway inference
    max_new_tokens: int = Field(default=0, ge=0, le=256)  # 0 = analyze only
    sae_layer: int | None = Field(default=None, ge=0, le=47)  # override preset default
    top_k_features: int = Field(default=5, ge=1, le=50)


# ---------------------------------------------------------------------------
# Response / event models
# ---------------------------------------------------------------------------


class LoadProgressEvent(BaseModel):
    # M1 fix: add "already_loaded" so the frontend can distinguish "just finished
    # loading" from "was already in memory" and skip the progress animation.
    stage: Literal["download_model", "download_sae", "load_model", "load_sae", "ready", "already_loaded", "error"]
    progress: float = Field(ge=0.0, le=1.0)
    message: str


class TokenInfo(BaseModel):
    index: int
    text: str


class AttentionLayer(BaseModel):
    """One layer of attention: n_heads x seq x seq matrix (nested lists)."""
    layer: int
    heads: list[list[list[float]]]  # [head][query_token][key_token]


class FeatureHit(BaseModel):
    id: int
    activation: float
    description: str | None = None
    confidence: Literal["high", "medium", "low", "none"] = "none"
    top_activating_snippets: list[str] = Field(default_factory=list)


class TokenFeatures(BaseModel):
    token_index: int
    top_k: list[FeatureHit]


# Backward-compat aliases (still used elsewhere, e.g. older imports)
TopKFeature = FeatureHit
SAEFeatureResult = TokenFeatures


class TopPrediction(BaseModel):
    token: str
    probability: float
    rank: int


class GenerateResponse(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = ""
    tokens: list[TokenInfo] = Field(default_factory=list)
    generation: str | None = None
    attention: list[AttentionLayer] = Field(default_factory=list)
    # H3: set to True when attention was truncated to the seq cap (64 tokens).
    # Frontend should show a notice rather than silently displaying partial data.
    attention_truncated: bool = False
    sae_features: list[TokenFeatures] = Field(default_factory=list)
    sae_layer_used: int = 0
    top_predictions: list[TopPrediction] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


class ActivatingSnippet(BaseModel):
    snippet: str
    activation: float


class FeatureResponse(BaseModel):
    feature_id: int
    top_activating_snippets: list[ActivatingSnippet] = Field(default_factory=list)
    description: str | None = None
    confidence: Literal["high", "medium", "low", "none"] = "none"
    status: str = "ok"


class ModelSAEInfo(BaseModel):
    source: str
    release: str
    hook: str = "hook_resid_pre"
    layer: int
    size_mb: int


class ModelSpec(BaseModel):
    hf_id: str
    size_mb: int
    tl_name: str


class ModelInfo(BaseModel):
    id: str
    model: ModelSpec
    sae: ModelSAEInfo
    total_download_mb: int
    vram_estimate_mb: int
    license_gate: str | None
    tier: str
    enabled: bool = True
    downloaded: bool = False
    available_sae_layers: list[int] = Field(default_factory=list)
    default_sae_layer: int = 0


class SAEFeaturesRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    sae_layer: int = Field(..., ge=0, le=47)
    top_k_features: int = Field(default=5, ge=1, le=50)


class SAEFeaturesResponse(BaseModel):
    preset_id: str
    prompt: str
    tokens: list[TokenInfo] = Field(default_factory=list)
    sae_features: list[TokenFeatures] = Field(default_factory=list)
    sae_layer_used: int = 0
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Logit Lens (Phase B4)
# ---------------------------------------------------------------------------


class LogitLensRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)


class LogitLensCell(BaseModel):
    """One cell: what layer L predicted at token position P."""
    predicted_token: str
    probability: float
    matches_final: bool


class LogitLensResponse(BaseModel):
    preset_id: str
    prompt: str
    tokens: list[TokenInfo] = Field(default_factory=list)
    grid: list[list[LogitLensCell]] = Field(default_factory=list)  # [layer][token_pos]
    n_layers: int = 0
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Direct Logit Attribution (Phase B5)
# ---------------------------------------------------------------------------


class DLARequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    target_token_index: int | None = Field(default=None, ge=0)


class DLAComponent(BaseModel):
    name: str
    type: Literal["attention", "mlp"]
    layer: int
    head: int | None = None
    contribution: float


class DLAResponse(BaseModel):
    preset_id: str
    prompt: str
    tokens: list[TokenInfo] = Field(default_factory=list)
    target_token_index: int = 0
    target_token: str = ""
    predicted_token: str = ""
    components: list[DLAComponent] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Feature Steering (Phase C7)
# ---------------------------------------------------------------------------


class SteerRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    feature_id: int = Field(..., ge=0)
    sae_layer: int = Field(..., ge=0, le=47)
    alpha: float = Field(default=5.0, ge=-30.0, le=30.0)
    max_new_tokens: int = Field(default=50, ge=1, le=256)


class SteerResponse(BaseModel):
    preset_id: str
    prompt: str
    feature_id: int
    alpha: float
    original_generation: str = ""
    steered_generation: str = ""
    original_top_predictions: list[TopPrediction] = Field(default_factory=list)
    steered_top_predictions: list[TopPrediction] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Head Ablation (Phase C8)
# ---------------------------------------------------------------------------


class AblationTarget(BaseModel):
    layer: int = Field(..., ge=0, le=47)
    head: int = Field(..., ge=0, le=63)


class AblateHeadRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    ablations: list[AblationTarget] = Field(..., min_length=1)


class AblationPrediction(BaseModel):
    token: str
    probability: float
    rank: int


class AblateResponse(BaseModel):
    """Shared response for both head and feature ablation."""
    preset_id: str
    prompt: str
    original_predictions: list[AblationPrediction] = Field(default_factory=list)
    ablated_predictions: list[AblationPrediction] = Field(default_factory=list)
    prediction_delta: list[dict] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Feature Ablation (Phase C9)
# ---------------------------------------------------------------------------


class FeatureAblationTarget(BaseModel):
    feature_index: int = Field(..., ge=0)
    layer: int = Field(..., ge=0, le=47)


class AblateFeatureRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    feature_ablations: list[FeatureAblationTarget] = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Activation Patching (Phase D10)
# ---------------------------------------------------------------------------


class PatchRequest(BaseModel):
    preset_id: str = "gpt2-small"
    clean_prompt: str = Field(..., max_length=4000)
    corrupted_prompt: str = Field(..., max_length=4000)
    patch_type: Literal["head", "mlp", "resid"] = "head"
    target_token_index: int | None = Field(default=None, ge=0)


class PatchComponent(BaseModel):
    name: str
    layer: int
    head: int | None = None
    effect: float
    clean_logit: float
    corrupted_logit: float
    patched_logit: float


class PatchResponse(BaseModel):
    preset_id: str
    clean_prompt: str
    corrupted_prompt: str
    patch_type: str
    target_token_index: int = 0
    clean_predicted_token: str = ""
    corrupted_predicted_token: str = ""
    components: list[PatchComponent] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Circuit Subgraph Visualization (Phase D11)
# ---------------------------------------------------------------------------


class CircuitRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    threshold: float | None = Field(default=None, ge=0.0)
    source: Literal["dla", "patching"] = "dla"


class CircuitNode(BaseModel):
    id: str
    type: Literal["attention", "mlp"]
    layer: int
    head: int | None = None
    importance: float


class CircuitEdge(BaseModel):
    source: str
    target: str
    weight: float


class CircuitResponse(BaseModel):
    preset_id: str
    prompt: str
    threshold: float = 0.0
    source: str = "dla"
    nodes: list[CircuitNode] = Field(default_factory=list)
    edges: list[CircuitEdge] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"
