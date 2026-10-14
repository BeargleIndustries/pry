// Pry scene state (plan T2b): the source of truth for every field a lesson
// sets or reads.
//
// Source of truth per field:
// - `pryUi` (below, owned here): panel state lifted out of SteeringPanel
//   (feature pick, strength), PanelA (Lines / Expert view, Lines head, FROM /
//   TO, open head), PatchingPanel (the two prompts, type, selected cell),
//   CircuitPanel (threshold box), WatchItWrite (settings, result, replay),
//   the open feature card, the embedding reader, hidden regions and
//   `workspaceSplit`. The panels read and write these fields directly.
// - The analysis controller (`analysis-core.ts`, via the host): the run, every
//   analysis result, focus, SAE layer, DLA target, ablation lists.
// - The compare controller (`compare-run.ts`, via the host): the two Compare
//   prompts and results.
// - `+page.svelte` (via the host, §P-actions): the prompt box, the left and
//   right tab, Compare mode, the attention Score by option, the patching
//   preset, the loaded model (load controller).
//
// `+page.svelte` binds the host once (bindPryHost); the registry's actions,
// readouts and apply reach the page only through it.

import { directCall, type AnalysisController, type SidecarCaller } from '../../analysis-core';
import { buildGenerateRequest, generateStepwise } from '../../sidecar';
import type { CompareController } from '../../compare-run';
import type { Aggregation } from '../../attention-agg';
import type { EmbeddingResponse, GenerateResponse, PatchComponent, SteerResponse } from '../../types';
import {
  DEFAULT_NEW_TOKENS,
  clampNewTokens,
  clampTemperature,
  initReplay,
  play,
  type ReplayState,
} from '../../watch-it-write';
import { RequestMemo } from './memo';

export type HeadPick = { layer: number; head: number };
export type PatchType = 'head' | 'mlp' | 'resid';

/** Default Swap test pair: indirect object identification (IOI). Same token length in GPT-2. */
export const IOI_CLEAN = 'When Mary and John went to the store, John gave a drink to';
export const IOI_CHANGED = 'When Mary and John went to the store, Mary gave a drink to';

/** One side of the embedding reader: the /embedding answer and the position it compares. */
export interface EmbeddingSide {
  prompt: string;
  token: string;
  position: number;
  response: EmbeddingResponse;
}

export interface WriteItState {
  temperature: number;
  newTokens: number;
  keepSeed: boolean;
  loading: boolean;
  error: string | null;
  result: GenerateResponse | null;
  replay: ReplayState;
  /** Length asked for on the last run, to tell when it stopped early. */
  newTokensUsed: number;
  /** The response (model + prompt) the result belongs to. */
  key: string | null;
}

function initialUi() {
  return {
    /** Both panels side by side (true) or one tabbed main area (false). Today: the window is 1280+ wide. */
    workspaceSplit: true,
    /** Hideable regions currently hidden (hide-until-predict). */
    hidden: {} as Record<string, boolean>,
    steering: { selectedFeatureId: null as number | null, alpha: 5.0 },
    attention: {
      view: 'lines' as 'lines' | 'expert',
      /** Head picked for the Lines view; null = pick automatically. */
      linesPick: null as HeadPick | null,
      focusMode: 'from' as 'from' | 'to',
      expandedLayer: null as number | null,
      expandedHead: null as number | null,
    },
    patching: {
      cleanPrompt: IOI_CLEAN,
      corruptedPrompt: IOI_CHANGED,
      patchType: 'head' as PatchType,
      selectedComponent: null as PatchComponent | null,
    },
    circuit: { thresholdInput: '' },
    writeIt: {
      temperature: 0,
      newTokens: DEFAULT_NEW_TOKENS,
      keepSeed: false,
      loading: false,
      error: null,
      result: null,
      replay: initReplay(0),
      newTokensUsed: 0,
      key: null,
    } as WriteItState,
    /** Feature card a lesson opened (open_feature). */
    openFeatureId: null as number | null,
    /** The embedding reader's two sides (show_embedding). */
    embedding: null as { a: EmbeddingSide; b: EmbeddingSide; split: boolean } | null,
    /** steer_across: the same steering on other prompts. */
    steerAcross: [] as { prompt: string; response: SteerResponse }[],
    /** run_steer{control: true} asked for the control feature. */
    steerControl: false,
  };
}

export type PryUi = ReturnType<typeof initialUi>;

/** Results apply can bring back (`analyses` in a scene). */
export const PRY_ANALYSES = [
  'logit_lens',
  'dla',
  'circuit',
  'patching',
  'head_ablation',
  'feature_ablation',
  'steer',
  'copying_heads',
  'compare',
] as const;
export type PryAnalysis = (typeof PRY_ANALYSES)[number];

/** A token picked by text and occurrence, or by index (start marker = 0). */
export type FocusSpec = { text: string; occurrence?: 'first' | 'last' | number } | { index: number };

/**
 * The scene state the ToolActionSet is generic over: what `target` builds,
 * `apply` drives the app to, and `snapshot` reads back.
 */
export interface PryViewState {
  /** Preset id; null = whatever is loaded. */
  model: string | null;
  sae_layer: number | null;
  prompt: string;
  /** The prompt has been run (the shown results belong to it). */
  run: boolean;
  left_panel: string;
  right_panel: string;
  focus: FocusSpec | null;
  compare_mode: boolean;
  compare: { a: string; b: string };
  attention_view: 'lines' | 'expert';
  aggregation: Aggregation;
  focus_mode: 'from' | 'to';
  lines_head: HeadPick | null;
  open_head: HeadPick | null;
  head_ablation: { heads: HeadPick[]; on: boolean };
  feature_ablation: { ids: number[]; on: boolean };
  steering: { feature_id: number | null; strength: number };
  patching: { clean: string; corrupted: string; type: PatchType };
  patch_cell: { layer: number; position: number } | null;
  dla_target: { answer: string | null; contrast: string | null } | null;
  hidden: Record<string, boolean>;
  analyses: PryAnalysis[];
}

export const pryUi: PryUi = $state(initialUi());

/** Back to the defaults (tests; the registry's reset uses the narrower resetPanels). */
export function resetPryUi(): void {
  Object.assign(pryUi, initialUi());
}

/** True while a lesson hides `anchor` (hide-until-predict). */
export function isHidden(anchor: string): boolean {
  return pryUi.hidden[anchor] === true;
}

/** Which run a Watch it write result belongs to (model + prompt). */
export function responseKey(r: { preset_id: string; prompt: string } | null): string | null {
  return r ? `${r.preset_id}\u0000${r.prompt}` : null;
}

/**
 * Watch it write: continue the run's prompt and replay it token by token. The
 * panel's Write it button calls this with the panel's settings; the write_it
 * action passes its own (and the runner memo as `call`).
 */
export async function runWriteIt(
  response: GenerateResponse | null,
  opts: { temperature?: number; seed?: number | null; maxTokens?: number } = {},
  call: SidecarCaller = directCall,
): Promise<void> {
  const w = pryUi.writeIt;
  if (!response || w.loading) return;
  w.loading = true;
  w.error = null;
  const n = clampNewTokens(opts.maxTokens ?? w.newTokens);
  const t = clampTemperature(opts.temperature ?? w.temperature);
  try {
    const seed = opts.seed !== undefined ? opts.seed : w.keepSeed && t > 0 ? (w.result?.seed_used ?? null) : null;
    const presetId = response.preset_id;
    const prompt = response.prompt;
    const body = buildGenerateRequest({ presetId, prompt, maxNewTokens: n, temperature: t, seed, topKFeatures: 1 });
    const r = await call({ endpoint: '/generate', model: presetId, body }, () =>
      generateStepwise(presetId, prompt, { maxNewTokens: n, temperature: t, seed }),
    );
    w.result = r;
    w.key = responseKey(response);
    w.newTokensUsed = n;
    w.replay = play(initReplay(r.generation_steps?.length ?? 0));
  } catch (e) {
    w.error = (e as { message?: string })?.message ?? String(e);
  } finally {
    w.loading = false;
  }
}

/** A plain copy of a value that may be reactive (captures, snapshots). */
export function plain<T>(v: T): T {
  return $state.snapshot(v) as T;
}

// ---------------------------------------------------------------------------
// The page bridge
// ---------------------------------------------------------------------------

export interface PryHost {
  analysis: AnalysisController;
  compare: CompareController;
  getPrompt(): string;
  setPrompt(text: string): void;
  getLeftTab(): string;
  /** Opens a left tab the way the experiment cards do (narrow layout: the left half first). */
  openLeftTab(tab: string): void;
  getRightTab(): string;
  openRightTab(tab: string): void;
  getCompareMode(): boolean;
  setCompareMode(on: boolean): void;
  getAggregation(): Aggregation;
  setAggregation(agg: Aggregation): void;
  setPatchingPreset(p: { clean: string; corrupted: string; patchType: PatchType } | null): void;
  /** The model the engine holds now. */
  activePresetId(): string | null;
  /** The load controller's switch entry (licence gate kept). Never throws. */
  switchModel(presetId: string): Promise<void>;
  /** Opens a link in the browser. */
  openLink(url: string): Promise<void>;
}

let host: PryHost | null = null;

/** `+page.svelte` binds itself once; returns the unbind. */
export function bindPryHost(h: PryHost): () => void {
  host = h;
  return () => {
    if (host === h) host = null;
  };
}

export function pryHost(): PryHost {
  if (!host) throw new Error('Pry is not ready yet: the page has not bound its lesson host.');
  return host;
}

export function hasPryHost(): boolean {
  return host !== null;
}

// ---------------------------------------------------------------------------
// Pickers: the learner picks something in the app
// ---------------------------------------------------------------------------

type PickKind = 'token' | 'head';
const pickListeners: Record<PickKind, Set<(v: unknown) => void>> = { token: new Set(), head: new Set() };

/** Panels call this when the learner clicks a token chip or a head cell. */
export function notifyPick(kind: PickKind, value: unknown): void {
  for (const l of [...pickListeners[kind]]) l(value);
}

/** Resolves with the learner's next pick of `kind`; rejects when `signal` aborts. */
export function waitForPick(kind: PickKind, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const done = (v: unknown) => {
      pickListeners[kind].delete(done);
      signal.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const onAbort = () => {
      pickListeners[kind].delete(done);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    pickListeners[kind].add(done);
    signal.addEventListener('abort', onAbort);
  });
}

// ---------------------------------------------------------------------------
// The runner memo (plan T2 "Memo")
// ---------------------------------------------------------------------------

/** Pry's runner memo. The runner hands it to its dispatcher; cleared on every model load. */
export const pryMemo = new RequestMemo();
