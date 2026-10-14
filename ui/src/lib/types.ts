// KEEP IN SYNC: src-tauri/src/... / sidecar/pry_sidecar/schemas.py

export interface TokenInfo {
  index: number;
  text: string;
}

export interface AttentionLayer {
  layer: number;
  /** heads[head][query][key] — shape: n_heads × seq × seq */
  heads: number[][][];
}

export interface FeatureHit {
  id: number;
  activation: number;
  description: string | null;
  /** How much detail the feature's label has (based on label length, not accuracy). */
  label_detail?: 'detailed' | 'short' | 'none' | null;
  /** @deprecated One-release alias for `label_detail` (high→detailed, medium/low→short). */
  confidence?: 'high' | 'medium' | 'low' | 'none' | null;
  /** Top-activating example snippets from Neuronpedia — may be absent on older responses */
  top_activating_snippets?: string[];
}

export interface TokenFeatures {
  token_index: number;
  top_k: FeatureHit[];
}

export interface TopPrediction {
  token: string;
  probability: number;
  rank: number;
  /** The raw score before softmax (MF-1): probability = softmax(logits)[token]. */
  logit?: number | null;
}

/** Which SAE (feature dictionary) a result came from (MF-5). */
export interface SAERef {
  release: string;
  id: string;
}

export interface GenerateResponse {
  preset_id: string;
  prompt: string;
  tokens: TokenInfo[];
  attention: AttentionLayer[];
  /** True when attention was only captured for the first 64 tokens. */
  attention_truncated?: boolean;
  sae_features: TokenFeatures[];
  /** null for a custom model (T32): it has no feature dictionary. */
  sae_layer_used: number | null;
  top_predictions?: TopPrediction[];
  timing_ms: Record<string, number>;
  status?: string;
  generation?: string | null;
  /** T26: one entry per written token (empty when max_new_tokens is 0). */
  generation_steps?: GenerationStep[];
  temperature_used?: number;
  /** Seed of the random draws; set only when temperature_used > 0. */
  seed_used?: number | null;
  /** MF-5: resolved Hugging Face snapshot hash of the weights (null if unknown). */
  model_revision?: string | null;
  /** MF-5: the SAE in use (null for a custom model). */
  sae?: SAERef | null;
}

/**
 * One written token of a continuation (T26). Chances come from the softmax at
 * the sampling temperature; at temperature 0 they are the model's plain chances.
 * `runner_up` is the most likely token other than the chosen one.
 */
export interface GenerationStep {
  token: string;
  token_id: number;
  /** What this step adds to the decoded text ("" mid-character, e.g. part of an emoji). */
  text?: string;
  probability: number;
  runner_up: string | null;
  runner_up_probability: number | null;
}

export interface SAEFeaturesResponse {
  preset_id: string;
  prompt: string;
  tokens: TokenInfo[];
  sae_features: TokenFeatures[];
  sae_layer_used: number;
  timing_ms: Record<string, number>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Embedding reader (TN-1, POST /embedding)
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  preset_id: string;
  prompt: string;
  /** Positions in the BOS-prepended token list (0 is BOS); 1-64 of them. */
  positions: number[];
}

export interface EmbeddingPosition {
  position: number;
  token: string;
  /** hook_embed: the token's own vector (the same wherever the token sits). */
  embed: number[];
  /** hook_pos_embed: this position's vector; null for rotary models (no learned positional embedding). */
  pos_embed: number[] | null;
}

export interface EmbeddingResponse {
  preset_id: string;
  prompt: string;
  tokens: string[];
  positions: EmbeddingPosition[];
  status: string;
}

// ---------------------------------------------------------------------------
// Logit Lens (Phase B4)
// ---------------------------------------------------------------------------

export interface LogitLensCell {
  predicted_token: string;
  probability: number;
  matches_final: boolean;
}

/** A tracked token at one layer, last position. rank 1 = the layer's top token. */
export interface LogitLensTracked {
  prob: number;
  logit: number;
  rank: number;
}

export interface LogitLensResponse {
  preset_id: string;
  prompt: string;
  tokens: TokenInfo[];
  /** grid[layer][token_pos] */
  grid: LogitLensCell[][];
  /** tracked[layer][token], last position; only when the request sent track_tokens. */
  tracked?: Record<string, LogitLensTracked>[];
  n_layers: number;
  timing_ms: Record<string, number>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Direct Logit Attribution (Phase B5)
// ---------------------------------------------------------------------------

export interface DLAComponent {
  name: string;
  type: 'attention' | 'mlp';
  layer: number;
  head: number | null;
  contribution: number;
}

export interface DLAResponse {
  preset_id: string;
  prompt: string;
  tokens: TokenInfo[];
  target_token_index: number;
  target_token: string;
  predicted_token: string;
  components: DLAComponent[];
  /** MF-2: the token whose logit the bars explain. */
  answer_token?: string;
  /** MF-2: the token subtracted; null without a contrast. */
  contrast_token?: string | null;
  /** MF-2b: sum of every bar, in logits. */
  bars_total?: number;
  answer_logit?: number;
  /** null without a contrast. */
  contrast_logit?: number | null;
  /** answer_logit, or answer_logit - contrast_logit with a contrast. */
  actual?: number;
  /** actual - bars_total: the part no bar is drawn for. */
  gap?: number;
  /**
   * Named parts of the gap: `embedding_direct` (token + positional embedding's
   * direct path through the frozen final LayerNorm) and `biases` (b_O and b_U).
   * schemas.py types it dict[str, float].
   */
  gap_parts?: Record<string, number>;
  timing_ms: Record<string, number>;
  status?: string;
  /**
   * False only for a post-norm model (Gemma 2) whose numbers haven't been
   * checked against the real weights yet. Older engines omit it, which means
   * true; read it with `realWeightsVerified()` from `sidecar.ts`.
   */
  real_weights_verified?: boolean;
}

// ---------------------------------------------------------------------------
// Feature Steering (Phase C7)
// ---------------------------------------------------------------------------

/**
 * Mean log-probability per token (nats) of each continuation given the prompt,
 * prompt tokens excluded, scored by the unsteered model. null under 5 tokens.
 */
export interface SteerCoherence {
  original: number | null;
  steered: number | null;
}

/** The steering strength beside the feature's activation over this prompt's positions (BOS excluded). */
export interface SteerScale {
  strength: number;
  activation_p50: number;
  activation_p99: number;
  activation_max: number;
}

export interface SteerTopChange {
  token: string;
  original_prob: number;
  steered_prob: number;
  delta: number;
}

/** The same steering with a norm-matched control feature in place of the chosen one. */
export interface SteerControl {
  feature_id: number;
  decoder_norm: number;
  steered_decoder_norm: number;
  /** Cosine between the control's and the steered feature's decoder directions. */
  cosine: number;
  /** "norm_matched_lowest_cos", or "nearest_norm" when no sampled feature was within 20%. */
  method: string;
  generation: string;
  changed_token_indices: number[];
  coherence: SteerCoherence;
  top_predictions: TopPrediction[];
  /** Next-token probabilities that moved most against the original run. */
  top_changed: SteerTopChange[];
}

export interface SteerResponse {
  preset_id: string;
  prompt: string;
  feature_id: number;
  alpha: number;
  /** MF-5 echo: the layer steered. */
  sae_layer?: number | null;
  original_generation: string;
  steered_generation: string;
  original_top_predictions: TopPrediction[];
  steered_top_predictions: TopPrediction[];
  /** Indices (0 = first new token) of steered tokens that differ from the original at the same index. */
  changed_token_indices?: number[];
  coherence?: SteerCoherence;
  scale?: SteerScale | null;
  /** Set only when the request asked for `control: true`. */
  control?: SteerControl | null;
  timing_ms: Record<string, number>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Head Ablation (Phase C8) & Feature Ablation (Phase C9)
// ---------------------------------------------------------------------------

export interface AblationPrediction {
  token: string;
  probability: number;
  rank: number;
}

export interface AblationTarget {
  layer: number;
  head: number;
}

export interface FeatureAblationTarget {
  feature_index: number;
  layer: number;
}

export interface PredictionDelta {
  token: string;
  original_prob: number;
  ablated_prob: number;
  delta: number;
}

export interface AblateResponse {
  preset_id: string;
  prompt: string;
  original_predictions: AblationPrediction[];
  ablated_predictions: AblationPrediction[];
  prediction_delta: PredictionDelta[];
  /** MF-5 echo: the heads knocked out (head ablation only, else null). */
  ablations?: AblationTarget[] | null;
  /** MF-5 echo: the features knocked out (feature ablation only, else null). */
  feature_ablations?: FeatureAblationTarget[] | null;
  timing_ms: Record<string, number>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Activation Patching (Phase D10)
// ---------------------------------------------------------------------------

export interface PatchComponent {
  name: string;
  layer: number;
  head: number | null;
  /** Token position patched (residual patching only). */
  position?: number | null;
  effect: number;
  clean_logit: number;
  corrupted_logit: number;
  patched_logit: number;
  /** (patched - corrupted) / (clean - corrupted); null when clean and corrupted are within 0.1 logits. */
  share?: number | null;
}

export interface PatchResponse {
  preset_id: string;
  clean_prompt: string;
  corrupted_prompt: string;
  patch_type: string;
  target_token_index: number;
  clean_predicted_token: string;
  corrupted_predicted_token: string;
  /** MF-3: the token whose logit is measured (the clean run's top guess). */
  target_token?: string;
  /** MF-3: target_token's logit in the clean run. */
  clean_logit?: number;
  /** MF-3: target_token's logit in the corrupted run. */
  corrupted_logit?: number;
  /** Clean prompt's tokens; labels the residual layer x position grid. */
  tokens?: string[];
  components: PatchComponent[];
  timing_ms: Record<string, number>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Circuit Subgraph Visualization (Phase D11)
// ---------------------------------------------------------------------------

export interface CircuitNode {
  id: string;
  type: 'attention' | 'mlp';
  layer: number;
  head: number | null;
  importance: number;
}

export interface CircuitEdge {
  source: string;
  target: string;
  weight: number;
}

export interface CircuitResponse {
  preset_id: string;
  prompt: string;
  threshold: number;
  source: string;
  nodes: CircuitNode[];
  edges: CircuitEdge[];
  /**
   * How edges were computed. "direct_value_path": signed weight (logits of the
   * predicted word) of the source's output passed straight through the target
   * head's value path; Q/K composition excluded. "none": no edges reported.
   */
  edges_method?: string;
  /** Edges with |weight| below this were dropped. */
  edge_threshold?: number;
  timing_ms: Record<string, number>;
  status?: string;
  /**
   * False only for a post-norm model (Gemma 2) whose numbers haven't been
   * checked against the real weights yet. Older engines omit it, which means
   * true; read it with `realWeightsVerified()` from `sidecar.ts`.
   */
  real_weights_verified?: boolean;
}

// ---------------------------------------------------------------------------
// Head scores: induction + previous-token heads (T20, POST /head-scores)
// ---------------------------------------------------------------------------

export interface HeadScore {
  layer: number;
  head: number;
  /** Mean attention (0-1) from each second-copy token to the token that came next after its first copy. */
  induction: number;
  /** Mean attention (0-1) from each token to the token just before it. */
  previous_token: number;
}

export interface HeadScoresResponse {
  preset_id: string;
  n_layers: number;
  n_heads: number;
  /** Length of each copy in the test sequence. */
  repeat_len: number;
  /** The test sequence (no BOS): repeat_len random tokens, then the same again. */
  sequence_tokens: string[];
  previous_token_source: 'repeated_sequence' | 'prompt';
  /** Every head, layer-major. */
  scores: HeadScore[];
  /** Highest first. */
  top_induction: HeadScore[];
  /** Highest first. */
  top_previous_token: HeadScore[];
  timing_ms: Record<string, number>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Preset display metadata (Phase 2 contract §1/§2): passthrough of the
// presets.json `display` block via Rust `PresetCompatibility.display` and
// sidecar `/models` `available[].display`.
// ---------------------------------------------------------------------------

export interface PresetDisplay {
  name: string;
  blurb: string;
  params: string;
  size_label: string;
  n_layers: number;
  n_heads: number;
  /** Neuronpedia model slug; null when Neuronpedia has no coverage. */
  neuronpedia_model_id: string | null;
  /** Neuronpedia SAE set suffix (e.g. "res-jb"); null when none. */
  neuronpedia_release_suffix: string | null;
  recommended: boolean;
}

// ---------------------------------------------------------------------------
// Sidecar /health (Phase 2 contract §4)
// ---------------------------------------------------------------------------

export interface SidecarHealth {
  status: string;
  version: string;
  device?: 'cuda' | 'cpu' | null;
  gpu_name?: string | null;
  torch?: string;
  cuda?: string | null;
  loaded_preset?: string | null;
  sae_layer?: number | null;
  hf_token_present?: boolean;
  /** GPU memory the engine holds for the loaded model (MB); freed on a model switch. */
  vram_reserved_mb?: number | null;
  /** MF-5: analysis library versions (null when not installed). */
  transformer_lens?: string | null;
  sae_lens?: string | null;
  transformers?: string | null;
}
