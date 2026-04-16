import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './is-tauri';
export type { TokenInfo, AttentionLayer, FeatureHit, TokenFeatures, GenerateResponse } from './types';

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
}

// KEEP IN SYNC: src-tauri/src/presets_compat.rs::Compatibility
export type Verdict = 'Comfortable' | 'Tight' | 'Insufficient';

// KEEP IN SYNC: src-tauri/src/presets_compat.rs::PresetCompatibility
export interface PresetCompatibility {
  preset_id: string;
  verdict: Verdict;
  headroom_mb: number;
  notes: string[];
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
};

const MOCK_PRESETS: PresetCompatibility[] = [
  { preset_id: 'gpt2-small', verdict: 'Comfortable', headroom_mb: 7000, notes: [] },
  { preset_id: 'pythia-410m', verdict: 'Comfortable', headroom_mb: 6000, notes: [] },
  { preset_id: 'pythia-1.4b', verdict: 'Tight', headroom_mb: 500, notes: ['Tight fit'] },
  { preset_id: 'gemma-2-2b', verdict: 'Insufficient', headroom_mb: -500, notes: ['Disabled pending Bet 3 validation'] },
  { preset_id: 'gemma-2-9b', verdict: 'Insufficient', headroom_mb: -4000, notes: ['Requires HuggingFace token'] },
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
  }
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
