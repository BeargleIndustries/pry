import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EFFECTS } from './contract';
import { GENERIC_ACTIONS, GENERIC_READOUTS } from './generic';
import { pryToolSet } from './pry-set';
import { HIDEABLE_ANCHORS } from './pry-anchors';

// Literal lists copied from the plan (pry-learning-mode-2026-10-12.md, T2 tables
// and the anchors / views / pickers / spine paragraph), so a missing name fails.
const PLAN_ACTIONS = [
  'set_prompt', 'run', 'ensure_run', 'open_panel', 'focus_token', 'highlight', 'set_hidden', 'reset',
  'set_compare_mode', 'set_compare', 'run_compare', 'write_it', 'set_attention_view', 'set_aggregation',
  'set_lines_head', 'set_focus_mode', 'open_head', 'show_copying_heads', 'run_logit_lens', 'run_dla',
  'switch_sae_layer', 'open_feature', 'search_concepts', 'set_head_ablation', 'run_head_ablation',
  'run_patching', 'set_patch_view', 'focus_patch_cell', 'set_feature_ablation', 'run_feature_ablation',
  'set_steering', 'run_steer', 'steer_across', 'run_circuit', 'show_embedding', 'switch_model', 'open_link',
];

const PLAN_READOUTS = [
  'tokens', 'token_count', 'word_tokens',
  'focus.token', 'focus.position', 'focus.word_number',
  'top_guess.token', 'top_guess.prob', 'top_guess.logit', 'prediction', 'top_k', 'rest_mass', 'shape',
  'write_it.text', 'write_it.tokens',
  'compare.delta', 'compare.tokens', 'compare.token_count', 'compare.top', 'compare.word_diff_count',
  'embedding.matches', 'embedding.cosine',
  'attention.weight', 'attention.top_source', 'attention.avg_top_source', 'attention.avg_share', 'lines_head',
  'head_scores.top',
  'lens.first_top_layer', 'lens.peak_layer', 'lens.peak_prob', 'lens.final_prob',
  'dla.bars_total', 'dla.answer_logit', 'dla.contrast_logit', 'dla.actual', 'dla.gap', 'dla.top_parts', 'dla.target',
  'features.top', 'features.has', 'features.activation', 'features.label', 'features.has_snippets',
  'ablation.heads', 'ablation.head_count', 'ablation.top_guess.token', 'ablation.delta', 'ablation.top5',
  'patch.cell', 'patch.peak',
  'feature_ablation.delta', 'feature_ablation.top5',
  'steer.text', 'steer.changed_tokens', 'steer.coherence', 'steer.control_top_changed', 'steer.persist', 'steer.scale',
  'circuit.nodes', 'circuit.target',
  'readout',
];

const PLAN_ADDED_ANCHORS = [
  'left-tab-strip', 'right-tab-strip', 'compare-button', 'lessons-toggle', 'settings-button', 'compare-prompt-b',
  'tab-key-parts', 'steering-feature-menu', 'steering-strength', 'embedding-view', 'patch-three-logits',
  'dla-total-line', 'write-it-step', 'write-it-temperature', 'write-it-seed',
  'prediction-bar', 'everything-else-row', 'token-chip', 'feature-row', 'dla-bar',
  'predictions-panel', 'patching-grid', 'feature-labels', 'embedding-values', 'steering-coherence',
];
const PLAN_ANCHORS_WITH_ARGS = ['prediction-bar', 'token-chip', 'feature-row', 'dla-bar'];
const PLAN_HIDEABLE = ['predictions-panel', 'patching-grid', 'feature-labels', 'embedding-values', 'steering-coherence'];
// Anchors the outlines name that already exist (N11 "the existing ones").
const EXISTING_ANCHORS = ['ablation-head-toggle', 'patching-panel', 'circuit-graph', 'steering-panel', 'feature-histogram'];

const PLAN_VIEWS = ['embedding-compare', 'text-diff', 'top5-pair', 'three-logits', 'summary-table'];
const PLAN_PICKERS = ['token', 'head'];
const PLAN_SPINE = ['text', 'tokens', 'embedding', 'residual-stream', 'logits', 'probabilities', 'sampling', 'append', 'repeat'];
const PLAN_STATEFUL = ['switch_model', 'switch_sae_layer'];

const set = pryToolSet;

describe('runner contract: the Pry set', () => {
  it('every generic name has a Pry entry', () => {
    for (const a of GENERIC_ACTIONS) expect(set.actions[a], a).toBeDefined();
    for (const r of GENERIC_READOUTS) expect(set.readouts[r], r).toBeDefined();
  });

  it('generic aliases share the Pry definition', () => {
    expect(set.actions.set_input).toBe(set.actions.set_prompt);
    expect(set.actions.open_view).toBe(set.actions.open_panel);
    expect(set.actions.focus_item).toBe(set.actions.focus_token);
  });

  it('every action in the plan table is declared', () => {
    for (const a of PLAN_ACTIONS) expect(set.actions[a], a).toBeDefined();
  });

  it('every readout in the plan table is declared', () => {
    for (const r of PLAN_READOUTS) expect(set.readouts[r], r).toBeDefined();
  });

  it('every anchor, view, picker and spine entry in the plan is declared', () => {
    for (const a of [...PLAN_ADDED_ANCHORS, ...EXISTING_ANCHORS]) expect(set.anchors[a], a).toBeDefined();
    for (const a of PLAN_ANCHORS_WITH_ARGS) expect(set.anchors[a].args, a).toBeDefined();
    for (const v of PLAN_VIEWS) expect(set.views[v], v).toBeDefined();
    for (const p of PLAN_PICKERS) expect(set.pickers[p], p).toBeDefined();
    expect(set.spine.map((s) => s.id)).toEqual(PLAN_SPINE);
  });

  it('hideable regions carry hide; no other anchor does', () => {
    expect([...HIDEABLE_ANCHORS].sort()).toEqual([...PLAN_HIDEABLE].sort());
    for (const [name, a] of Object.entries(set.anchors)) {
      expect(typeof a.hide === 'function', name).toBe(PLAN_HIDEABLE.includes(name));
    }
  });

  it('every entry has a doc, an args schema and a legal effect', () => {
    for (const [name, a] of Object.entries(set.actions)) {
      expect(a.doc, name).toBeTruthy();
      expect(typeof a.args.safeParse, name).toBe('function');
      expect(EFFECTS, name).toContain(a.effect);
    }
    for (const [name, r] of Object.entries(set.readouts)) expect(r.doc, name).toBeTruthy();
    for (const [name, a] of Object.entries(set.anchors)) {
      expect(a.doc, name).toBeTruthy();
      expect(a.label, name).toBeTruthy();
    }
  });

  it('stateful and gated actions follow the plan', () => {
    for (const [name, a] of Object.entries(set.actions)) {
      expect(a.stateful === true, name).toBe(PLAN_STATEFUL.includes(name));
      if (a.effect !== 'view' && a.effect !== 'compute') expect(typeof a.scope, name).toBe('function');
    }
    expect(set.actions.switch_model.effect).toBe('download');
    expect(set.actions.search_concepts.effect).toBe('network');
    expect(set.actions.search_concepts.scope!({ text: 'x' })).toBe('neuronpedia');
    expect(set.actions.open_link.effect).toBe('external');
    expect(set.actions.open_link.scope!({ url: 'https://arxiv.org/abs/2211.00593' })).toBe('arxiv.org');
  });

  it('argument schemas accept the plan forms', () => {
    const ok = (name: string, args: unknown) => expect(set.actions[name].args.safeParse(args).success, name).toBe(true);
    ok('focus_token', { text: ' to', occurrence: 'last' });
    ok('focus_token', { text: ' to', occurrence: 2 });
    ok('focus_token', { index: 0 });
    ok('highlight', { anchors: ['left-tab-strip', 'right-tab-strip'] });
    ok('write_it', { temperature: 0.7, seed: 1, max_tokens: 20 });
    ok('show_embedding', { a: { prompt: 'river bank', token: ' bank' }, b: { prompt: 'bank account', token: 'bank' }, split: true });
    ok('run_steer', { control: true });
    expect(set.actions.open_panel.args.safeParse({ panel: 'nope' }).success).toBe(false);
  });

  it('stubs throw until T2b', async () => {
    expect(() => set.actions.run.run({}, { signal: new AbortController().signal, wait() {} })).toThrow('not implemented (T2b)');
    expect(() => set.readouts.tokens.read()).toThrow('not implemented (T2b)');
    expect(() => set.anchors['compare-button'].locate()).toThrow('not implemented (T2b)');
    expect(() => set.views['text-diff'].component).toThrow('not implemented (T2b)');
    expect(() => set.pickers.token.start(new AbortController().signal)).toThrow('not implemented (T2b)');
  });

  it('models are the preset ids in sidecar/presets.json', () => {
    const presets = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../../../sidecar/presets.json', import.meta.url)), 'utf-8'),
    ) as { presets: { id: string }[] };
    expect(set.models).toEqual(presets.presets.map((p) => p.id));
  });

  it('services: neuronpedia on neuronpedia.org', () => {
    expect(set.services.neuronpedia.host).toBe('neuronpedia.org');
    expect(set.idPrefix).toBe('pry.');
    expect(set.lessonDir).toBe('lessons');
  });
});
