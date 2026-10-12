"""Pydantic request/response schemas for the Pry sidecar API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class CustomModelRef(BaseModel):
    hf_id: str = Field(..., min_length=1, max_length=200)


class LoadRequest(BaseModel):
    """Either a preset id, or ``custom: {hf_id}`` for a user-added model (T32).

    A custom model is then addressed as ``custom:<hf_id>`` in every other
    request (``preset_id``); ``preset_id: "custom:<hf_id>"`` loads it too.
    """

    preset_id: str | None = None
    custom: CustomModelRef | None = None

    @model_validator(mode="after")
    def _one_target(self) -> "LoadRequest":
        if (self.preset_id is None) == (self.custom is None):
            # PydanticCustomError (not ValueError) keeps e.errors() JSON-safe.
            raise PydanticCustomError("one_target", "give exactly one of preset_id or custom")
        return self


class CustomValidateRequest(BaseModel):
    hf_id: str = Field(..., min_length=1, max_length=200)


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
    # T26: 0 = always take the most likely next token (the old behaviour).
    # Above 0 the next token is drawn at random, flattened (>1) or sharpened (<1).
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    # Fixes the random draws when temperature > 0. None = pick one and report it.
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)


# ---------------------------------------------------------------------------
# Response / event models
# ---------------------------------------------------------------------------


class LoadProgressEvent(BaseModel):
    # M1 fix: add "already_loaded" so the frontend can distinguish "just finished
    # loading" from "was already in memory" and skip the progress animation.
    stage: Literal[
        "warmup", "check_files", "download_model", "download_sae",
        "load_model", "to_device", "load_sae", "ready", "already_loaded", "error",
    ]
    progress: float = Field(ge=0.0, le=1.0)
    message: str
    # Byte progress, only on download_model / download_sae events that are
    # actually fetching files (omitted from the JSON otherwise).
    bytes_downloaded: int | None = None
    bytes_total: int | None = None
    # Seconds since this stage started, on heartbeat events of long steps
    # (warmup, load_model) that report no progress of their own.
    elapsed_s: float | None = None


class TokenizeRequest(BaseModel):
    preset_id: str = "gpt2-small"
    text: str = Field(..., max_length=4000)


class TokenizeResponse(BaseModel):
    tokens: list[str]
    count: int  # includes BOS, the same length /patch compares


class TokenInfo(BaseModel):
    index: int
    text: str


class AttentionLayer(BaseModel):
    """One layer of attention: n_heads x seq x seq matrix (nested lists)."""
    layer: int
    heads: list[list[list[float]]]  # [head][query_token][key_token]


LabelDetail = Literal["detailed", "short", "none"]
# Deprecated alias of label_detail (a label word-count bucket, not a real
# confidence). Kept for one release; the UI reads `label_detail ?? confidence`.
LegacyConfidence = Literal["high", "medium", "low", "none"]


class FeatureHit(BaseModel):
    id: int
    activation: float
    description: str | None = None
    label_detail: LabelDetail = "none"
    confidence: LegacyConfidence = "none"
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


class GenerationStep(BaseModel):
    """One written token of the continuation (T26 "watch it write").

    Probabilities come from the softmax at the sampling temperature; at
    temperature 0 (greedy) they are the model's plain softmax (temperature 1),
    since a temperature-0 softmax would just say 100% / 0%.
    ``runner_up`` is the most likely token other than the chosen one, so when
    sampling picks an unlikely token the runner-up can be the more likely one.
    """
    token: str
    token_id: int
    # What this step adds to the decoded text. Characters like emoji span
    # several tokens: the steps before the last piece add "" and the last
    # adds the whole character, so joining ``text`` never shows broken bytes.
    text: str = ""
    probability: float
    runner_up: str | None = None
    runner_up_probability: float | None = None


class GenerateResponse(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = ""
    tokens: list[TokenInfo] = Field(default_factory=list)
    generation: str | None = None
    # T26: per-step data for the continuation (empty when max_new_tokens == 0).
    generation_steps: list[GenerationStep] = Field(default_factory=list)
    temperature_used: float = 0.0
    seed_used: int | None = None  # set when temperature > 0
    attention: list[AttentionLayer] = Field(default_factory=list)
    # H3: set to True when attention was truncated to the seq cap (64 tokens).
    # Frontend should show a notice rather than silently displaying partial data.
    attention_truncated: bool = False
    sae_features: list[TokenFeatures] = Field(default_factory=list)
    # None for a custom model (T32): it has no feature dictionary (SAE).
    sae_layer_used: int | None = 0
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
    label_detail: LabelDetail = "none"
    confidence: LegacyConfidence = "none"
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
    # Token position patched (residual patching only; heads/MLPs patch all positions).
    position: int | None = None
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
    # Clean prompt's tokens, to label the residual layer x position grid.
    tokens: list[str] = Field(default_factory=list)
    components: list[PatchComponent] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Head scores: induction + previous-token heads (T20)
# ---------------------------------------------------------------------------


class HeadScoresRequest(BaseModel):
    preset_id: str = "gpt2-small"
    # Text for the previous-token score. Omitted: score it on the same
    # repeated random sequence as the induction score.
    prompt: str | None = Field(default=None, max_length=4000)
    top_k: int = Field(default=8, ge=1, le=64)


class HeadScore(BaseModel):
    layer: int
    head: int
    # Mean attention from each second-repeat token to the token that came
    # right after its first occurrence (0-1).
    induction: float
    # Mean attention from each token to the token just before it (0-1).
    previous_token: float


class HeadScoresResponse(BaseModel):
    preset_id: str
    n_layers: int
    n_heads: int
    # The test sequence (without BOS): ``repeat_len`` random tokens, then the
    # same tokens again.
    repeat_len: int
    sequence_tokens: list[str] = Field(default_factory=list)
    # Where the previous-token score was measured: "repeated_sequence" or "prompt".
    previous_token_source: Literal["repeated_sequence", "prompt"] = "repeated_sequence"
    scores: list[HeadScore] = Field(default_factory=list)  # every head, layer-major
    top_induction: list[HeadScore] = Field(default_factory=list)  # highest first
    top_previous_token: list[HeadScore] = Field(default_factory=list)  # highest first
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
    # Minimum |edge weight| (logits) to return an edge; None = server default.
    edge_threshold: float | None = Field(default=None, ge=0.0)


class CircuitNode(BaseModel):
    id: str
    type: Literal["attention", "mlp"]
    layer: int
    head: int | None = None
    importance: float


class CircuitEdge(BaseModel):
    source: str
    target: str
    # Signed, in logits of the predicted token: > 0 pushes toward it.
    weight: float


class CircuitResponse(BaseModel):
    preset_id: str
    prompt: str
    threshold: float = 0.0
    source: str = "dla"
    nodes: list[CircuitNode] = Field(default_factory=list)
    edges: list[CircuitEdge] = Field(default_factory=list)
    # How edges were computed. "direct_value_path" = the source's output
    # passed straight through the target head's value path to the predicted
    # logit (Q/K composition excluded). "none" = no edges are claimed.
    edges_method: str = "none"
    # Edges with |weight| below this were dropped.
    edge_threshold: float = 0.0
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"
