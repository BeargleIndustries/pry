import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from './is-tauri';
import { invalidateSidecarConnection } from './sidecar';
import type {
  RuntimeUpdateError,
  RuntimeUpdateFailureKind,
  RuntimeUpdateStatus,
} from './runtime-update';
import type { PresetDisplay } from './types';
export type { TokenInfo, AttentionLayer, FeatureHit, TokenFeatures, GenerateResponse, PresetDisplay } from './types';

// ---------------------------------------------------------------------------
// AppError — KEEP IN SYNC: src-tauri/src/error.rs::AppError
// ---------------------------------------------------------------------------

export interface AppError {
  kind: 'Sidecar' | 'Hardware' | 'Presets' | 'Io';
  detail: string;
}

function formatTauriError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'kind' in e && 'detail' in e) {
    const err = e as AppError;
    return `${err.kind.toLowerCase()}: ${err.detail}`;
  }
  return String(e);
}

// ---------------------------------------------------------------------------
// Types matching Rust structs exactly
// ---------------------------------------------------------------------------

// KEEP IN SYNC: src-tauri/src/hardware.rs::VramSource
export type VramSource = 'Nvml' | 'Dxgi' | 'None';

// KEEP IN SYNC: src-tauri/src/hardware.rs::HardwareReport
export interface HardwareReport {
  gpu_name: string;
  vram_total_mb: number;
  vram_used_mb: number | null;
  vendor: string;
  cuda_driver: string | null;
  vram_source: VramSource;
  backend: string;
  driver_version: string | null;
  probe_warnings: string[];
  probed_at: string;
  os: string;
  system_ram_mb: number | null;
}

// KEEP IN SYNC: src-tauri/src/presets_compat.rs::Compatibility
export type Verdict = 'Comfortable' | 'Tight' | 'CpuOk' | 'Insufficient';

// KEEP IN SYNC: src-tauri/src/presets_compat.rs::PresetCompatibility
export interface PresetCompatibility {
  preset_id: string;
  verdict: Verdict;
  headroom_mb: number;
  notes: string[];
  /** Passthrough of the presets.json `display` block (contract §1/§2). */
  display: PresetDisplay | null;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Mock fallback for plain `npm run dev` without Tauri
// ---------------------------------------------------------------------------

const MOCK_REPORT: HardwareReport = {
  gpu_name: 'dev mode (no tauri)',
  vram_total_mb: 8192,
  vram_used_mb: 1024,
  vendor: 'mock',
  cuda_driver: null,
  vram_source: 'None',
  backend: 'mock',
  driver_version: null,
  probe_warnings: ['Running outside Tauri — hardware data is mocked'],
  probed_at: new Date().toISOString(),
  os: 'mock',
  system_ram_mb: 16384,
};

function mockDisplay(
  name: string,
  params: string,
  size_label: string,
  n_layers: number,
  n_heads: number,
  np: [string, string] | null,
  recommended = false,
): PresetDisplay {
  return {
    name,
    blurb: `${params} params (dev mock)`,
    params,
    size_label,
    n_layers,
    n_heads,
    neuronpedia_model_id: np ? np[0] : null,
    neuronpedia_release_suffix: np ? np[1] : null,
    recommended,
  };
}

const MOCK_PRESETS: PresetCompatibility[] = [
  {
    preset_id: 'gpt2-small', verdict: 'Comfortable', headroom_mb: 7000, notes: [], enabled: true,
    display: mockDisplay('GPT-2 small', '124M', '600 MB', 12, 12, ['gpt2-small', 'res-jb'], true),
  },
  {
    preset_id: 'pythia-70m', verdict: 'CpuOk', headroom_mb: 6000, notes: ['Works on your computer (slower).'], enabled: true,
    display: mockDisplay('Pythia-70M', '70M', '350 MB', 6, 8, ['pythia-70m-deduped', 'res-sm']),
  },
  {
    preset_id: 'gemma-2-2b', verdict: 'Comfortable', headroom_mb: 2288,
    notes: ['Requires a free HuggingFace account and Gemma license acceptance.'], enabled: true,
    display: mockDisplay('Gemma 2 2B', '2.6B', '10.8 GB', 26, 8, ['gemma-2-2b', 'gemmascope-res-16k']),
  },
];

// ---------------------------------------------------------------------------
// Typed command wrappers
// ---------------------------------------------------------------------------

export async function probeHardware(): Promise<HardwareReport> {
  if (!isTauri()) {
    if (!import.meta.env.DEV) {
      throw new Error('probeHardware: not running inside Tauri');
    }
    console.warn('[tauri.ts] Not running inside Tauri — returning mock HardwareReport');
    return MOCK_REPORT;
  }
  try {
    return await invoke<HardwareReport>('probe_hardware');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function cachedHardwareReport(): Promise<HardwareReport | null> {
  if (!isTauri()) {
    console.warn('[tauri.ts] Not running inside Tauri — returning null for cached report');
    return null;
  }
  try {
    return await invoke<HardwareReport | null>('cached_hardware_report');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function evaluatePresets(hw: HardwareReport): Promise<PresetCompatibility[]> {
  if (!isTauri()) {
    if (!import.meta.env.DEV) {
      throw new Error('evaluatePresets: not running inside Tauri');
    }
    console.warn('[tauri.ts] Not running inside Tauri — returning mock preset compatibilities');
    return MOCK_PRESETS;
  }
  try {
    return await invoke<PresetCompatibility[]>('evaluate_presets', { hw });
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function sidecarUrl(): Promise<string> {
  if (!isTauri()) {
    return 'http://127.0.0.1:8765';
  }
  try {
    return await invoke<string>('sidecar_url');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function sidecarStderr(): Promise<string[]> {
  if (!isTauri()) {
    return [];
  }
  try {
    return await invoke<string[]>('sidecar_stderr');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

// ---------------------------------------------------------------------------
// Phase 5b / 8 — Bootstrap + diagnostic wrappers
// KEEP IN SYNC: src-tauri/src/bootstrap.rs + src-tauri/src/diagnostics.rs
// ---------------------------------------------------------------------------

export async function runtimeStatus(): Promise<boolean> {
  if (!isTauri()) return true; // dev mode: pretend ready
  try {
    return await invoke<boolean>('runtime_status');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function bootstrapRuntime(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('bootstrap_runtime_command');
  } catch (e) {
    throw new Error(formatTauriError(e));
  } finally {
    // Relaunches the sidecar with a new token without emitting sidecar:restarted.
    invalidateSidecarConnection();
  }
}

export async function runtimeUpdateStatus(): Promise<RuntimeUpdateStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<RuntimeUpdateStatus>('runtime_update_status');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

/** Thrown by `runtimeUpdate`; `kind` says whether an engine is still running. */
export class RuntimeUpdateFailure extends Error {
  constructor(
    message: string,
    public readonly kind: RuntimeUpdateFailureKind | 'unknown',
    public readonly logPath: string | null,
  ) {
    super(message);
    this.name = 'RuntimeUpdateFailure';
  }
}

/**
 * Build a new engine venv beside the current one, switch to it, restart the
 * sidecar. On a failed start the backend rolls back to the previous engine.
 */
export async function runtimeUpdate(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('runtime_update');
    // Relaunches the sidecar with a new token without emitting sidecar:restarted.
    invalidateSidecarConnection();
  } catch (e) {
    invalidateSidecarConnection();
    if (typeof e === 'object' && e !== null && 'kind' in e && 'message' in e) {
      const err = e as RuntimeUpdateError;
      throw new RuntimeUpdateFailure(err.message, err.kind, err.log_path ?? null);
    }
    throw new RuntimeUpdateFailure(formatTauriError(e), 'unknown', null);
  }
}

export async function onRuntimeUpdateAvailable(
  handler: (s: RuntimeUpdateStatus) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<RuntimeUpdateStatus>('runtime:update-available', (e) => handler(e.payload));
}

export async function copyDiagnostic(): Promise<string> {
  if (!isTauri()) return '(dev mode — no diagnostic)';
  try {
    return await invoke<string>('copy_diagnostic');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function listCrashLogs(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>('list_crash_logs');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function saveHfToken(token: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('save_hf_token', { token });
  } catch (e) {
    throw new Error(formatTauriError(e));
  } finally {
    // Saving/clearing the token restarts a running engine (new token).
    invalidateSidecarConnection();
  }
}

export async function hasHfToken(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('has_hf_token');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function clearHfToken(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('clear_hf_token');
  } catch (e) {
    throw new Error(formatTauriError(e));
  } finally {
    // Saving/clearing the token restarts a running engine (new token).
    invalidateSidecarConnection();
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — Custom model escape hatch
// KEEP IN SYNC: src-tauri/src/custom_models.rs::CustomPreset
// ---------------------------------------------------------------------------

export interface CustomPreset {
  id: string;
  display_name: string;
  architecture: string;
  added_at: string;
  sae_available: boolean;
}

export async function validateCustomModel(hfId: string): Promise<CustomPreset> {
  if (!isTauri()) throw new Error("custom models unavailable in dev mode");
  try {
    return await invoke<CustomPreset>("validate_custom_model", { hfId });
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function addCustomModel(hfId: string): Promise<CustomPreset> {
  if (!isTauri()) throw new Error("custom models unavailable in dev mode");
  try {
    return await invoke<CustomPreset>("add_custom_model", { hfId });
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function listCustomModels(): Promise<CustomPreset[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<CustomPreset[]>("list_custom_models");
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

export async function removeCustomModel(hfId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("remove_custom_model", { hfId });
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — sidecar connection + engine lifecycle (contract §3/§4)
// KEEP IN SYNC: src-tauri/src/sidecar.rs + lib.rs
// ---------------------------------------------------------------------------

/** Stop the current sidecar (if any) and launch a new one with a new token. */
export async function restartSidecar(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('restart_sidecar');
  } catch (e) {
    throw new Error(formatTauriError(e));
  } finally {
    invalidateSidecarConnection();
  }
}

export interface SidecarCrashedPayload {
  stderr_tail: string[] | string;
  reason: string;
}

export async function onSidecarCrashed(
  handler: (p: SidecarCrashedPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<SidecarCrashedPayload>('sidecar:crashed', (e) => handler(e.payload));
}

export async function onSidecarRestarted(
  handler: (p: { base_url: string }) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<{ base_url: string }>('sidecar:restarted', (e) => handler(e.payload));
}

// KEEP IN SYNC: src-tauri runtime_readiness (P2-10)
export type RuntimeHealth = 'missing' | 'broken' | 'update_available' | 'ok';

export interface RuntimeReadiness {
  usable: boolean;
  needs_sidecar_sync: boolean;
  health: RuntimeHealth;
}

export async function runtimeReadiness(): Promise<RuntimeReadiness> {
  if (!isTauri()) return { usable: true, needs_sidecar_sync: false, health: 'ok' };
  try {
    return await invoke<RuntimeReadiness>('runtime_readiness');
  } catch (e) {
    throw new Error(formatTauriError(e));
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — JSON export (T19). WebView2 ignores `<a download>` on blob URLs,
// so under Tauri we use the native save dialog + plugin-fs.
// ---------------------------------------------------------------------------

export function exportFileName(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return `pry-export-${ts}.json`;
}

/** Save-dialog filter plus the blob MIME type for the browser fallback. */
export interface SaveFileKind {
  name: string;
  extensions: string[];
  mime: string;
}

export const JSON_FILE: SaveFileKind = { name: 'JSON', extensions: ['json'], mime: 'application/json' };
export const HTML_FILE: SaveFileKind = { name: 'Web page', extensions: ['html'], mime: 'text/html' };

/**
 * Save `text` to a user-chosen file. Returns false when the user cancels the
 * dialog. Outside Tauri, falls back to a blob download.
 */
let saveDialogOpen = false;

export async function saveTextFile(text: string, defaultName: string, kind: SaveFileKind): Promise<boolean> {
  if (isTauri()) {
    // A second click while the dialog is up would stack another dialog.
    if (saveDialogOpen) return false;
    saveDialogOpen = true;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: kind.name, extensions: kind.extensions }],
      });
      if (!path) return false;
      await writeTextFile(path, text);
      return true;
    } finally {
      saveDialogOpen = false;
    }
  }
  const blob = new Blob([text], { type: kind.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export function saveJsonFile(json: string, defaultName = exportFileName()): Promise<boolean> {
  return saveTextFile(json, defaultName, JSON_FILE);
}
