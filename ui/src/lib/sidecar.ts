import { isTauri } from './is-tauri';

const FALLBACK_BASE =
  (import.meta.env.VITE_PRY_SIDECAR as string | undefined) ?? 'http://127.0.0.1:8765';

// Resolved lazily on first request — uses Tauri sidecar_url() if available.
let _resolvedBase: string | null = null;

async function getBase(): Promise<string> {
  if (_resolvedBase) return _resolvedBase;
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    // Retry loop — the Tauri setup hook spawns sidecar::launch() as an
    // async task and returns immediately, so the frontend can race the
    // sidecar startup. `sidecar_url` returns `Sidecar("not running")` until
    // the handle lands in managed state. Poll for up to ~30s before giving
    // up — cold starts are slower with the full inference stack loaded.
    const maxAttempts = 40;
    const delayMs = 750;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const base = await invoke<string>('sidecar_url');
        console.log(`[sidecar] getBase: resolved on attempt ${attempt + 1} →`, base);
        _resolvedBase = base;
        return _resolvedBase;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    // Don't cache the fallback — a later call may still succeed.
    console.warn(
      `[sidecar] getBase: sidecar_url failed after ${maxAttempts} attempts, using fallback:`,
      lastErr,
    );
    return FALLBACK_BASE;
  }
  _resolvedBase = FALLBACK_BASE;
  return _resolvedBase;
}

/** Resolves the sidecar base URL, using the Tauri sidecar_url command when available. */
export const getSidecarBase = getBase;

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, init);
  } catch (err) {
    throw new SidecarError(
      `Sidecar unreachable at ${base}${path} — is the Python sidecar running?`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SidecarError(
      `Sidecar responded with HTTP ${res.status} on ${path}`,
      res.status,
      body,
    );
  }

  return res.json() as Promise<T>;
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

export async function health(): Promise<{ status: string; version: string }> {
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
  const base = await getBase();
  const res = await fetch(`${base}/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset_id: presetId }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new SidecarError(
      `sidecar /load returned ${res.status}`,
      res.status,
    );
  }
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
