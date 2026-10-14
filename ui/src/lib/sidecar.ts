import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './is-tauri';
import { sidecarErrorMessage } from './sidecar-errors';
import type { SidecarHealth } from './types';
import { buildConceptSearchBody, parseConceptSearch, type ConceptSearchResult } from './concept-search';
import { hfIdOf, isCustomPresetId } from './custom-models';

// Browser dev only (`npm run dev` against a manually started sidecar). Under
// Tauri we never fall back to this: the port and token come from Rust.
const DEV_BASE =
  (import.meta.env.VITE_PRY_SIDECAR as string | undefined) ?? 'http://127.0.0.1:8765';

export const ENGINE_NOT_RUNNING =
  "Pry's engine isn't running. Use Restart engine at the top of the window to start it again.";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class SidecarError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'SidecarError';
  }
}

// ---------------------------------------------------------------------------
// Connection: {base_url, token} cached as one pair (contract §3)
// ---------------------------------------------------------------------------

interface Connection {
  base: string;
  token: string | null;
}

let connectionPromise: Promise<Connection> | null = null;
let listenersAttached = false;
// The Tauri setup hook launches the sidecar asynchronously, so the first
// `sidecar_connection` call can race it. Poll for up to ~30 s on cold start.
let retryAttempts = 40;
let retryDelayMs = 750;

/** Drop the cached {base_url, token}; the next request re-fetches it. */
export function invalidateSidecarConnection(): void {
  connectionPromise = null;
}

function attachLifecycleListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  // The token changes on every engine launch.
  void listen('sidecar:crashed', invalidateSidecarConnection).catch(() => {});
  void listen('sidecar:restarted', invalidateSidecarConnection).catch(() => {});
}

async function resolveConnection(): Promise<Connection> {
  if (!isTauri()) return { base: DEV_BASE, token: null };
  attachLifecycleListeners();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const c = await invoke<{ base_url: string; token: string }>('sidecar_connection');
      return { base: c.base_url, token: c.token };
    } catch (e) {
      lastErr = e;
      if (attempt < retryAttempts - 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  console.warn('[sidecar] sidecar_connection failed:', lastErr);
  throw new SidecarError(ENGINE_NOT_RUNNING, undefined, String(lastErr ?? ''));
}

function getConnection(): Promise<Connection> {
  if (!connectionPromise) {
    const p = resolveConnection();
    connectionPromise = p;
    // Never cache a failure: a later call may find the engine up.
    p.catch(() => {
      if (connectionPromise === p) connectionPromise = null;
    });
  }
  return connectionPromise;
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

function send(conn: Connection, path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (conn.token) headers.set('X-Pry-Token', conn.token);
  return fetch(`${conn.base}${path}`, { ...init, headers });
}

/**
 * `fetch` against the sidecar with the auth token attached. On a 403 (stale
 * token) or a network failure under Tauri (engine restarted on a new port),
 * re-fetches the {base_url, token} pair once and retries once.
 */
export async function sidecarFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let conn = await getConnection();
  let res: Response;
  try {
    res = await send(conn, path, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    if (!isTauri()) {
      throw new SidecarError(`Pry's engine is unreachable at ${conn.base}. Is the Python sidecar running?`);
    }
    invalidateSidecarConnection();
    conn = await getConnection();
    try {
      return await send(conn, path, init);
    } catch (e2) {
      if (isAbort(e2)) throw e2;
      throw new SidecarError(ENGINE_NOT_RUNNING);
    }
  }
  if (res.status === 403 && isTauri()) {
    invalidateSidecarConnection();
    conn = await getConnection();
    res = await send(conn, path, init);
  }
  return res;
}

async function errorFromResponse(res: Response, path: string): Promise<SidecarError> {
  const body = await res.text().catch(() => '');
  return new SidecarError(
    sidecarErrorMessage(body) ?? `Pry's engine responded with HTTP ${res.status} on ${path}`,
    res.status,
    body,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await sidecarFetch(path, init);
  if (!res.ok) throw await errorFromResponse(res, path);
  return res.json() as Promise<T>;
}

/** Test hook: shrink the cold-start retry loop. */
export function _setConnectionRetryForTests(attempts: number, delayMs: number): void {
  retryAttempts = attempts;
  retryDelayMs = delayMs;
  connectionPromise = null;
}

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

// Re-export shared types so callers can import from either sidecar or types
export type { FeatureHit, TokenFeatures, TokenInfo, AttentionLayer, GenerateResponse, SAEFeaturesResponse, LogitLensResponse, DLAResponse, SteerResponse, AblateResponse, PatchResponse, CircuitResponse, EmbeddingRequest, EmbeddingResponse, EmbeddingPosition, SAERef } from './types';

/**
 * Whether a DLA or circuit result was checked against the real model weights.
 * A missing field (older engine) counts as verified.
 */
export function realWeightsVerified(r: { real_weights_verified?: boolean } | null | undefined): boolean {
  return r?.real_weights_verified !== false;
}

/** @deprecated Use TokenFeatures from ./types */
export type SaeFeatureRow = import('./types').TokenFeatures;

export interface PresetInfo {
  id: string;
  tier: string;
  downloaded: boolean;
  available_sae_layers?: number[];
  default_sae_layer?: number;
  display?: import('./types').PresetDisplay | null;
  cpu_ok?: boolean;
}

export interface ModelList {
  loaded: string[];
  active: string | null;
  available: PresetInfo[];
}

export type LoadStage =
  | 'warmup'
  | 'check_files'
  | 'download_model'
  | 'load_model'
  | 'to_device'
  | 'download_sae'
  | 'load_sae'
  | 'ready'
  | 'already_loaded'
  | 'error';

export interface LoadProgress {
  preset_id?: string;
  /** A known LoadStage; older or newer engines may send other names. */
  stage: LoadStage | (string & {});
  message: string;
  progress: number;
  /** Seconds spent in the current stage so far (sent on heartbeat events). */
  elapsed_s?: number;
  bytes_done?: number;
  /** Older engines name the byte count this way. */
  bytes_downloaded?: number;
  bytes_total?: number;
  /** MF-5, on ready / already_loaded only: resolved snapshot hash of the weights (omitted when unknown). */
  model_revision?: string;
  /** MF-5, on ready / already_loaded only: the SAE in use (omitted for a custom model). */
  sae?: import('./types').SAERef;
}

// ---------------------------------------------------------------------------
// Request body builders (plan T4-ts, C4-9)
//
// One pure function per analysis endpoint, returning the JSON body exactly as
// the app sends it (KEEP IN SYNC: sidecar/pry_sidecar/schemas.py *Request).
// The app's calls below use them, and lessons:compile / T6a's row requests
// import them, so a row request and the app's request for the same action
// produce the same request key (lessons/registry/request-key.ts). Optional
// fields are left out unless set, so the bodies match 0.3.8's byte for byte.
// No cache here: calls with Lessons off go straight to the engine.
// ---------------------------------------------------------------------------

export interface GenerateRequestArgs {
  presetId: string;
  prompt: string;
  /** 0 = analyse only (the Run button). */
  maxNewTokens?: number;
  topKFeatures?: number;
  saeLayer?: number;
  temperature?: number;
  seed?: number | null;
}

export function buildGenerateRequest(a: GenerateRequestArgs) {
  return {
    preset_id: a.presetId,
    prompt: a.prompt,
    max_new_tokens: a.maxNewTokens ?? 0,
    ...(a.temperature !== undefined ? { temperature: a.temperature } : {}),
    ...(a.seed != null ? { seed: a.seed } : {}),
    top_k_features: a.topKFeatures ?? 5,
    ...(a.saeLayer !== undefined ? { sae_layer: a.saeLayer } : {}),
  };
}

export function buildSaeFeaturesRequest(a: {
  presetId: string;
  prompt: string;
  saeLayer: number;
  topKFeatures?: number;
}) {
  return {
    preset_id: a.presetId,
    prompt: a.prompt,
    sae_layer: a.saeLayer,
    top_k_features: a.topKFeatures ?? 5,
  };
}

export function buildLogitLensRequest(a: { presetId: string; prompt: string }) {
  return { preset_id: a.presetId, prompt: a.prompt };
}

export interface DLARequestArgs {
  presetId: string;
  prompt: string;
  targetTokenIndex?: number;
  /** MF-2: the token whose logit the bars explain (default: the top guess). */
  answerToken?: string | null;
  /** MF-2: a token to subtract; the bars then explain the difference. */
  contrastToken?: string | null;
}

export function buildDLARequest(a: DLARequestArgs) {
  return {
    preset_id: a.presetId,
    prompt: a.prompt,
    ...(a.targetTokenIndex !== undefined ? { target_token_index: a.targetTokenIndex } : {}),
    ...(a.answerToken != null ? { answer_token: a.answerToken } : {}),
    ...(a.contrastToken != null ? { contrast_token: a.contrastToken } : {}),
  };
}

export function buildEmbeddingRequest(a: {
  presetId: string;
  prompt: string;
  /** Positions in the BOS-prepended token list (0 is BOS). */
  positions: number[];
}): import('./types').EmbeddingRequest {
  return { preset_id: a.presetId, prompt: a.prompt, positions: [...a.positions] };
}

export interface SteerRequestArgs {
  presetId: string;
  prompt: string;
  featureId: number;
  saeLayer: number;
  alpha: number;
  maxNewTokens?: number;
  /** MF-4: also steer a norm-matched control feature at the same strength. */
  control?: boolean;
}

export function buildSteerRequest(a: SteerRequestArgs) {
  return {
    preset_id: a.presetId,
    prompt: a.prompt,
    feature_id: a.featureId,
    sae_layer: a.saeLayer,
    alpha: a.alpha,
    max_new_tokens: a.maxNewTokens ?? 50,
    ...(a.control ? { control: true } : {}),
  };
}

export function buildAblateHeadsRequest(a: {
  presetId: string;
  prompt: string;
  ablations: { layer: number; head: number }[];
}) {
  return {
    preset_id: a.presetId,
    prompt: a.prompt,
    ablations: a.ablations.map((t) => ({ layer: t.layer, head: t.head })),
  };
}

export function buildAblateFeaturesRequest(a: {
  presetId: string;
  prompt: string;
  featureAblations: { feature_index: number; layer: number }[];
}) {
  return {
    preset_id: a.presetId,
    prompt: a.prompt,
    feature_ablations: a.featureAblations.map((t) => ({ feature_index: t.feature_index, layer: t.layer })),
  };
}

export function buildPatchRequest(a: {
  presetId: string;
  cleanPrompt: string;
  corruptedPrompt: string;
  patchType?: 'head' | 'mlp' | 'resid';
  targetTokenIndex?: number;
}) {
  return {
    preset_id: a.presetId,
    clean_prompt: a.cleanPrompt,
    corrupted_prompt: a.corruptedPrompt,
    patch_type: a.patchType ?? 'head',
    ...(a.targetTokenIndex !== undefined ? { target_token_index: a.targetTokenIndex } : {}),
  };
}

export function buildCircuitRequest(a: {
  presetId: string;
  prompt: string;
  source?: 'dla' | 'patching';
  threshold?: number;
  targetTokenIndex?: number;
}) {
  return {
    preset_id: a.presetId,
    prompt: a.prompt,
    source: a.source ?? 'dla',
    ...(a.threshold !== undefined ? { threshold: a.threshold } : {}),
    ...(a.targetTokenIndex !== undefined ? { target_token_index: a.targetTokenIndex } : {}),
  };
}

export function buildHeadScoresRequest(a: { presetId: string }) {
  return { preset_id: a.presetId };
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function health(): Promise<SidecarHealth> {
  return request('/health');
}

export async function listModels(): Promise<ModelList> {
  return request('/models');
}

export async function getActivePreset(): Promise<string | null> {
  const models = await listModels();
  return models.active;
}

/**
 * Load a preset via the sidecar's SSE /load endpoint.
 *
 * Streams progress events to `onProgress` and resolves on stages
 * `ready` or `already_loaded`. Rejects with the error message on
 * `stage === 'error'`, with 'load ended early' if the stream closes before
 * either, or with an AbortError if the signal fires.
 *
 * Single source of truth for the SSE parser — consumed by both
 * welcome/downloading and the main app auto-load/switch flow.
 */
export async function loadPreset(
  presetId: string,
  onProgress: (ev: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await sidecarFetch('/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // T32: a custom model loads by its HF id, without a feature dictionary.
    body: JSON.stringify(
      isCustomPresetId(presetId) ? { custom: { hf_id: hfIdOf(presetId) } } : { preset_id: presetId },
    ),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res, '/load');
  if (!res.body) throw new SidecarError("Pry's engine sent an empty response to /load");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.replace(/^data:\s*/gm, '').trim();
        if (!line) continue;
        let ev: LoadProgress;
        try {
          ev = JSON.parse(line) as LoadProgress;
        } catch {
          continue;
        }
        onProgress(ev);
        if (ev.stage === 'error') {
          throw new SidecarError(ev.message || 'load failed');
        }
        if (ev.stage === 'ready' || ev.stage === 'already_loaded') {
          return;
        }
      }
    }
    // The stream closed without `ready` or `error`: the model isn't loaded.
    throw new SidecarError('load ended early');
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader may already be released after abort — safe to ignore
    }
  }
}

export async function switchSaeLayer(
  presetId: string,
  prompt: string,
  saeLayer: number,
  topKFeatures: number = 5,
): Promise<import('./types').SAEFeaturesResponse> {
  return request('/sae-features', postJson(buildSaeFeaturesRequest({ presetId, prompt, saeLayer, topKFeatures })));
}

export async function unloadPreset(
  presetId: string,
): Promise<{ preset_id: string; unloaded: boolean }> {
  return request('/unload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset_id: presetId }),
  });
}

export async function fetchLogitLens(
  presetId: string,
  prompt: string,
): Promise<import('./types').LogitLensResponse> {
  return request('/logit-lens', postJson(buildLogitLensRequest({ presetId, prompt })));
}

export async function fetchDLA(
  presetId: string,
  prompt: string,
  targetTokenIndex?: number,
  opts: { answerToken?: string | null; contrastToken?: string | null } = {},
): Promise<import('./types').DLAResponse> {
  return request('/dla', postJson(buildDLARequest({ presetId, prompt, targetTokenIndex, ...opts })));
}

/** TN-1: token and positional embedding vectors at `positions` (0 is BOS). */
export async function fetchEmbedding(
  presetId: string,
  prompt: string,
  positions: number[],
): Promise<import('./types').EmbeddingResponse> {
  return request('/embedding', postJson(buildEmbeddingRequest({ presetId, prompt, positions })));
}

export async function steerGenerate(
  presetId: string,
  prompt: string,
  featureId: number,
  saeLayer: number,
  alpha: number,
  maxNewTokens: number = 50,
  control: boolean = false,
): Promise<import('./types').SteerResponse> {
  return request(
    '/steer',
    postJson(buildSteerRequest({ presetId, prompt, featureId, saeLayer, alpha, maxNewTokens, control })),
  );
}

/** T26: write a continuation and get each step's chosen token + runner-up. */
export async function generateStepwise(
  presetId: string,
  prompt: string,
  opts: { maxNewTokens: number; temperature: number; seed?: number | null },
): Promise<import('./types').GenerateResponse> {
  return request(
    '/generate',
    postJson(
      buildGenerateRequest({
        presetId,
        prompt,
        maxNewTokens: opts.maxNewTokens,
        temperature: opts.temperature,
        seed: opts.seed,
        topKFeatures: 1,
      }),
    ),
  );
}

/**
 * T24: find features whose Neuronpedia label matches `query`. The sidecar
 * sends the query to neuronpedia.org. A 502 SidecarError means Neuronpedia
 * is unreachable (see isNeuronpediaUnavailable).
 */
export async function searchConcepts(
  query: string,
  presetId?: string | null,
): Promise<ConceptSearchResult> {
  const json = await request<unknown>('/concept-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildConceptSearchBody(query, presetId),
  });
  return parseConceptSearch(json);
}

export async function ablateHeads(
  presetId: string,
  prompt: string,
  ablations: { layer: number; head: number }[],
): Promise<import('./types').AblateResponse> {
  return request('/ablate-head', postJson(buildAblateHeadsRequest({ presetId, prompt, ablations })));
}

export async function ablateFeatures(
  presetId: string,
  prompt: string,
  featureAblations: { feature_index: number; layer: number }[],
): Promise<import('./types').AblateResponse> {
  return request('/ablate-feature', postJson(buildAblateFeaturesRequest({ presetId, prompt, featureAblations })));
}

export async function runPatching(
  presetId: string,
  cleanPrompt: string,
  corruptedPrompt: string,
  patchType: 'head' | 'mlp' | 'resid' = 'head',
  targetTokenIndex?: number,
): Promise<import('./types').PatchResponse> {
  return request(
    '/patch',
    postJson(buildPatchRequest({ presetId, cleanPrompt, corruptedPrompt, patchType, targetTokenIndex })),
  );
}

export async function fetchCircuit(
  presetId: string,
  prompt: string,
  source: 'dla' | 'patching' = 'dla',
  threshold?: number,
  targetTokenIndex?: number,
): Promise<import('./types').CircuitResponse> {
  return request('/circuit', postJson(buildCircuitRequest({ presetId, prompt, source, threshold, targetTokenIndex })));
}

/** Induction + previous-token score for every head, on the sidecar's fixed repeated test sequence. */
export async function fetchHeadScores(
  presetId: string,
): Promise<import('./types').HeadScoresResponse> {
  return request('/head-scores', postJson(buildHeadScoresRequest({ presetId })));
}

// ---------------------------------------------------------------------------
// Custom models (T32)
// KEEP IN SYNC: sidecar/pry_sidecar/custom_models.py::assess_config
// ---------------------------------------------------------------------------

/** What the sidecar found when it checked a HuggingFace model. */
export interface CustomModelCheck {
  /** The repo id in TransformerLens' spelling (use this one from now on). */
  hf_id: string;
  supported: boolean;
  architecture: string;
  /** Plain-language summary; says why when `supported` is false. */
  message: string;
  n_params: number | null;
  params_label: string | null;
  n_layers: number | null;
  n_heads: number | null;
  vram_estimate_mb: number | null;
  cpu_ok: boolean;
  gated: boolean;
}

/** The model couldn't be checked at all (gated, missing, offline). */
export class CustomModelCheckError extends Error {
  constructor(
    message: string,
    public readonly gated: boolean,
  ) {
    super(message);
    this.name = 'CustomModelCheckError';
  }
}

/**
 * Ask the engine whether Pry can load `hfId`: it fetches the repo's
 * config.json, checks the architecture against TransformerLens and estimates
 * the size. Throws CustomModelCheckError with a plain message when the repo
 * can't be checked (gated without access, not found, offline).
 */
export async function checkCustomModel(hfId: string): Promise<CustomModelCheck> {
  const res = await sidecarFetch('/custom-models/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hf_id: hfId }),
  });
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; gated?: boolean };
    throw new CustomModelCheckError(body.error ?? "Couldn't check this model.", body.gated === true);
  }
  if (!res.ok) throw await errorFromResponse(res, '/custom-models/validate');
  return res.json() as Promise<CustomModelCheck>;
}
