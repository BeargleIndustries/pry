// Pry actions (plan T2 "Pry actions"): every name with its argument schema,
// effect, scope where gated, doc and `stateful` where marked, and (T2b) its
// real `run`. Aliases of the generic names (generic.ts) point at the same
// definition.
//
// Each run reaches the app through the page host (pry-state.svelte.ts). A run
// the dispatcher issues carries the runner memo as `ctx.call`; every sidecar
// request goes through it. Called any other way, requests go straight to the
// engine.
//
// Stateful actions (switch_model, switch_sae_layer) are commit-on-complete:
// they ignore the abort signal and always finish, so their result is written
// to state. Every other action is abort-and-drop: it checks the signal between
// steps and stops.

import { tick } from 'svelte';
import { z } from 'zod';
import { NotReadyError, type ActionContext, type ActionDef } from './contract';
import type { RunnerActionContext } from './dispatcher';
import { PRY_MODELS } from './pry-models';
import { directCall, type SidecarCaller } from '../../analysis-core';
import { buildEmbeddingRequest, buildSteerRequest, fetchEmbedding, searchConcepts, steerGenerate } from '../../sidecar';
import type { TokenInfo } from '../../types';
import {
  IOI_CHANGED,
  IOI_CLEAN,
  pryHost,
  pryUi,
  runWriteIt,
  type EmbeddingSide,
  type FocusSpec,
  type PatchType,
} from './pry-state.svelte';
import { pryAnchors } from './pry-anchors';
import { alignedPositions } from '../../compare';
import { showAll } from '../../watch-it-write';

export const PANELS = [
  'attention',
  'logit-lens',
  'dla',
  'patching',
  'circuit',
  'steering',
  'predictions',
  'features',
  'watch-it-write',
] as const;

export type PryPanel = (typeof PANELS)[number];
export const LEFT_PANELS: readonly string[] = ['attention', 'logit-lens', 'dla', 'patching', 'circuit'];

const layer = z.number().int().min(0);
const head = z.number().int().min(0);
const featureId = z.number().int().min(0);
const occurrence = z.union([z.literal('first'), z.literal('last'), z.number().int().min(1)]);
const noArgs = z.object({}).strict();
const embeddingSide = z.object({ prompt: z.string(), token: z.string(), occurrence: occurrence.optional() }).strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The sidecar caller for this run: the runner memo when the dispatcher issued it. */
export function callerOf(ctx: ActionContext): SidecarCaller {
  const c = (ctx as RunnerActionContext).call;
  if (!c) return directCall;
  return (req, fetcher) =>
    c({ ...req, modelRevision: pryHost().modelRevision() }, fetcher);
}

function abortIf(ctx: ActionContext): void {
  if (ctx.signal.aborted) throw ctx.signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/** Index of the nth occurrence of `text` among token texts (`first` = 1). */
function nthIndex(texts: string[], text: string, occ: 'first' | 'last' | number = 'first'): number {
  const hits = texts.flatMap((t, i) => (t === text ? [i] : []));
  if (hits.length === 0) return -1;
  if (occ === 'first') return hits[0];
  if (occ === 'last') return hits[hits.length - 1];
  return hits[occ - 1] ?? -1;
}

/** A focus spec against the run's tokens: the token's `index` (start marker = 0), or undefined. */
export function resolveFocus(tokens: TokenInfo[], spec: FocusSpec): number | undefined {
  if ('index' in spec) return tokens.some((t) => t.index === spec.index) ? spec.index : undefined;
  const i = nthIndex(
    tokens.map((t) => t.text),
    spec.text,
    spec.occurrence,
  );
  return i < 0 ? undefined : tokens[i].index;
}

/** Opens a tab. A left analysis tab that would fetch on open fetches through `call` first. */
export async function openPanel(panel: string, call: SidecarCaller): Promise<void> {
  const h = pryHost();
  const a = h.analysis;
  const s = a.state;
  const p = panel === 'watch-it-write' ? 'predictions' : panel;
  // Compare covers both panels: opening one means leaving Compare, or the
  // learner is pointed at a tab they can't see.
  if (h.getCompareMode()) h.setCompareMode(false);
  if (!LEFT_PANELS.includes(p)) {
    h.openRightTab(p);
    return;
  }
  // Start the fetch before the tab opens, so the tab's own auto-fetch sees it loading.
  let pending: Promise<void> | null = null;
  if (s.response) {
    if (p === 'logit-lens' && !s.logitLensResponse && !s.logitLensLoading) pending = a.logitLens(call);
    else if (p === 'dla' && !s.dlaResponse && !s.dlaLoading) pending = a.dla(call);
    else if (p === 'circuit' && !s.circuitResponse && !s.circuitLoading) pending = a.circuit('dla', undefined, call);
  }
  h.openLeftTab(p);
  if (pending) await pending;
}

/**
 * Brings forward the tab a compute action's result shows in (after the result
 * is in, so the tab's own fetch finds it there), leaving Compare, which covers
 * both panels. Without it a Done step can leave its result on a closed tab.
 */
function showPanel(panel: string): void {
  const h = pryHost();
  if (h.getCompareMode()) h.setCompareMode(false);
  if (LEFT_PANELS.includes(panel)) h.openLeftTab(panel);
  else h.openRightTab(panel);
}

/** Patching results per type, so set_patch_view can switch without a new run. */
function rememberPatch(): void {
  const r = pryHost().analysis.state.patchResponse;
  if (r) pryUi.patching.byType[r.patch_type as PatchType] = r;
}

async function embeddingSideFor(
  side: { prompt: string; token: string; occurrence?: 'first' | 'last' | number },
  call: SidecarCaller,
): Promise<EmbeddingSide> {
  const h = pryHost();
  const presetId = h.activePresetId();
  if (!presetId) throw new Error('Load a model first.');
  const tk = await h.analysis.tokenize(side.prompt, call);
  if (!tk) throw new Error(`Couldn't split "${side.prompt}" into tokens.`);
  const position = nthIndex(tk.tokens, side.token, side.occurrence);
  if (position < 0) throw new Error(`"${side.token}" isn't one of the tokens of "${side.prompt}".`);
  const body = buildEmbeddingRequest({ presetId, prompt: side.prompt, positions: [position] });
  const response = await call({ endpoint: '/embedding', model: presetId, body }, () =>
    fetchEmbedding(presetId, side.prompt, [position]),
  );
  return { prompt: side.prompt, token: side.token, position, response };
}

function mergePairs<T>(list: T[], add: T[], same: (a: T, b: T) => boolean, on: boolean): T[] {
  if (on) return [...list, ...add.filter((x) => !list.some((y) => same(x, y)))];
  return list.filter((y) => !add.some((x) => same(x, y)));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const set_prompt: ActionDef = {
  args: z.object({ text: z.string() }).strict(),
  doc: 'Sets the prompt.',
  effect: 'view',
  run: async (a: { text: string }) => {
    pryHost().setPrompt(a.text);
  },
};

const open_panel: ActionDef = {
  args: z.object({ panel: z.enum(PANELS) }).strict(),
  doc: 'Opens a left or right tab.',
  effect: 'view',
  run: async (a: { panel: string }, ctx) => {
    await openPanel(a.panel, callerOf(ctx));
  },
};

const compareSide = z.enum(['a', 'b']);

const focus_token: ActionDef = {
  args: z.union([
    z.object({ text: z.string(), occurrence: occurrence.optional(), side: compareSide.optional() }).strict(),
    z.object({ index: z.number().int().min(0), side: compareSide.optional() }).strict(),
  ]),
  doc: 'Selects a token by its text and which occurrence (first, last or the nth), or by index, where the start marker is 0. In Compare mode it picks the Compare position, reading the tokens of prompt `side` (a, the default, or b).',
  effect: 'view',
  run: async ({ side, ...a }: FocusSpec & { side?: 'a' | 'b' }) => {
    const h = pryHost();
    if (h.getCompareMode()) {
      const c = h.compare.state;
      const resp = side === 'b' ? c.b : c.a;
      const idx = resp ? resolveFocus(resp.tokens, a) : undefined;
      if (!resp || idx === undefined) throw new Error(`No such token in Compare prompt ${side ?? 'a'}: ${JSON.stringify(a)}`);
      const pos = resp.tokens.findIndex((t) => t.index === idx);
      const at = c.a && c.b ? alignedPositions(c.a, c.b).findIndex((p) => (side === 'b' ? p.posB : p.posA) === pos) : -1;
      if (at < 0) throw new Error(`Compare can't line up ${JSON.stringify(a)} with the other prompt; only the last word is offered when the token counts differ.`);
      c.positionIndex = at;
      return;
    }
    if (side === 'b') throw new Error('focus_token side b needs Compare mode on.');
    const s = h.analysis.state;
    const idx = s.response ? resolveFocus(s.response.tokens, a) : undefined;
    if (idx === undefined) throw new Error(`No such token in this run: ${JSON.stringify(a)}`);
    s.focusTokenIndex = idx;
  },
};

const switch_model: ActionDef = {
  args: z.object({ preset: z.enum(PRY_MODELS) }).strict(),
  doc: 'Switches the model through the load controller, licence check included. May download weights.',
  effect: 'download',
  scope: (args: { preset: string }) => args.preset,
  stateful: true,
  // Commit-on-complete: the switch always finishes; the load controller records the result.
  run: async (a: { preset: string }) => {
    await pryHost().switchModel(a.preset);
  },
};

const EMPTY_PROMPT = 'The prompt box is empty. Type a prompt first.';

const run: ActionDef = {
  args: noArgs,
  doc: 'Runs the prompt. Runner-issued runs are memoised.',
  effect: 'compute',
  run: async (_a, ctx) => {
    const h = pryHost();
    if (!h.getPrompt().trim()) throw new NotReadyError(EMPTY_PROMPT);
    await h.analysis.generate(h.getPrompt(), callerOf(ctx));
  },
};

export const pryActions: Record<string, ActionDef> = {
  set_prompt,
  set_input: set_prompt,
  run,
  ensure_run: {
    args: z.object({ prompt: z.string() }).strict(),
    doc: 'Runs the prompt only if the memo lacks this request.',
    effect: 'compute',
    run: async (a: { prompt: string }, ctx) => {
      const h = pryHost();
      h.setPrompt(a.prompt);
      const r = h.analysis.state.response;
      if (r && r.prompt === a.prompt && r.preset_id === h.activePresetId()) return;
      await h.analysis.generate(a.prompt, callerOf(ctx));
    },
  },
  open_panel,
  open_view: open_panel,
  focus_token,
  focus_item: focus_token,
  highlight: {
    args: z.union([
      z.object({ anchor: z.string() }).strict(),
      z.object({ anchors: z.array(z.string()).min(1) }).strict(),
    ]),
    doc: 'Rings an anchor. A list points at each anchor in turn.',
    effect: 'view',
    // The presenter draws the ring (T3); this records what to point at, in order.
    run: async (a: { anchor: string } | { anchors: string[] }) => {
      const anchors = 'anchor' in a ? [a.anchor] : a.anchors;
      for (const name of anchors) if (!pryAnchors[name]) throw new Error(`Unknown anchor: ${name}`);
      pryUi.highlight = { anchors, seq: (pryUi.highlight?.seq ?? 0) + 1 };
    },
  },
  set_hidden: {
    args: z.object({ anchor: z.string(), on: z.boolean() }).strict(),
    doc: 'Hides or shows a hideable region.',
    effect: 'view',
    run: async (a: { anchor: string; on: boolean }) => {
      const hide = pryAnchors[a.anchor]?.hide;
      if (!hide) throw new Error(`${a.anchor} can't be hidden.`);
      hide(a.on);
    },
  },
  reset: {
    args: noArgs,
    doc: 'Returns the app to its baseline, like Back to normal.',
    effect: 'view',
    // Today's "Back to normal" (experiments.ts resetExperiment) without the
    // guide and tour coupling: head and feature knockouts off, copying heads off,
    // the Swap test back to its default pair. The prompt stays.
    run: async () => {
      const h = pryHost();
      const s = h.analysis.state;
      s.headAblations = [];
      s.headAblationMode = false;
      // Every panel back to baseline: feature knockouts too.
      s.featureAblations = [];
      s.featureAblationMode = false;
      s.featureAblateResponse = null;
      s.headAblateResponse = null;
      h.analysis.hideHeadScores();
      h.setPatchingPreset(null);
      Object.assign(pryUi.patching, { cleanPrompt: IOI_CLEAN, corruptedPrompt: IOI_CHANGED, patchType: 'head', selectedComponent: null });
    },
  },
  set_compare_mode: {
    args: z.object({ on: z.boolean() }).strict(),
    doc: 'Turns Compare mode on or off.',
    effect: 'view',
    run: async (a: { on: boolean }) => {
      pryHost().setCompareMode(a.on);
    },
  },
  set_compare: {
    args: z.object({ a: z.string(), b: z.string() }).strict(),
    doc: 'Sets the two Compare prompts.',
    effect: 'view',
    run: async (a: { a: string; b: string }) => {
      const c = pryHost().compare.state;
      c.promptA = a.a;
      c.promptB = a.b;
    },
  },
  run_compare: {
    args: noArgs,
    doc: 'Runs both Compare prompts.',
    effect: 'compute',
    run: async (_a, ctx) => {
      await pryHost().compare.run(callerOf(ctx));
    },
  },
  write_it: {
    args: z
      .object({
        temperature: z.number().min(0),
        seed: z.number().int().optional(),
        max_tokens: z.number().int().min(1).optional(),
      })
      .strict(),
    doc: 'Runs Watch it write and returns the text.',
    effect: 'compute',
    run: async (a: { temperature: number; seed?: number; max_tokens?: number }, ctx) => {
      const w = pryUi.writeIt;
      w.temperature = a.temperature;
      if (a.max_tokens !== undefined) w.newTokens = a.max_tokens;
      // Watch it write continues a run: run the prompt first when it hasn't been (T3: P1.5's steps).
      const h = pryHost();
      const r = h.analysis.state.response;
      if (!r || r.prompt !== h.getPrompt() || r.preset_id !== h.activePresetId()) await h.analysis.generate(h.getPrompt(), callerOf(ctx));
      abortIf(ctx);
      await runWriteIt(
        pryHost().analysis.state.response,
        { temperature: a.temperature, seed: a.seed ?? null, maxTokens: a.max_tokens },
        callerOf(ctx),
      );
      // Replayed by the section fold: the learner watched it already, so it comes back written out.
      if ((ctx as RunnerActionContext).replay) w.replay = showAll(w.replay);
      showPanel('predictions');
    },
  },
  set_attention_view: {
    args: z.object({ view: z.enum(['lines', 'expert']) }).strict(),
    doc: 'Picks the attention view: Lines or Expert. Lines opens on the average over every head (what attention.avg_* reads) until a head is picked.',
    effect: 'view',
    run: async (a: { view: 'lines' | 'expert' }) => {
      pryUi.attention.view = a.view;
      if (a.view === 'lines') {
        pryUi.attention.linesPick = null;
        pryUi.attention.linesAverage = true;
      }
    },
  },
  set_aggregation: {
    args: z.object({ aggregation: z.enum(['max', 'spread', 'looks-back', 'previous', 'mean']) }).strict(),
    doc: 'Picks the Score by option for the attention grid.',
    effect: 'view',
    run: async (a: { aggregation: 'max' | 'spread' | 'looks-back' | 'previous' | 'mean' }) => {
      pryHost().setAggregation(a.aggregation);
    },
  },
  set_lines_head: {
    args: z.object({ layer, head }).strict(),
    doc: 'Picks the head the Lines view draws.',
    effect: 'view',
    run: async (a: { layer: number; head: number }) => {
      pryUi.attention.linesPick = { layer: a.layer, head: a.head };
      pryUi.attention.linesAverage = false;
    },
  },
  set_focus_mode: {
    args: z.object({ mode: z.enum(['from', 'to']) }).strict(),
    doc: 'Picks FROM or TO for the attention grid.',
    effect: 'view',
    run: async (a: { mode: 'from' | 'to' }) => {
      pryUi.attention.focusMode = a.mode;
    },
  },
  open_head: {
    args: z.object({ layer, head }).strict(),
    doc: 'Opens one attention head.',
    effect: 'view',
    run: async (a: { layer: number; head: number }) => {
      const att = pryUi.attention;
      att.view = 'expert';
      att.expandedLayer = a.layer;
      att.expandedHead = a.head;
      att.linesPick = { layer: a.layer, head: a.head };
    },
  },
  show_copying_heads: {
    args: z.object({ on: z.boolean() }).strict(),
    doc: 'Turns the Copying heads view on or off.',
    effect: 'compute',
    run: async (a: { on: boolean }, ctx) => {
      const an = pryHost().analysis;
      if (a.on) await an.showHeadScores(callerOf(ctx));
      else an.hideHeadScores();
    },
  },
  run_logit_lens: {
    args: noArgs,
    doc: 'Runs the logit lens and waits for it.',
    effect: 'compute',
    run: async (_a, ctx) => {
      await pryHost().analysis.logitLens(callerOf(ctx));
      showPanel('logit-lens');
    },
  },
  run_dla: {
    args: z.object({ answer: z.string().optional(), contrast: z.string().optional() }).strict(),
    doc: 'Runs DLA and waits for it, with an optional answer and contrast token.',
    effect: 'compute',
    run: async (a: { answer?: string; contrast?: string }, ctx) => {
      const an = pryHost().analysis;
      // With no tokens given, the current target (scene or top guess) stays.
      if (a.answer !== undefined || a.contrast !== undefined) {
        an.setSceneDlaTarget(a.answer ?? null, a.contrast ?? null);
      }
      await an.dla(callerOf(ctx));
      showPanel('dla');
    },
  },
  switch_sae_layer: {
    args: z.object({ layer }).strict(),
    doc: 'Switches the SAE layer.',
    effect: 'compute',
    stateful: true,
    // Commit-on-complete: layerSwitch records the layer once the engine has it,
    // whatever the signal says.
    run: async (a: { layer: number }, ctx) => {
      await pryHost().analysis.layerSwitch(a.layer, callerOf(ctx));
    },
  },
  open_feature: {
    args: z.object({ id: featureId }).strict(),
    doc: 'Opens the feature card for one feature id.',
    effect: 'view',
    run: async (a: { id: number }) => {
      const h = pryHost();
      const s = h.analysis.state;
      // Focus the token where the feature fires hardest, so its card is in the list.
      let best: { idx: number; act: number } | null = null;
      for (const tf of s.response?.sae_features ?? []) {
        const hit = tf.top_k.find((f) => f.id === a.id);
        if (hit && (!best || hit.activation > best.act)) best = { idx: tf.token_index, act: hit.activation };
      }
      if (best) s.focusTokenIndex = best.idx;
      pryUi.openFeatureId = a.id;
      h.openRightTab('features');
    },
  },
  search_concepts: {
    args: z.object({ text: z.string() }).strict(),
    doc: 'Looks up a concept on Neuronpedia. The learner starts it.',
    effect: 'network',
    scope: () => 'neuronpedia',
    run: async (a: { text: string }) => {
      const h = pryHost();
      const st = pryUi.steering;
      st.conceptQuery = a.text;
      h.openRightTab('steering');
      st.conceptResult = await searchConcepts(a.text, h.analysis.state.response?.preset_id ?? h.activePresetId());
    },
  },
  set_head_ablation: {
    args: z.object({ heads: z.array(z.object({ layer, head }).strict()), on: z.boolean() }).strict(),
    doc: 'Marks attention heads to knock out.',
    effect: 'view',
    run: async (a: { heads: { layer: number; head: number }[]; on: boolean }) => {
      const s = pryHost().analysis.state;
      s.headAblations = mergePairs(s.headAblations, a.heads.map((x) => ({ ...x })), (x, y) => x.layer === y.layer && x.head === y.head, a.on);
      s.headAblationMode = a.on || s.headAblations.length > 0;
    },
  },
  run_head_ablation: {
    args: noArgs,
    doc: 'Runs the prompt with the marked heads knocked out.',
    effect: 'compute',
    run: async (_a, ctx) => {
      await pryHost().analysis.runHeadAblation(callerOf(ctx));
      showPanel('attention');
    },
  },
  run_patching: {
    args: z.object({ clean: z.string(), corrupted: z.string(), type: z.enum(['head', 'mlp', 'resid']) }).strict(),
    doc: 'Runs the Swap test (activation patching) on a clean and a corrupted prompt.',
    effect: 'compute',
    run: async (a: { clean: string; corrupted: string; type: PatchType }, ctx) => {
      const h = pryHost();
      const ps = pryUi.patching;
      ps.cleanPrompt = a.clean;
      ps.corruptedPrompt = a.corrupted;
      ps.patchType = a.type;
      ps.selectedComponent = null;
      h.setPatchingPreset({ clean: a.clean, corrupted: a.corrupted, patchType: a.type });
      await h.analysis.patching(a.clean, a.corrupted, a.type, callerOf(ctx));
      rememberPatch();
      showPanel('patching');
    },
  },
  set_patch_view: {
    args: z.object({ type: z.enum(['head', 'mlp', 'resid']) }).strict(),
    doc: 'Shows one Swap test view without running it again.',
    effect: 'view',
    run: async (a: { type: PatchType }) => {
      const ps = pryUi.patching;
      rememberPatch();
      ps.patchType = a.type;
      const stored = ps.byType[a.type];
      if (stored) {
        pryHost().analysis.state.patchResponse = stored;
        ps.selectedComponent = null;
      }
    },
  },
  focus_patch_cell: {
    args: z.object({ layer, position: z.number().int().min(0) }).strict(),
    doc: 'Selects a Swap test cell so its three logits and share can be read.',
    effect: 'view',
    run: async (a: { layer: number; position: number }) => {
      const comp = findPatchCell(a.layer, a.position);
      if (!comp) throw new Error(`No Swap test cell at layer ${a.layer}, position ${a.position}.`);
      pryUi.patching.selectedComponent = comp;
    },
  },
  set_feature_ablation: {
    args: z.object({ ids: z.array(featureId), on: z.boolean() }).strict(),
    doc: 'Marks features to knock out.',
    effect: 'view',
    run: async (a: { ids: number[]; on: boolean }) => {
      const s = pryHost().analysis.state;
      const lyr = s.response?.sae_layer_used ?? s.saeLayer ?? 0;
      const add = a.ids.map((id) => ({ feature_index: id, layer: lyr }));
      s.featureAblations = mergePairs(s.featureAblations, add, (x, y) => x.feature_index === y.feature_index && x.layer === y.layer, a.on);
      s.featureAblationMode = a.on || s.featureAblations.length > 0;
    },
  },
  run_feature_ablation: {
    args: noArgs,
    doc: 'Runs the prompt with the marked features knocked out.',
    effect: 'compute',
    run: async (_a, ctx) => {
      await pryHost().analysis.runFeatureAblation(callerOf(ctx));
      showPanel('features');
    },
  },
  set_steering: {
    args: z.object({ feature_id: featureId, strength: z.number() }).strict(),
    doc: 'Sets the steering feature and Steering strength.',
    effect: 'view',
    run: async (a: { feature_id: number; strength: number }) => {
      pryUi.steering.selectedFeatureId = a.feature_id;
      pryUi.steering.alpha = a.strength;
    },
  },
  run_steer: {
    args: z.object({ control: z.literal(true).optional() }).strict(),
    doc: 'Runs steering. With control, also runs a norm-matched control feature at the same strength.',
    effect: 'compute',
    run: async (a: { control?: true }, ctx) => {
      const h = pryHost();
      const s = h.analysis.state;
      if (!h.getPrompt().trim()) throw new NotReadyError(EMPTY_PROMPT);
      // Steering continues a run: run the prompt box first when it hasn't been
      // (P3.5's transfer puts a new prompt in, then steers it). The Steering panel
      // swaps its pick for the new run's top feature; the feature and strength set
      // before this step come back once it has.
      const r = s.response;
      if (!r || r.prompt !== h.getPrompt() || r.preset_id !== h.activePresetId()) {
        const keep = { id: pryUi.steering.selectedFeatureId, alpha: pryUi.steering.alpha };
        await h.analysis.generate(h.getPrompt(), callerOf(ctx));
        abortIf(ctx);
        await tick();
        pryUi.steering.selectedFeatureId = keep.id;
        pryUi.steering.alpha = keep.alpha;
      }
      const fid = pryUi.steering.selectedFeatureId;
      if (fid === null || s.saeLayer === undefined) throw new NotReadyError('Pick a feature to steer first.');
      pryUi.steerControl = a.control === true;
      await pryHost().analysis.steer(fid, s.saeLayer, pryUi.steering.alpha, callerOf(ctx), a.control === true);
      showPanel('steering');
    },
  },
  steer_across: {
    args: z.object({ prompts: z.array(z.string()).min(1) }).strict(),
    doc: 'Runs the same steering on other prompts, to see if the effect holds.',
    effect: 'compute',
    run: async (a: { prompts: string[] }, ctx) => {
      const h = pryHost();
      const presetId = h.activePresetId();
      const lyr = h.analysis.state.saeLayer;
      const fid = pryUi.steering.selectedFeatureId;
      const alpha = pryUi.steering.alpha;
      if (!presetId || fid === null || lyr === undefined) throw new Error('Pick a feature to steer first.');
      const call = callerOf(ctx);
      const out: typeof pryUi.steerAcross = [];
      for (const prompt of a.prompts) {
        abortIf(ctx);
        const body = buildSteerRequest({ presetId, prompt, featureId: fid, saeLayer: lyr, alpha });
        const response = await call({ endpoint: '/steer', model: presetId, body }, () =>
          steerGenerate(presetId, prompt, fid, lyr, alpha),
        );
        out.push({ prompt, response });
      }
      abortIf(ctx);
      pryUi.steerAcross = out;
    },
  },
  run_circuit: {
    args: z.object({ threshold: z.number().optional() }).strict(),
    doc: 'Builds the Key parts map.',
    effect: 'compute',
    run: async (a: { threshold?: number }, ctx) => {
      if (a.threshold !== undefined) pryUi.circuit.thresholdInput = String(a.threshold);
      await pryHost().analysis.circuit('dla', a.threshold, callerOf(ctx));
      showPanel('circuit');
    },
  },
  show_embedding: {
    args: z.object({ a: embeddingSide, b: embeddingSide, split: z.boolean().optional() }).strict(),
    doc: 'Prepares the embedding reader: two token positions side by side.',
    effect: 'compute',
    run: async (
      a: { a: { prompt: string; token: string; occurrence?: 'first' | 'last' | number }; b: { prompt: string; token: string; occurrence?: 'first' | 'last' | number }; split?: boolean },
      ctx,
    ) => {
      const call = callerOf(ctx);
      const sa = await embeddingSideFor(a.a, call);
      abortIf(ctx);
      const sb = await embeddingSideFor(a.b, call);
      abortIf(ctx);
      pryUi.embedding = { a: sa, b: sb, split: a.split === true };
    },
  },
  switch_model,
  open_link: {
    args: z.object({ url: z.url() }).strict(),
    doc: 'Opens a link in the browser, always through the dispatcher.',
    effect: 'external',
    scope: (args: { url: string }) => new URL(args.url).host,
    run: async (a: { url: string }) => {
      await pryHost().openLink(a.url);
    },
  },
};

/** The Swap test cell at (layer, position): a head index for head patching, a word for residual, 0 for MLP. */
export function findPatchCell(lyr: number, position: number) {
  const r = pryHost().analysis.state.patchResponse;
  return r?.components.find((c) => c.layer === lyr && (c.position ?? c.head ?? 0) === position) ?? null;
}
