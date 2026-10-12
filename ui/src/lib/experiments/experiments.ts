// Experiment cards (T22): typed loading + validation of experiments.json, and
// the plain-TS "set this experiment up" sequence. `+page.svelte` supplies the
// actions (same idea as TutorialActions); ExperimentGallery only renders.
import type { Aggregation } from '$lib/attention-agg';
import raw from './experiments.json';

export const LEFT_TABS = ['attention', 'logit-lens', 'dla', 'patching', 'circuit'] as const;
export const RIGHT_TABS = ['features', 'predictions', 'steering'] as const;
export const PATCH_TYPES = ['head', 'mlp', 'resid'] as const;
/** Preset the page's Run button loads when no model is active. */
export const DEFAULT_PRESET = 'gpt2-small';
// 'mean' is left out: it only exists in the TO view, and applyExperiment never
// sets the focus mode, so the panel would quietly reset it to 'max'.
export const AGGREGATIONS: readonly Aggregation[] = ['max', 'spread', 'looks-back', 'previous'];

/** Tab names as the tab bar shows them. */
const LEFT_TAB_LABELS: Record<LeftTab, string> = {
  attention: 'Attention',
  'logit-lens': 'Logit Lens',
  dla: 'Why (DLA)',
  patching: 'Swap & Compare',
  circuit: 'Key parts',
};
const RIGHT_TAB_LABELS: Record<RightTab, string> = {
  features: 'Features',
  predictions: 'Predictions',
  steering: 'Steering',
};

export type LeftTab = (typeof LEFT_TABS)[number];
export type RightTab = (typeof RIGHT_TABS)[number];
export type PatchType = (typeof PATCH_TYPES)[number];

export interface Citation {
  label: string;
  url: string;
}

export interface Experiment {
  id: string;
  title: string;
  /** One-line hook shown on the card and at the top of the guide. */
  hook: string;
  /** "Why it matters": one sentence that only restates `found` and its citation. */
  why: string;
  /** Model preset the experiment was written for. */
  preset: string;
  /** Prompt put in the prompt box and run. */
  prompt: string;
  open: { left?: LeftTab; right?: RightTab };
  /** Attention grid aggregation to select (Attention tab). */
  aggregation?: Aggregation;
  /** Pre-filled Swap & Compare pair. Must tokenize to the same length (pytest checks GPT-2). */
  patching?: { clean: string; corrupted: string; patchType: PatchType };
  /** Heads to pre-select for knockout in the Attention tab. */
  ablateHeads?: { layer: number; head: number }[];
  /** GPT-2 small's top next word for `prompt` that the copy relies on (pytest checks it). */
  expect?: string;
  /** Top next word for the corrupted patching prompt, when the copy names it (pytest checks it). */
  expectCorrupted?: string;
  /** "What to look for", plain language, one tip per entry. */
  lookFor: string[];
  /** "What researchers found". */
  found: { summary: string; citations: Citation[] };
  /** "When you're done": how to get back to normal, and what to try next (tryId starts that experiment). */
  next: { reset: string; try: string; tryId?: string };
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function isHttpUrl(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Problems with one raw experiment entry (empty list = valid). */
export function validateExperiment(e: unknown): string[] {
  if (!isObj(e)) return ['entry is not an object'];
  const id = isStr(e.id) ? e.id : '(no id)';
  const errs: string[] = [];
  const req = (cond: boolean, msg: string) => {
    if (!cond) errs.push(`${id}: ${msg}`);
  };

  req(isStr(e.id) && /^[a-z0-9-]+$/.test(e.id as string), 'id must be lowercase letters, digits and dashes');
  for (const k of ['title', 'hook', 'why', 'preset', 'prompt'] as const) req(isStr(e[k]), `${k} is required`);

  req(isObj(e.open), 'open is required');
  if (isObj(e.open)) {
    const { left, right } = e.open;
    req(left !== undefined || right !== undefined, 'open needs a left or right tab');
    req(left === undefined || (LEFT_TABS as readonly unknown[]).includes(left), `unknown left tab ${String(left)}`);
    req(right === undefined || (RIGHT_TABS as readonly unknown[]).includes(right), `unknown right tab ${String(right)}`);
  }

  req(e.aggregation === undefined || (AGGREGATIONS as readonly unknown[]).includes(e.aggregation), 'unknown aggregation');

  if (e.patching !== undefined) {
    const p = e.patching;
    req(isObj(p) && isStr(p.clean) && isStr(p.corrupted), 'patching needs clean and corrupted prompts');
    req(isObj(p) && (PATCH_TYPES as readonly unknown[]).includes(p.patchType), 'patching.patchType must be head, mlp or resid');
    req(isObj(p) && p.clean !== p.corrupted, 'patching clean and corrupted prompts must differ');
  }

  if (e.ablateHeads !== undefined) {
    req(
      Array.isArray(e.ablateHeads) && e.ablateHeads.length > 0 &&
        e.ablateHeads.every((h) => isObj(h) && isNonNegInt(h.layer) && isNonNegInt(h.head)),
      'ablateHeads must be a non-empty list of {layer, head}',
    );
  }

  // The guide's reload button is gone; a demo link would reload the app and lose the experiment.
  req(e.demoLink === undefined, 'demoLink is not supported');

  req(Array.isArray(e.lookFor) && e.lookFor.length > 0 && e.lookFor.every(isStr), 'lookFor needs at least one tip');

  req(isObj(e.found) && isStr(e.found.summary), 'found.summary is required');
  const cites = isObj(e.found) ? e.found.citations : undefined;
  req(Array.isArray(cites) && cites.length > 0, 'found needs at least one citation');
  if (Array.isArray(cites)) {
    cites.forEach((c, i) => {
      req(isObj(c) && isStr(c.label), `citation ${i} needs a label`);
      req(isObj(c) && isHttpUrl(c.url), `citation ${i} needs an http(s) url`);
    });
  }

  const next = e.next;
  req(isObj(next) && isStr(next.reset) && isStr(next.try), 'next needs reset and try');
  if (isObj(next) && next.tryId !== undefined) {
    req(isStr(next.tryId) && next.tryId !== e.id, 'next.tryId must name another experiment');
  }
  return errs;
}

/** Validate a whole experiments file (entries + unique ids). */
export function validateExperiments(data: unknown): string[] {
  if (!isObj(data) || !Array.isArray(data.experiments)) return ['file must have an experiments list'];
  const errs = data.experiments.flatMap(validateExperiment);
  const seen = new Set<string>();
  for (const e of data.experiments) {
    const id = isObj(e) ? e.id : undefined;
    if (typeof id !== 'string') continue;
    if (seen.has(id)) errs.push(`duplicate id ${id}`);
    seen.add(id);
  }
  for (const e of data.experiments) {
    const tryId = isObj(e) && isObj(e.next) ? e.next.tryId : undefined;
    if (typeof tryId === 'string' && !seen.has(tryId)) errs.push(`${String(e.id)}: next.tryId ${tryId} is not an experiment`);
  }
  return errs;
}

/** The tab a card teaches, as the tab bar names it. Predictions is a side view, so it only counts when nothing else is open. */
export function tabLabel(exp: Experiment): string {
  const right = exp.open.right;
  if (right && right !== 'predictions') return RIGHT_TAB_LABELS[right];
  if (exp.open.left) return LEFT_TAB_LABELS[exp.open.left];
  return RIGHT_TAB_LABELS[right ?? 'predictions'];
}

/** The bundled experiments. Invalid entries are dropped (and the vitest suite fails on them). */
export function loadExperiments(data: unknown = raw): Experiment[] {
  if (!isObj(data) || !Array.isArray(data.experiments)) return [];
  const seen = new Set<string>();
  const out: Experiment[] = [];
  for (const e of data.experiments) {
    if (validateExperiment(e).length > 0) continue;
    const exp = e as Experiment;
    if (seen.has(exp.id)) continue;
    seen.add(exp.id);
    out.push(exp);
  }
  return out;
}

/** What the page lets an experiment do. */
export interface ExperimentActions {
  activePresetId(): string | null;
  switchModel(presetId: string): Promise<void>;
  setPrompt(text: string): void;
  runGenerate(): Promise<void>;
  openLeftTab(tab: LeftTab): void;
  openRightTab(tab: RightTab): void;
  setAggregation(agg: Aggregation): void;
  presetPatching(p: { clean: string; corrupted: string; patchType: PatchType }): void;
  presetHeadAblations(heads: { layer: number; head: number }[]): void;
  /** End the guided tour if it's running (the tour and a guide are never open together). */
  endTour(): void;
}

/** What "Back to normal" undoes. */
export interface ResetActions {
  clearHeadAblations(): void;
  hideHeadScores(): void;
  clearPatchingPreset(): void;
  dismissGuide(): void;
}

/**
 * "Back to normal": turn head ablation off, leave the copying-heads view,
 * clear the Swap & Compare pair and close the guide. The prompt is kept.
 */
export function resetExperiment(a: ResetActions): void {
  a.clearHeadAblations();
  a.hideHeadScores();
  a.clearPatchingPreset();
  a.dismissGuide();
}

/** What `applyExperiment` did: set up, or stopped because the model switch failed. */
export type ApplyResult = { ok: true } | { ok: false; reason: 'model-switch-failed'; preset: string };

/**
 * Set an experiment up: end any running tour, switch model if a different one is loaded, put the
 * prompt in and run it, then open the panels. Ablations and tabs go after the
 * run, because a new run clears ablation picks and analysis results.
 *
 * The page's switch never throws, so the loaded model is checked afterwards.
 * If it isn't the experiment's model, nothing else is set up.
 */
export async function applyExperiment(exp: Experiment, a: ExperimentActions): Promise<ApplyResult> {
  a.endTour();
  const active = a.activePresetId();
  // With nothing loaded, Run loads the page default (gpt2-small) by itself.
  const runLoadsIt = active === null && exp.preset === DEFAULT_PRESET;
  if (active !== exp.preset && !runLoadsIt) {
    await a.switchModel(exp.preset);
    if (a.activePresetId() !== exp.preset) {
      return { ok: false, reason: 'model-switch-failed', preset: exp.preset };
    }
  }
  a.setPrompt(exp.prompt);
  if (exp.patching) a.presetPatching(exp.patching);
  await a.runGenerate();
  if (exp.ablateHeads) a.presetHeadAblations(exp.ablateHeads);
  if (exp.aggregation) a.setAggregation(exp.aggregation);
  if (exp.open.right) a.openRightTab(exp.open.right);
  if (exp.open.left) a.openLeftTab(exp.open.left);
  return { ok: true };
}
