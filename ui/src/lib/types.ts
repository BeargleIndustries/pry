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
  confidence: 'high' | 'medium' | 'low' | 'none' | null;
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
}

export interface GenerateResponse {
  preset_id: string;
  prompt: string;
  tokens: TokenInfo[];
  attention: AttentionLayer[];
  sae_features: TokenFeatures[];
  sae_layer_used: number;
  top_predictions?: TopPrediction[];
  timing_ms: Record<string, number>;
  status?: string;
  generation?: string | null;
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
// Logit Lens (Phase B4)
// ---------------------------------------------------------------------------

export interface LogitLensCell {
  predicted_token: string;
  probability: number;
  matches_final: boolean;
}

export interface LogitLensResponse {
  preset_id: string;
  prompt: string;
  tokens: TokenInfo[];
  /** grid[layer][token_pos] */
  grid: LogitLensCell[][];
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
  timing_ms: Record<string, number>;
  status?: string;
}

// ---------------------------------------------------------------------------
// Feature Steering (Phase C7)
// ---------------------------------------------------------------------------

export interface SteerResponse {
  preset_id: string;
  prompt: string;
  feature_id: number;
  alpha: number;
  original_generation: string;
  steered_generation: string;
  original_top_predictions: TopPrediction[];
  steered_top_predictions: TopPrediction[];
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
  effect: number;
  clean_logit: number;
  corrupted_logit: number;
  patched_logit: number;
}

export interface PatchResponse {
  preset_id: string;
  clean_prompt: string;
  corrupted_prompt: string;
  patch_type: string;
  target_token_index: number;
  clean_predicted_token: string;
  corrupted_predicted_token: string;
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
  timing_ms: Record<string, number>;
  status?: string;
}
