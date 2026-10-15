// The Pry page host the lesson walk drives (lesson-walk.ts, and through it the
// lesson checker CLI): the real analysis and compare controllers, plus a canned
// sidecar answer for requests with no recording. No vitest here, so the built
// CLI can bundle it; pry-test-host.ts wraps it for the registry tests.

import { AnalysisController, createInitialAnalysisState } from '../../analysis-core';
import { CompareController, createInitialCompareState } from '../../compare-run';
import type { Aggregation } from '../../attention-agg';
import { bindPryHost, pryMemo, resetPryUi, type PatchType, type PryHost } from './pry-state.svelte';

export interface Recorded {
  endpoint: string;
  body: any;
}

const BOS = '<|endoftext|>';

/** GPT-2-like split: start marker, then words with their leading space. */
export function fakeTokens(prompt: string): string[] {
  return [BOS, ...(prompt.match(/\s?\S+/g) ?? [])];
}

const PREDS = [
  { token: ' the', probability: 0.3, rank: 1, logit: 12.5 },
  { token: ' a', probability: 0.15, rank: 2, logit: 11.8 },
  { token: ' mat', probability: 0.1, rank: 3, logit: 11.4 },
  { token: ' his', probability: 0.05, rank: 4, logit: 10.7 },
  { token: ' her', probability: 0.04, rank: 5, logit: 10.5 },
];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return h >>> 0;
}

/** 768 numbers that depend only on `seed`. */
function vec(seed: string): number[] {
  let x = hash(seed) || 1;
  return Array.from({ length: 768 }, () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return ((x % 20000) - 10000) / 10000;
  });
}

function attention(n: number) {
  const head = (shift: number) =>
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (j > i ? 0 : j === Math.max(0, i - shift) ? 0.7 : 0.3 / Math.max(1, i))),
    );
  return [0, 1].map((layer) => ({ layer, heads: [head(layer), head(layer + 1)] }));
}

function generate(body: any) {
  const toks = fakeTokens(body.prompt);
  const layer = body.sae_layer ?? 8;
  const out: any = {
    preset_id: body.preset_id,
    prompt: body.prompt,
    tokens: toks.map((text, index) => ({ index, text })),
    attention: attention(toks.length),
    sae_features: toks.map((_, i) => ({
      token_index: i,
      top_k: [
        { id: 100 + i, activation: 5 + i, description: `label ${100 + i}`, top_activating_snippets: i % 2 ? ['a snippet'] : [] },
        { id: 7, activation: 2, description: 'shared feature', top_activating_snippets: [] },
      ],
    })),
    sae_layer_used: layer,
    top_predictions: PREDS,
    timing_ms: {},
    model_revision: 'rev-1',
  };
  if (body.max_new_tokens > 0) {
    const steps = Array.from({ length: body.max_new_tokens }, (_, i) => ({
      token: ` w${i}`,
      token_id: i,
      text: ` w${i}`,
      probability: 0.5,
      runner_up: ' x',
      runner_up_probability: 0.2,
    }));
    out.generation = steps.map((s) => s.text).join('');
    out.generation_steps = steps;
    out.temperature_used = body.temperature ?? 0;
    out.seed_used = body.seed ?? 4242;
  }
  return out;
}

function patch(body: any) {
  const comps: any[] = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let k = 0; k < 2; k++) {
      const patched = 1 + layer + k;
      comps.push({
        name: body.patch_type === 'resid' ? `resid L${layer} P${k}` : body.patch_type === 'mlp' ? `MLP${layer}` : `L${layer}H${k}`,
        layer,
        head: body.patch_type === 'head' ? k : null,
        position: body.patch_type === 'resid' ? k : null,
        effect: patched - 0.5,
        clean_logit: 4,
        corrupted_logit: 0.5,
        patched_logit: patched,
      });
      if (body.patch_type === 'mlp') break;
    }
  }
  return {
    preset_id: body.preset_id,
    clean_prompt: body.clean_prompt,
    corrupted_prompt: body.corrupted_prompt,
    patch_type: body.patch_type,
    target_token_index: 14,
    clean_predicted_token: ' Mary',
    corrupted_predicted_token: ' John',
    components: comps,
    timing_ms: {},
  };
}

function ablate(body: any) {
  return {
    preset_id: body.preset_id,
    prompt: body.prompt,
    original_predictions: PREDS.map((p) => ({ token: p.token, probability: p.probability, rank: p.rank })),
    ablated_predictions: [{ token: ' a', probability: 0.4, rank: 1 }, ...PREDS.slice(0, 4).map((p, i) => ({ token: p.token, probability: p.probability / 2, rank: i + 2 }))],
    prediction_delta: [{ token: ' the', original_prob: 0.3, ablated_prob: 0.15, delta: -0.15 }],
    ablations: body.ablations ?? null,
    feature_ablations: body.feature_ablations ?? null,
    timing_ms: {},
  };
}

/** The canned sidecar: endpoint + body → JSON. */
export function answer(endpoint: string, body: any): unknown {
  switch (endpoint) {
    case '/generate':
      return generate(body);
    case '/sae-features': {
      const g = generate({ ...body });
      return { preset_id: body.preset_id, prompt: body.prompt, tokens: g.tokens, sae_features: g.sae_features, sae_layer_used: body.sae_layer, timing_ms: {} };
    }
    case '/tokenize': {
      const t = fakeTokens(body.text);
      return { tokens: t, count: t.length };
    }
    case '/embedding': {
      const t = fakeTokens(body.prompt);
      return {
        preset_id: body.preset_id,
        prompt: body.prompt,
        tokens: t,
        positions: body.positions.map((p: number) => ({ position: p, token: t[p], embed: vec(`tok:${t[p]}`), pos_embed: vec(`pos:${p}`) })),
        status: 'ok',
      };
    }
    case '/logit-lens': {
      const t = fakeTokens(body.prompt);
      return {
        preset_id: body.preset_id,
        prompt: body.prompt,
        tokens: t.map((text, index) => ({ index, text })),
        grid: [0, 1, 2].map((l) => t.map(() => ({ predicted_token: l === 0 ? ' of' : ' the', probability: [0.1, 0.4, 0.3][l], matches_final: l > 0 }))),
        n_layers: 3,
        timing_ms: {},
      };
    }
    case '/dla': {
      const answerTok = body.answer_token ?? ' the';
      return {
        preset_id: body.preset_id,
        prompt: body.prompt,
        tokens: [],
        target_token_index: body.target_token_index ?? 0,
        target_token: 'x',
        predicted_token: ' the',
        answer_token: answerTok,
        contrast_token: body.contrast_token ?? null,
        components: [
          { name: 'L1H0', type: 'attention', layer: 1, head: 0, contribution: 2 },
          { name: 'MLP0', type: 'mlp', layer: 0, head: null, contribution: -3 },
          { name: 'L0H1', type: 'attention', layer: 0, head: 1, contribution: 1 },
        ],
        bars_total: 9.5,
        answer_logit: 12.5,
        contrast_logit: body.contrast_token ? 10 : null,
        actual: body.contrast_token ? 2.5 : 12.5,
        gap: body.contrast_token ? 7 : -3,
        timing_ms: {},
      };
    }
    case '/steer':
      return {
        preset_id: body.preset_id,
        prompt: body.prompt,
        feature_id: body.feature_id,
        alpha: body.alpha,
        sae_layer: body.sae_layer,
        original_generation: ' the cat sat',
        steered_generation: body.prompt.includes('same') ? ' the cat sat' : ' the sea rolled',
        original_top_predictions: PREDS,
        steered_top_predictions: PREDS,
        changed_token_indices: [1, 2],
        coherence: { original: -2.1, steered: -3.4 },
        scale: { strength: body.alpha, activation_p50: 1, activation_p99: 6, activation_max: 9 },
        control: body.control
          ? {
              feature_id: 9,
              decoder_norm: 1,
              steered_decoder_norm: 1,
              cosine: 0.01,
              method: 'norm_matched_lowest_cos',
              generation: ' the cat ran',
              changed_token_indices: [2],
              coherence: { original: -2.1, steered: -2.5 },
              top_predictions: [{ token: ' a', probability: 0.3, rank: 1 }],
              top_changed: [],
            }
          : null,
        timing_ms: {},
      };
    case '/ablate-head':
    case '/ablate-feature':
      return ablate(body);
    case '/patch':
      return patch(body);
    case '/circuit':
      return {
        preset_id: body.preset_id,
        prompt: body.prompt,
        threshold: body.threshold ?? 0.1,
        source: body.source,
        nodes: [{ id: 'L1H0', type: 'attention', layer: 1, head: 0, importance: 0.8 }],
        edges: [],
        timing_ms: {},
      };
    case '/head-scores':
      return {
        preset_id: body.preset_id,
        n_layers: 2,
        n_heads: 2,
        repeat_len: 3,
        sequence_tokens: [],
        previous_token_source: 'repeated_sequence',
        scores: [
          { layer: 0, head: 0, induction: 0.1, previous_token: 0.9 },
          { layer: 1, head: 1, induction: 0.95, previous_token: 0.1 },
          { layer: 1, head: 0, induction: 0.6, previous_token: 0.2 },
        ],
        top_induction: [],
        top_previous_token: [],
        timing_ms: {},
      };
    case '/concept-search':
      return {
        preset_id: body.preset_id ?? 'gpt2-small',
        sae_layer: 8,
        query: body.query,
        results: [{ feature_id: 42, description: 'the ocean', similarity: 0.8 }],
        status: 'ok',
      };
    default:
      return {};
  }
}

export interface WalkHost extends PryHost {
  page: {
    prompt: string;
    leftTab: string;
    rightTab: string;
    compareMode: boolean;
    aggregation: Aggregation;
    patchingPreset: { clean: string; corrupted: string; patchType: PatchType } | null;
    active: string | null;
  };
}

/** A fresh page: gpt2-small loaded, nothing run. Binds itself as the Pry host. */
export function makeWalkHost(prompt = 'I like the river bank'): WalkHost {
  resetPryUi();
  pryMemo.clear();
  const page = {
    prompt,
    leftTab: 'attention',
    rightTab: 'features',
    compareMode: false,
    aggregation: 'max' as Aggregation,
    patchingPreset: null as WalkHost['page']['patchingPreset'],
    active: 'gpt2-small' as string | null,
  };
  const deps = {
    getSelectedPreset: () => page.active ?? 'gpt2-small',
    getActivePresetId: () => page.active,
    ensureLoaded: async () => {},
  };
  const analysis = new AnalysisController(createInitialAnalysisState(), deps);
  // A loaded model already knows its layer menu, so a Run makes only /generate.
  analysis.state.availableSaeLayers = [6, 8];
  // ...and its loaded SAE layer (memoContext), as after any earlier Run.
  analysis.state.saeLayer = 8;
  const compare = new CompareController(createInitialCompareState(), {
    getSelectedPreset: () => page.active ?? 'gpt2-small',
    getSaeLayer: () => analysis.state.saeLayer,
    ensureLoaded: async () => {},
  });
  const host: WalkHost = {
    page,
    analysis,
    compare,
    getPrompt: () => page.prompt,
    setPrompt: (t) => {
      page.prompt = t;
    },
    getLeftTab: () => page.leftTab,
    openLeftTab: (t) => {
      page.leftTab = t;
    },
    getRightTab: () => page.rightTab,
    openRightTab: (t) => {
      page.rightTab = t;
    },
    getCompareMode: () => page.compareMode,
    setCompareMode: (on) => {
      page.compareMode = on;
    },
    getAggregation: () => page.aggregation,
    setAggregation: (a) => {
      page.aggregation = a;
    },
    setPatchingPreset: (p) => {
      page.patchingPreset = p;
    },
    activePresetId: () => page.active,
    modelRevision: () => 'rev-1',
    switchModel: async (id: string) => {
      page.active = id;
      analysis.clearForModelSwitch();
      pryMemo.onModelLoad();
    },
    openLink: async () => {},
  };
  bindPryHost(host);
  return host;
}
