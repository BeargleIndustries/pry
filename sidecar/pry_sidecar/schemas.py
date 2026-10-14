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
    # On "ready" / "already_loaded" only (MF-5 provenance): the resolved Hugging
    # Face snapshot hash the weights came from (recorded, not pinned) and the
    # SAE in use. Omitted from the JSON when unknown.
    model_revision: str | None = None
    sae: "SAERef | None" = None


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
    # The raw score before softmax (MF-1): probability = softmax(logits)[token].
    logit: float | None = None


class SAERef(BaseModel):
    """Which SAE (feature dictionary) a result came from (MF-5)."""
    release: str
    id: str


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
    # MF-5 provenance: resolved snapshot hash of the weights (None if unknown)
    # and the SAE in use (None for a custom model).
    model_revision: str | None = None
    sae: SAERef | None = None
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# ---------------------------------------------------------------------------
# Embedding reader (TN-1)
# ---------------------------------------------------------------------------


class EmbeddingRequest(BaseModel):
    preset_id: str = "gpt2-small"
    prompt: str = Field(..., max_length=4000)
    # Positions in the BOS-prepended token list (position 0 is BOS). Checked
    # against the prompt at run time: a bad position is a 422.
    positions: list[int] = Field(..., min_length=1, max_length=64)


class EmbeddingPosition(BaseModel):
    position: int
    token: str
    # hook_embed: the token's own vector (the same wherever the token sits).
    embed: list[float]
    # hook_pos_embed: the vector for this position. None when the model has no
    # learned positional embedding (rotary models such as Pythia).
    pos_embed: list[float] | None = None


class EmbeddingResponse(BaseModel):
    preset_id: str
    prompt: str
    tokens: list[str] = Field(default_factory=list)
    positions: list[EmbeddingPosition] = Field(default_factory=list)
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
    # MF-2: the token whose logit the bars explain (one token; default = the
    # top guess) and an optional contrast token (the bars then explain the
    # difference between the two logits).
    answer_token: str | None = Field(default=None, max_length=200)
    contrast_token: str | None = Field(default=None, max_length=200)


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
    # MF-2 / MF-2b. answer_token: the token the bars explain; contrast_token:
    # the token subtracted (None without a contrast).
    answer_token: str = ""
    contrast_token: str | None = None
    # Sum of every bar, in logits.
    bars_total: float = 0.0
    answer_logit: float = 0.0
    contrast_logit: float | None = None
    # answer_logit, or answer_logit - contrast_logit with a contrast.
    actual: float = 0.0
    # actual - bars_total: the part no bar is drawn for.
    gap: float = 0.0
    # embedding_direct: the token + positional embedding's own direct path
    # through the frozen final LayerNorm. biases: the attention-output biases
    # (b_O) and the unembedding bias (b_U). On models without an output soft
    # cap they sum to gap.
    gap_parts: dict[str, float] = Field(default_factory=dict)
    # False only for post-norm models (Gemma 2) until their numbers have been
    # checked against the real weights (inference.POST_NORM_VERIFIED).
    real_weights_verified: bool = True
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
    # MF-4: also steer a norm-matched control feature at the same strength.
    control: bool = False


class SteerCoherence(BaseModel):
    """Mean log-probability per token (nats) of each continuation given the
    prompt, prompt tokens excluded, scored by the unsteered model. None when
    the continuation has fewer than 5 tokens."""
    original: float | None = None
    steered: float | None = None


class SteerScale(BaseModel):
    """The steering strength beside the feature's own activation over this
    prompt's positions (BOS excluded)."""
    strength: float
    activation_p50: float
    activation_p99: float
    activation_max: float


class SteerTopChange(BaseModel):
    token: str
    original_prob: float
    steered_prob: float
    delta: float


class SteerControl(BaseModel):
    """The same steering with a control feature in place of the chosen one."""
    feature_id: int
    # Decoder norms of the control and the steered feature, and the cosine
    # between their decoder directions.
    decoder_norm: float
    steered_decoder_norm: float
    cosine: float
    # "norm_matched_lowest_cos", or "nearest_norm" when no sampled feature was
    # within 20% of the steered feature's decoder norm.
    method: str
    generation: str = ""
    changed_token_indices: list[int] = Field(default_factory=list)
    coherence: SteerCoherence = Field(default_factory=SteerCoherence)
    top_predictions: list[TopPrediction] = Field(default_factory=list)
    # Next-token probabilities that moved most against the original run.
    top_changed: list[SteerTopChange] = Field(default_factory=list)


class SteerResponse(BaseModel):
    preset_id: str
    prompt: str
    feature_id: int
    alpha: float
    # MF-5 echo: the layer steered.
    sae_layer: int | None = None
    original_generation: str = ""
    steered_generation: str = ""
    original_top_predictions: list[TopPrediction] = Field(default_factory=list)
    steered_top_predictions: list[TopPrediction] = Field(default_factory=list)
    # Token indices (0 = first new token) of the steered continuation that
    # differ from the original continuation at the same index.
    changed_token_indices: list[int] = Field(default_factory=list)
    coherence: SteerCoherence = Field(default_factory=SteerCoherence)
    scale: SteerScale | None = None
    control: SteerControl | None = None
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
    # MF-5 echo: what was knocked out (one of the two is set).
    ablations: list["AblationTarget"] | None = None
    feature_ablations: list["FeatureAblationTarget"] | None = None
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
    # (patched - corrupted) / (clean - corrupted); None when the clean and
    # corrupted logits are within 0.1 of each other.
    share: float | None = None


class PatchResponse(BaseModel):
    preset_id: str
    clean_prompt: str
    corrupted_prompt: str
    patch_type: str
    target_token_index: int = 0
    clean_predicted_token: str = ""
    corrupted_predicted_token: str = ""
    # MF-3: the token whose logit is measured (the clean run's top guess) and
    # its logit in the clean and corrupted runs.
    target_token: str = ""
    clean_logit: float = 0.0
    corrupted_logit: float = 0.0
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
    # Word position to explain; None = the last word.
    target_token_index: int | None = Field(default=None, ge=0)


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
    # See DLAResponse.real_weights_verified.
    real_weights_verified: bool = True
    timing_ms: dict[str, float] = Field(default_factory=dict)
    status: str = "ok"


# Forward references (LoadProgressEvent -> SAERef, AblateResponse -> targets).
LoadProgressEvent.model_rebuild()
AblateResponse.model_rebuild()
