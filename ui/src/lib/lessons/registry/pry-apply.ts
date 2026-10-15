// Pry target / apply / snapshot / memoContext (plan T2b, runner contract).
//
// `target(baseline, overlay, from)` folds a `:::enter` overlay onto a scene
// state; `apply` drives the app to it in a fixed order:
//   model → SAE layer → prompt → run → panel state → analyses,
// checking the abort signal between steps. The model switch and the SAE layer
// switch are stateful (commit-on-complete): they always finish and their
// result is written; an abort only stops what comes after. `snapshot` reads
// the state back, so apply(snapshot()) changes nothing.

import { z } from 'zod';
import type { ActionContext, ToolActionSet } from './contract';
import { PRY_MODELS } from './pry-models';
import { HIDEABLE_ANCHORS } from './pry-anchors';
import { LEFT_PANELS, PANELS, callerOf, findPatchCell, openPanel, resolveFocus } from './pry-actions';
import {
  IOI_CHANGED,
  IOI_CLEAN,
  PRY_ANALYSES,
  hasPryHost,
  plain,
  pryHost,
  pryUi,
  type PryAnalysis,
  type PryViewState,
} from './pry-state.svelte';

type PrySet = ToolActionSet<PryViewState>;

// ---------------------------------------------------------------------------
// Schemas: front matter `baseline` and the `:::enter` overlay
// ---------------------------------------------------------------------------

const layer = z.number().int().min(0);
const headRef = z.object({ layer, head: z.number().int().min(0) }).strict();
const occurrence = z.union([z.literal('first'), z.literal('last'), z.number().int().min(1)]);
const panel = z.enum(PANELS);

const sceneKeys = {
  model: z.enum(PRY_MODELS),
  sae_layer: layer,
  prompt: z.string(),
  run: z.boolean(),
  open_panel: z.union([panel, z.array(panel).min(1)]),
  focus_token: z.union([
    z.object({ text: z.string(), occurrence: occurrence.optional() }).strict(),
    z.object({ index: z.number().int().min(0) }).strict(),
  ]),
  dla_target: z.object({ answer: z.string(), contrast: z.string().optional() }).strict(),
  compare_mode: z.boolean(),
  compare: z.object({ a: z.string(), b: z.string() }).strict(),
  attention_view: z.enum(['lines', 'expert']),
  aggregation: z.enum(['max', 'spread', 'looks-back', 'previous', 'mean']),
  focus_mode: z.enum(['from', 'to']),
  lines_head: headRef,
  /** null closes an opened head, so the head grid shows. */
  open_head: headRef.nullable(),
  head_ablation: z.object({ heads: z.array(headRef), on: z.boolean() }).strict(),
  feature_ablation: z.object({ ids: z.array(z.number().int().min(0)), on: z.boolean() }).strict(),
  steering: z.object({ feature_id: z.number().int().min(0), strength: z.number() }).strict(),
  patching: z.object({ clean: z.string(), corrupted: z.string(), type: z.enum(['head', 'mlp', 'resid']) }).strict(),
  patch_cell: z.object({ layer, position: z.number().int().min(0) }).strict(),
  hidden: z.object(Object.fromEntries(HIDEABLE_ANCHORS.map((a) => [a, z.boolean().optional()]))).strict(),
  analyses: z.array(z.enum(PRY_ANALYSES)),
};

const optionalKeys = Object.fromEntries(Object.entries(sceneKeys).map(([k, v]) => [k, v.optional()])) as {
  [K in keyof typeof sceneKeys]: z.ZodOptional<(typeof sceneKeys)[K]>;
};

/** Front matter `baseline`: the lesson's starting scene. */
export const pryBaselineSchema = z.object(optionalKeys).strict();
/** A section's `:::enter`: scene keys on top of the state so far, plus `reset: true`. */
export const pryOverlaySchema = z.object({ ...optionalKeys, reset: z.literal(true).optional() }).strict();

export type PryOverlay = z.infer<typeof pryOverlaySchema>;

// ---------------------------------------------------------------------------
// target
// ---------------------------------------------------------------------------

/** The app as it opens: today's defaults. `prompt: null` leaves the prompt box alone. */
export function defaultScene(): PryViewState & { prompt: string } {
  return {
    model: null,
    sae_layer: null,
    prompt: null as unknown as string,
    run: false,
    left_panel: 'attention',
    right_panel: 'features',
    focus: null,
    compare_mode: false,
    compare: { a: 'The doctor said that', b: 'The nurse said that' },
    attention_view: 'lines',
    aggregation: 'max',
    focus_mode: 'from',
    lines_head: null,
    lines_average: false,
    open_head: null,
    head_ablation: { heads: [], on: false },
    feature_ablation: { ids: [], on: false },
    steering: { feature_id: null, strength: 5 },
    patching: { clean: IOI_CLEAN, corrupted: IOI_CHANGED, type: 'head' },
    patch_cell: null,
    dla_target: null,
    hidden: {},
    analyses: [],
  };
}

function overlayOnto(s: PryViewState, o: Record<string, unknown>): PryViewState {
  const out: PryViewState = structuredClone(s);
  const v = o as PryOverlay;
  if (v.model !== undefined) out.model = v.model;
  if (v.sae_layer !== undefined) out.sae_layer = v.sae_layer;
  if (v.prompt !== undefined) out.prompt = v.prompt;
  if (v.run !== undefined) out.run = v.run;
  if (v.open_panel !== undefined) {
    for (const p of Array.isArray(v.open_panel) ? v.open_panel : [v.open_panel]) {
      if (LEFT_PANELS.includes(p)) {
        out.left_panel = p;
        out.front = 'left';
      } else {
        out.right_panel = p === 'watch-it-write' ? 'predictions' : p;
        out.front = 'right';
      }
    }
  }
  if (v.focus_token !== undefined) out.focus = { ...v.focus_token };
  if (v.dla_target !== undefined) out.dla_target = { answer: v.dla_target.answer, contrast: v.dla_target.contrast ?? null };
  if (v.compare_mode !== undefined) out.compare_mode = v.compare_mode;
  if (v.compare !== undefined) out.compare = { ...v.compare };
  if (v.attention_view !== undefined) out.attention_view = v.attention_view;
  if (v.aggregation !== undefined) out.aggregation = v.aggregation;
  if (v.focus_mode !== undefined) out.focus_mode = v.focus_mode;
  if (v.lines_head !== undefined) {
    out.lines_head = { ...v.lines_head };
    out.lines_average = false;
  }
  if (v.open_head !== undefined) out.open_head = v.open_head ? { ...v.open_head } : null;
  if (v.head_ablation !== undefined) out.head_ablation = structuredClone(v.head_ablation);
  if (v.feature_ablation !== undefined) out.feature_ablation = structuredClone(v.feature_ablation);
  if (v.steering !== undefined) out.steering = { ...v.steering };
  if (v.patching !== undefined) out.patching = { ...v.patching };
  if (v.patch_cell !== undefined) out.patch_cell = { ...v.patch_cell };
  if (v.hidden !== undefined) {
    for (const [k, on] of Object.entries(v.hidden)) if (on !== undefined) out.hidden[k] = on;
  }
  if (v.analyses !== undefined) out.analyses = [...v.analyses];
  return out;
}

export const pryTarget: PrySet['target'] = (baseline, overlay, from) => {
  const start = from ?? overlayOnto(defaultScene(), (baseline ?? {}) as Record<string, unknown>);
  const { reset: _reset, ...rest } = (overlay ?? {}) as Record<string, unknown>;
  return overlayOnto(start, rest);
};

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

function abortIf(ctx: ActionContext): void {
  if (ctx.signal.aborted) throw ctx.signal.reason ?? new DOMException('Aborted', 'AbortError');
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const pryApply: PrySet['apply'] = async (t, ctx) => {
  const h = pryHost();
  const an = h.analysis;
  const s = an.state;
  const call = callerOf(ctx);

  // 1. Model (stateful: the switch finishes even if the learner moves on).
  if (t.model && t.model !== h.activePresetId()) await h.switchModel(t.model);
  abortIf(ctx);

  // 2. SAE layer (stateful). It needs a run to switch on; with none yet it follows the run.
  const switchLayer = async () => {
    if (t.sae_layer !== null && s.response && s.saeLayer !== t.sae_layer) await an.layerSwitch(t.sae_layer, call);
  };
  await switchLayer();
  abortIf(ctx);

  // 3. Prompt.
  if (t.prompt !== null && t.prompt !== h.getPrompt()) h.setPrompt(t.prompt);

  // 4. Run. A scene that hasn't run yet doesn't show the results of a later
  // one (T3 back-state: entering a section is a function of the section and
  // the journal, never of the path that led there).
  const prompt = h.getPrompt();
  const ran = () => !!s.response && s.response.prompt === prompt && s.response.preset_id === h.activePresetId();
  if (!t.run && s.response) {
    s.response = null;
    s.focusTokenIndex = undefined;
  }
  if (t.run && !ran()) await an.generate(prompt, call);
  abortIf(ctx);
  await switchLayer();
  abortIf(ctx);

  // 5. Panel state.
  if (h.getCompareMode() !== t.compare_mode) h.setCompareMode(t.compare_mode);
  const cs = h.compare.state;
  if (cs.promptA !== t.compare.a) cs.promptA = t.compare.a;
  if (cs.promptB !== t.compare.b) cs.promptB = t.compare.b;
  if (t.focus && s.response) {
    const idx = resolveFocus(s.response.tokens, t.focus);
    if (idx !== undefined && idx !== s.focusTokenIndex) s.focusTokenIndex = idx;
  } else if (!t.focus && s.response) {
    // No focus in the scene: a run's own default, its last token (as generate sets it).
    const last = s.response.tokens.at(-1)?.index;
    if (last !== s.focusTokenIndex) s.focusTokenIndex = last;
  }
  const att = pryUi.attention;
  att.view = t.attention_view;
  if (h.getAggregation() !== t.aggregation) h.setAggregation(t.aggregation);
  att.focusMode = t.focus_mode;
  if (!sameJson(att.linesPick, t.lines_head)) att.linesPick = t.lines_head ? { ...t.lines_head } : null;
  att.linesAverage = (t.lines_average ?? false) && !t.lines_head;
  att.expandedLayer = t.open_head?.layer ?? null;
  att.expandedHead = t.open_head?.head ?? null;
  if (!sameJson(s.headAblations, t.head_ablation.heads)) s.headAblations = t.head_ablation.heads.map((x) => ({ ...x }));
  s.headAblationMode = t.head_ablation.on;
  const fLayer = s.response?.sae_layer_used ?? s.saeLayer ?? 0;
  if (!sameJson(s.featureAblations.map((f) => f.feature_index), t.feature_ablation.ids)) {
    s.featureAblations = t.feature_ablation.ids.map((id) => ({ feature_index: id, layer: fLayer }));
  }
  s.featureAblationMode = t.feature_ablation.on;
  pryUi.steering.selectedFeatureId = t.steering.feature_id;
  pryUi.steering.alpha = t.steering.strength;
  const ps = pryUi.patching;
  if (ps.cleanPrompt !== t.patching.clean || ps.corruptedPrompt !== t.patching.corrupted || ps.patchType !== t.patching.type) {
    ps.cleanPrompt = t.patching.clean;
    ps.corruptedPrompt = t.patching.corrupted;
    ps.patchType = t.patching.type;
    h.setPatchingPreset({ clean: t.patching.clean, corrupted: t.patching.corrupted, patchType: t.patching.type });
  }
  if (!sameJson(pryUi.hidden, t.hidden)) pryUi.hidden = { ...t.hidden };

  // 6. Analyses. A scene-set DLA target holds until the learner moves focus.
  const want = new Set<PryAnalysis>(t.analyses);
  // Results the scene doesn't hold (and its open tab doesn't fetch) go, so a
  // section entered by Back shows what it showed going forward (T3 back-state).
  const keep = new Set<PryAnalysis>(want);
  if (t.dla_target || t.left_panel === 'dla') keep.add('dla');
  if (t.left_panel === 'logit-lens') keep.add('logit_lens');
  if (t.left_panel === 'circuit') keep.add('circuit');
  if (!s.response) for (const a of ['logit_lens', 'dla', 'circuit', 'head_ablation', 'feature_ablation', 'steer'] as const) keep.delete(a);
  if (!keep.has('logit_lens')) s.logitLensResponse = null;
  if (!keep.has('dla')) s.dlaResponse = null;
  if (!keep.has('circuit')) s.circuitResponse = null;
  if (!keep.has('head_ablation')) s.headAblateResponse = null;
  if (!keep.has('feature_ablation')) s.featureAblateResponse = null;
  if (!keep.has('steer')) s.steerResponse = null;
  if (!keep.has('patching') && s.patchResponse) {
    s.patchResponse = null;
    ps.byType = {};
  }
  if (!keep.has('compare') && (cs.a || cs.b)) h.compare.clear();
  let dlaStale = false;
  if (!sameJson(s.dlaTarget, t.dla_target)) {
    an.setSceneDlaTarget(t.dla_target?.answer ?? null, t.dla_target?.contrast ?? null);
    dlaStale = true;
  }
  // Tabs. Opening a tab brings its half forward in the one-panel (tabbed)
  // layout, so only a tab that changes is opened, and the half the scene's
  // open_panel named last comes forward last.
  const rightChanged = h.getRightTab() !== t.right_panel;
  const leftChanged = h.getLeftTab() !== t.left_panel;
  const leftFetches = !!s.response && ['logit-lens', 'dla', 'circuit'].includes(t.left_panel);
  if (rightChanged) h.openRightTab(t.right_panel);
  if (!t.compare_mode) {
    if (leftChanged || leftFetches) await openPanel(t.left_panel, call);
  } else if (leftChanged) h.openLeftTab(t.left_panel);
  // `front` is set only when this section's own overlay (or the baseline) named a panel.
  if (t.front === 'right') h.openRightTab(t.right_panel);
  else if (t.front === 'left' && !(leftChanged || leftFetches)) h.openLeftTab(t.left_panel);
  abortIf(ctx);
  if (s.response) {
    if (want.has('logit_lens') && !s.logitLensResponse) await an.logitLens(call);
    abortIf(ctx);
    if ((want.has('dla') || t.dla_target) && (!s.dlaResponse || dlaStale)) await an.dla(call);
    abortIf(ctx);
    if (want.has('circuit') && !s.circuitResponse) {
      const th = pryUi.circuit.thresholdInput.trim();
      await an.circuit('dla', th ? parseFloat(th) : undefined, call);
    }
    abortIf(ctx);
    if (want.has('head_ablation') && s.headAblations.length > 0 && !sameJson(s.headAblateResponse?.ablations ?? null, s.headAblations)) {
      await an.runHeadAblation(call);
    }
    abortIf(ctx);
    if (
      want.has('feature_ablation') &&
      s.featureAblations.length > 0 &&
      !sameJson(s.featureAblateResponse?.feature_ablations ?? null, s.featureAblations)
    ) {
      await an.runFeatureAblation(call);
    }
    abortIf(ctx);
    const fid = pryUi.steering.selectedFeatureId;
    if (
      want.has('steer') &&
      fid !== null &&
      s.saeLayer !== undefined &&
      (!s.steerResponse || s.steerResponse.feature_id !== fid || s.steerResponse.alpha !== pryUi.steering.alpha)
    ) {
      await an.steer(fid, s.saeLayer, pryUi.steering.alpha, call, pryUi.steerControl);
    }
    abortIf(ctx);
  }
  const pr = s.patchResponse;
  if (
    want.has('patching') &&
    (!pr || pr.clean_prompt !== t.patching.clean || pr.corrupted_prompt !== t.patching.corrupted || pr.patch_type !== t.patching.type)
  ) {
    await an.patching(t.patching.clean, t.patching.corrupted, t.patching.type, call);
    if (s.patchResponse) ps.byType[s.patchResponse.patch_type as 'head' | 'mlp' | 'resid'] = s.patchResponse;
  }
  abortIf(ctx);
  if (want.has('copying_heads') && !s.headScoresMode) await an.showHeadScores(call);
  else if (!want.has('copying_heads') && s.headScoresMode) an.hideHeadScores();
  abortIf(ctx);
  if (want.has('compare') && (!cs.a || !cs.b || cs.a.prompt !== cs.promptA || cs.b.prompt !== cs.promptB)) {
    await h.compare.run(call);
  }
  abortIf(ctx);
  // The selected Swap test cell needs the patching result.
  const cell = t.patch_cell ? findPatchCell(t.patch_cell.layer, t.patch_cell.position) : null;
  if (ps.selectedComponent?.name !== cell?.name) ps.selectedComponent = cell;
};

// ---------------------------------------------------------------------------
// snapshot / memoContext
// ---------------------------------------------------------------------------

export const prySnapshot: PrySet['snapshot'] = () => {
  const h = pryHost();
  const s = h.analysis.state;
  const att = pryUi.attention;
  const ps = pryUi.patching;
  const prompt = h.getPrompt();
  const cs = h.compare.state;
  const analyses: PryAnalysis[] = [];
  if (s.logitLensResponse) analyses.push('logit_lens');
  if (s.dlaResponse) analyses.push('dla');
  if (s.circuitResponse) analyses.push('circuit');
  if (s.patchResponse) analyses.push('patching');
  if (s.headAblateResponse) analyses.push('head_ablation');
  if (s.featureAblateResponse) analyses.push('feature_ablation');
  if (s.steerResponse) analyses.push('steer');
  if (s.headScoresMode) analyses.push('copying_heads');
  if (cs.a && cs.b) analyses.push('compare');
  const pr = s.patchResponse;
  const sel = ps.selectedComponent;
  return plain({
    model: h.activePresetId(),
    sae_layer: s.saeLayer ?? null,
    prompt,
    run: !!s.response && s.response.prompt === prompt && s.response.preset_id === h.activePresetId(),
    left_panel: h.getLeftTab(),
    right_panel: h.getRightTab(),
    focus: s.focusTokenIndex !== undefined ? { index: s.focusTokenIndex } : null,
    compare_mode: h.getCompareMode(),
    compare: { a: cs.promptA, b: cs.promptB },
    attention_view: att.view,
    aggregation: h.getAggregation(),
    focus_mode: att.focusMode,
    lines_head: att.linesPick ? { ...att.linesPick } : null,
    lines_average: att.linesAverage,
    open_head: att.expandedLayer !== null && att.expandedHead !== null ? { layer: att.expandedLayer, head: att.expandedHead } : null,
    head_ablation: { heads: s.headAblations.map((x) => ({ layer: x.layer, head: x.head })), on: s.headAblationMode },
    feature_ablation: { ids: s.featureAblations.map((f) => f.feature_index), on: s.featureAblationMode },
    steering: { feature_id: pryUi.steering.selectedFeatureId, strength: pryUi.steering.alpha },
    // The pair the shown result came from when there is one, else the boxes.
    patching: pr
      ? { clean: pr.clean_prompt, corrupted: pr.corrupted_prompt, type: pr.patch_type as 'head' | 'mlp' | 'resid' }
      : { clean: ps.cleanPrompt, corrupted: ps.corruptedPrompt, type: ps.patchType },
    patch_cell: sel ? { layer: sel.layer, position: sel.position ?? sel.head ?? 0 } : null,
    dla_target: s.dlaTarget ? { answer: s.dlaTarget.answer, contrast: s.dlaTarget.contrast } : null,
    hidden: { ...pryUi.hidden },
    analyses,
  });
};

/** Engine state the request bodies don't carry: the loaded SAE layer. */
export const pryMemoContext: PrySet['memoContext'] = () => {
  if (!hasPryHost()) return 'sae:';
  return `sae:${pryHost().analysis.state.saeLayer ?? ''}`;
};
