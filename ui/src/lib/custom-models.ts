// Custom models (T32): user-added HuggingFace models, loaded without a
// sparse autoencoder (SAE). The sidecar addresses one as `custom:<hf_id>`.
// KEEP IN SYNC: sidecar/pry_sidecar/custom_models.py (CUSTOM_PREFIX, NO_SAE_MESSAGE)

import type { CustomPreset, HardwareReport, PresetCompatibility } from './tauri';
import type { PresetDisplay } from './types';

export const CUSTOM_PREFIX = 'custom:';

/** Shown wherever a panel needs features (and returned by the sidecar's 409s). */
export const NO_SAE_MESSAGE =
  "Features need a trained sparse autoencoder (SAE); this model doesn't have one in Pry yet.";

/** Exactly what works on a custom model. The dialog promises this list and nothing more. */
export const CUSTOM_MODEL_WORKS: readonly string[] = [
  'Attention patterns, including the copying-heads view',
  'Predictions (the next-word guesses)',
  'Logit lens (how the guess changes layer by layer)',
  'Why (DLA): which parts pushed the prediction',
  'Turning attention heads off (head ablation)',
  'Swap test (activation patching) and Key parts',
  'Comparing two prompts, and watching it write',
];

/** What doesn't work without an SAE. */
export const CUSTOM_MODEL_MISSING: readonly string[] = [
  'Features',
  'Steering and concept search',
  'Turning features off (feature ablation)',
];

export function customPresetId(hfId: string): string {
  return `${CUSTOM_PREFIX}${hfId}`;
}

export function isCustomPresetId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(CUSTOM_PREFIX);
}

/** The HuggingFace repo id inside a `custom:` preset id (other ids unchanged). */
export function hfIdOf(id: string): string {
  return isCustomPresetId(id) ? id.slice(CUSTOM_PREFIX.length) : id;
}

export const SIZE_UNCHECKED_NOTE =
  "Pry hasn't checked this model's size, so it may not fit. Remove it and add it again to check.";

/** Display block for a custom model, so preset lists and the switcher can show it. */
export function customDisplay(m: CustomPreset): PresetDisplay {
  return {
    name: m.id,
    blurb: `${m.architecture} · no SAE`,
    params: m.params_label ?? '',
    size_label: '',
    n_layers: 0,
    n_heads: 0,
    neuronpedia_model_id: null,
    neuronpedia_release_suffix: null,
    recommended: false,
  };
}

type Evaluate = (
  hfId: string,
  vramEstimateMb: number,
  cpuOk: boolean,
  hw: HardwareReport,
) => Promise<PresetCompatibility>;

/**
 * Compatibility row for a saved custom model, keyed by its `custom:` preset
 * id. Uses the Rust verdict (same rules as presets) when the size is known
 * and the hardware has been probed.
 */
export async function customCompatibility(
  m: CustomPreset,
  hw: HardwareReport | null,
  evaluate: Evaluate,
): Promise<PresetCompatibility> {
  const base = { preset_id: customPresetId(m.id), display: customDisplay(m), enabled: true };
  if (m.vram_estimate_mb == null) {
    return { ...base, verdict: 'Tight', headroom_mb: 0, notes: [SIZE_UNCHECKED_NOTE] };
  }
  if (!hw) {
    return { ...base, verdict: 'Tight', headroom_mb: 0, notes: ["Checking this computer's memory…"] };
  }
  const c = await evaluate(m.id, m.vram_estimate_mb, m.cpu_ok ?? false, hw);
  return { ...c, ...base };
}

/** Same shape check as the sidecar and Rust: `org/name` or `name`. */
export function looksLikeHfId(raw: string): boolean {
  const s = raw.trim();
  return s.length > 0 && s.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(s);
}
