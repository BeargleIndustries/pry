import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './is-tauri';
import { sidecarErrorMessage } from './sidecar-errors';
import type { SidecarHealth } from './types';
import { buildConceptSearchBody, parseConceptSearch, type ConceptSearchResult } from './concept-search';

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
export type { FeatureHit, TokenFeatures, TokenInfo, AttentionLayer, GenerateResponse, SAEFeaturesResponse, LogitLensResponse, DLAResponse, SteerResponse, AblateResponse, PatchResponse, CircuitResponse } from './types';

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
  | 'download_model'
  | 'load_model'
  | 'download_sae'
  | 'load_sae'
  | 'ready'
  | 'already_loaded'
  | 'error';

export interface LoadProgress {
  preset_id?: string;
  stage: LoadStage;
  message: string;
  progress: number;
  bytes_downloaded?: number;
  bytes_total?: number;
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
 * `stage === 'error'`, or with an AbortError if the signal fires.
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
    body: JSON.stringify({ preset_id: presetId }),
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
  return request('/sae-features', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      prompt,
      sae_layer: saeLayer,
      top_k_features: topKFeatures,
    }),
  });
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
  return request('/logit-lens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset_id: presetId, prompt }),
  });
}

export async function fetchDLA(
  presetId: string,
  prompt: string,
  targetTokenIndex?: number,
): Promise<import('./types').DLAResponse> {
  return request('/dla', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      prompt,
      ...(targetTokenIndex !== undefined ? { target_token_index: targetTokenIndex } : {}),
    }),
  });
}

export async function steerGenerate(
  presetId: string,
  prompt: string,
  featureId: number,
  saeLayer: number,
  alpha: number,
  maxNewTokens: number = 50,
): Promise<import('./types').SteerResponse> {
  return request('/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      prompt,
      feature_id: featureId,
      sae_layer: saeLayer,
      alpha,
      max_new_tokens: maxNewTokens,
    }),
  });
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
  return request('/ablate-head', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      prompt,
      ablations,
    }),
  });
}

export async function ablateFeatures(
  presetId: string,
  prompt: string,
  featureAblations: { feature_index: number; layer: number }[],
): Promise<import('./types').AblateResponse> {
  return request('/ablate-feature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      prompt,
      feature_ablations: featureAblations,
    }),
  });
}

export async function runPatching(
  presetId: string,
  cleanPrompt: string,
  corruptedPrompt: string,
  patchType: 'head' | 'mlp' | 'resid' = 'head',
  targetTokenIndex?: number,
): Promise<import('./types').PatchResponse> {
  return request('/patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      clean_prompt: cleanPrompt,
      corrupted_prompt: corruptedPrompt,
      patch_type: patchType,
      ...(targetTokenIndex !== undefined ? { target_token_index: targetTokenIndex } : {}),
    }),
  });
}

export async function fetchCircuit(
  presetId: string,
  prompt: string,
  source: 'dla' | 'patching' = 'dla',
  threshold?: number,
): Promise<import('./types').CircuitResponse> {
  return request('/circuit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      prompt,
      source,
      ...(threshold !== undefined ? { threshold } : {}),
    }),
  });
}

/** Induction + previous-token score for every head, on the sidecar's fixed repeated test sequence. */
export async function fetchHeadScores(
  presetId: string,
): Promise<import('./types').HeadScoresResponse> {
  return request('/head-scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset_id: presetId }),
  });
}
