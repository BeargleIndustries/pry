// Preset display helpers. All names, blurbs and Neuronpedia ids come from the
// presets.json `display` block (via Rust PresetCompatibility.display or the
// sidecar /models available[].display). No hardcoded per-preset maps here.

import type { PresetDisplay } from './types';
import type { PresetCompatibility, Verdict } from './tauri';
import { hfIdOf } from './custom-models';

/** Anything that carries a preset id and (maybe) its display block. */
export interface PresetLike {
  preset_id?: string;
  id?: string;
  display?: PresetDisplay | null;
}

function idOf(p: PresetLike): string {
  return p.preset_id ?? p.id ?? '';
}

/** Find the entry for `id` in a list of compat rows or /models presets. */
export function findPreset<T extends PresetLike>(
  id: string | null | undefined,
  list: readonly T[] | null | undefined,
): T | undefined {
  if (!id || !list) return undefined;
  return list.find((p) => idOf(p) === id);
}

/**
 * Human name for a preset. Pass a compat row (or /models entry), or a bare id
 * plus a list to look it up in. Falls back to the raw id.
 */
export function displayName(
  preset: PresetLike | string | null | undefined,
  list?: readonly PresetLike[] | null,
): string {
  if (preset == null) return 'No model';
  const entry = typeof preset === 'string' ? findPreset(preset, list) : preset;
  const name = entry?.display?.name?.trim();
  if (name) return name;
  // Custom models (T32) are named by their HuggingFace id.
  return hfIdOf(typeof preset === 'string' ? preset : idOf(preset)) || 'Unknown model';
}

const NEURONPEDIA = 'https://www.neuronpedia.org';

/**
 * `{model}/{layer}-{suffix}` path for a Neuronpedia SAE set, or null when the
 * preset has no Neuronpedia coverage (no display block, or null ids).
 */
export function neuronpediaUrlBase(
  display: Pick<PresetDisplay, 'neuronpedia_model_id' | 'neuronpedia_release_suffix'> | null | undefined,
  layer: number | null,
): string | null {
  const model = display?.neuronpedia_model_id;
  const suffix = display?.neuronpedia_release_suffix;
  if (!model || !suffix || layer == null || !Number.isInteger(layer) || layer < 0) return null;
  return `${model}/${layer}-${suffix}`;
}

/**
 * Full Neuronpedia feature URL
 * (`https://www.neuronpedia.org/{model}/{layer}-{suffix}/{featureId}`), or
 * null when the preset has no coverage. Callers hide the link on null.
 */
export function neuronpediaUrl(
  display: Pick<PresetDisplay, 'neuronpedia_model_id' | 'neuronpedia_release_suffix'> | null | undefined,
  layer: number | null,
  featureId: number,
): string | null {
  const base = neuronpediaUrlBase(display, layer);
  if (!base || !Number.isInteger(featureId) || featureId < 0) return null;
  return `${NEURONPEDIA}/${base}/${featureId}`;
}

// ---------------------------------------------------------------------------
// Verdicts (T11). Exhaustive: adding a Verdict variant fails the type check.
// ---------------------------------------------------------------------------

export type VerdictTone = 'good' | 'warn' | 'cpu' | 'bad' | 'soon';

export interface VerdictInfo {
  /** Long label (onboarding cards). */
  label: string;
  /** Short label (badges). */
  short: string;
  tone: VerdictTone;
  /** Can the user pick / switch to it? */
  pickable: boolean;
}

export const CPU_OK_COPY = 'Works on your computer (slower)';

function assertNever(x: never): never {
  throw new Error(`unhandled verdict: ${String(x)}`);
}

export function verdictInfo(v: Verdict): VerdictInfo {
  switch (v) {
    case 'Comfortable':
      return { label: 'Fits comfortably', short: 'Comfortable', tone: 'good', pickable: true };
    case 'Tight':
      return { label: 'Tight fit', short: 'Tight', tone: 'warn', pickable: true };
    case 'CpuOk':
      return { label: CPU_OK_COPY, short: CPU_OK_COPY, tone: 'cpu', pickable: true };
    case 'Insufficient':
      return { label: 'Not enough memory', short: 'Insufficient', tone: 'bad', pickable: false };
    default:
      return assertNever(v);
  }
}

const COMING_SOON: VerdictInfo = { label: 'Coming soon', short: 'Coming soon', tone: 'soon', pickable: false };

/** Badge for a preset row: a disabled preset is 'Coming soon', not a memory verdict. */
export function statusInfo(c: Pick<PresetCompatibility, 'verdict' | 'enabled'>): VerdictInfo {
  return c.enabled === false ? COMING_SOON : verdictInfo(c.verdict);
}

/** Pickable in onboarding / switchable in the app (verdict OK and not disabled). */
export function isPickable(c: Pick<PresetCompatibility, 'verdict' | 'enabled'>): boolean {
  return verdictInfo(c.verdict).pickable && c.enabled !== false;
}

/** Gated model (HF licence/token) — inferred from the Rust compat notes. */
export function needsHfToken(c: Pick<PresetCompatibility, 'notes'>): boolean {
  return c.notes.some((n) => /huggingface|license|licence/i.test(n));
}

/** Compat notes minus the one that just repeats the verdict badge. */
export function visibleNotes(c: Pick<PresetCompatibility, 'notes' | 'verdict'>): string[] {
  if (c.verdict !== 'CpuOk') return c.notes;
  return c.notes.filter((n) => !n.trim().startsWith(CPU_OK_COPY));
}
