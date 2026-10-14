import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { pryActions } from './pry-actions';
import { pryReadouts, type PrySource } from './pry-readouts';
import { pryAnchors } from './pry-anchors';
import { pryUi } from './pry-state.svelte';
import { ctx, makeHost, recordingFetch, type TestHost } from './pry-test-host';

let h: TestHost;
const r = (name: string, args?: unknown) => pryReadouts[name].read(args);
const act = (name: string, args: unknown = {}) => pryActions[name].run(args, ctx());

beforeEach(() => {
  h = makeHost();
  recordingFetch();
});
afterEach(() => vi.unstubAllGlobals());

/** P1.2's prompt (outlines/P1.2.md, row 7). */
const P12 = 'I like the river bank';

async function ran(prompt = P12) {
  h.page.prompt = prompt;
  await act('run');
}

describe('Pry readouts: one test per readout', () => {
  it('result is a plain copy of everything the readouts read', async () => {
    await ran();
    const res = r('result') as PrySource;
    expect(res.response?.prompt).toBe(P12);
    expect(() => structuredClone(res)).not.toThrow();
  });

  it('tokens', async () => {
    await ran();
    expect(r('tokens')).toEqual(['<|endoftext|>', 'I', ' like', ' the', ' river', ' bank']);
  });

  it('token_count', async () => {
    await ran();
    expect(r('token_count')).toBe(6);
  });

  it('› word_tokens counts one word\'s strip entries', async () => {
    // GPT-2 cuts " Leclerc" into three; the fake engine cuts words whole, so test the counter directly too.
    await ran('It was unbelievable, said Leclerc');
    expect(r('word_tokens', { word: ' unbelievable,' })).toBe(1);
    expect(r('word_tokens', { word: 'nope' })).toBeUndefined();
    const { wordTokenCount } = await import('./pry-readouts');
    expect(wordTokenCount(['<|endoftext|>', ' said', ' Le', 'cl', 'erc'], ' Leclerc')).toBe(3);
    expect(wordTokenCount(['<|endoftext|>', ' said', ' Le', 'cl', 'erc'], 'Leclerc')).toBe(3);
  });

  it('focus.token', async () => {
    await ran();
    await act('focus_token', { text: ' river' });
    expect(r('focus.token')).toBe(' river');
  });

  it('focus.position', async () => {
    await ran();
    expect(r('focus.position')).toBe(5);
  });

  it('focus.word_number', async () => {
    await ran();
    await act('focus_token', { index: 1 });
    expect(r('focus.word_number')).toBe(2);
  });

  it('› " bank" in P1.2\'s prompt reads focus.position 5 and focus.word_number 6', async () => {
    await ran(P12);
    await act('focus_token', { text: ' bank' });
    expect(r('focus.position')).toBe(5);
    expect(r('focus.word_number')).toBe(6);
  });

  it('top_guess.token', async () => {
    await ran();
    expect(r('top_guess.token')).toBe(' the');
  });

  it('top_guess.prob', async () => {
    await ran();
    expect(r('top_guess.prob')).toBe(0.3);
  });

  it('top_guess.logit', async () => {
    await ran();
    expect(r('top_guess.logit')).toBe(12.5);
  });

  it('prediction', async () => {
    await ran();
    expect(r('prediction', { token: ' mat' })).toEqual({ prob: 0.1, logit: 11.4, rank: 3 });
    expect(r('prediction', { token: ' dog' })).toBeUndefined();
  });

  it('top_k', async () => {
    await ran();
    expect((r('top_k') as unknown[])[1]).toEqual({ token: ' a', prob: 0.15, logit: 11.8 });
  });

  it('rest_mass', async () => {
    await ran();
    expect(r('rest_mass')).toBeCloseTo(1 - 0.64);
  });

  it('shape', async () => {
    await ran();
    expect(r('shape')).toBe('few');
    const { shapeOf } = await import('./pry-readouts');
    expect(shapeOf([{ token: 'x', probability: 0.6, rank: 1 }])).toBe('most');
    expect(shapeOf([{ token: 'x', probability: 0.2, rank: 1 }])).toBe('spread');
  });

  it('write_it.text', async () => {
    await ran();
    await act('write_it', { temperature: 0, max_tokens: 2 });
    expect(r('write_it.text')).toBe(' w0 w1');
  });

  it('write_it.tokens', async () => {
    await ran();
    await act('write_it', { temperature: 0, max_tokens: 2 });
    expect(r('write_it.tokens')).toEqual([' w0', ' w1']);
  });

  async function compared() {
    await act('set_compare', { a: 'The doctor said that', b: 'The nurse said that' });
    await act('run_compare');
  }

  it('compare.delta', async () => {
    await compared();
    expect(r('compare.delta', { token: ' the' })).toBe(0);
  });

  it('compare.prediction reads one token on one side, undefined before Compare runs', async () => {
    expect(r('compare.prediction', { side: 'b', token: ' a' })).toBeUndefined();
    await compared();
    expect(r('compare.prediction', { side: 'b', token: ' a' })).toEqual({ prob: 0.15, logit: 11.8, rank: 2 });
    expect(r('compare.prediction', { side: 'a', token: ' zebra' })).toBeUndefined();
  });

  it('compare.tokens', async () => {
    await compared();
    expect(r('compare.tokens', { side: 'b' })).toEqual(['<|endoftext|>', 'The', ' nurse', ' said', ' that']);
  });

  it('compare.token_count', async () => {
    await compared();
    expect(r('compare.token_count', { side: 'a' })).toBe(5);
  });

  it('compare.top', async () => {
    await compared();
    expect(r('compare.top', { side: 'a' })).toEqual({ token: ' the', prob: 0.3, logit: 12.5 });
  });

  it('compare.word_diff_count', async () => {
    await compared();
    expect(r('compare.word_diff_count')).toBe(1);
  });

  it('› embedding.matches is 768 for " bank" at the same position', async () => {
    await act('show_embedding', { a: { prompt: P12, token: ' bank' }, b: { prompt: 'I like the money bank', token: ' bank' } });
    expect(r('embedding.matches', { part: 'sum' })).toBe(768);
    expect(r('embedding.matches', { part: 'embed' })).toBe(768);
    await act('show_embedding', { a: { prompt: P12, token: ' bank' }, b: { prompt: 'The bank', token: ' bank' }, split: true });
    expect(r('embedding.matches', { part: 'embed' })).toBe(768);
    expect(r('embedding.matches', { part: 'pos' })).toBeLessThan(768);
  });

  it('embedding.cosine', async () => {
    await act('show_embedding', { a: { prompt: P12, token: ' bank' }, b: { prompt: 'I like the money bank', token: ' bank' } });
    expect(r('embedding.cosine', { part: 'sum' })).toBeCloseTo(1);
  });

  it('attention.weight', async () => {
    await ran();
    expect(r('attention.weight', { layer: 0, head: 0, from: 3, to: 3 })).toBe(0.7);
  });

  it('attention.top_source', async () => {
    await ran();
    expect(r('attention.top_source', { layer: 1, head: 0, from: 3 })).toMatchObject({ position: 2, token: ' like' });
  });

  it('attention.avg_top_source', async () => {
    await ran();
    expect(r('attention.avg_top_source', { from: 4 })).toMatchObject({ position: expect.any(Number) });
  });

  it('attention.avg_share', async () => {
    await ran();
    expect(r('attention.avg_share', { from: 0, to: 0 })).toBeCloseTo(0.7);
  });

  it('lines_head', async () => {
    await ran();
    await act('set_lines_head', { layer: 1, head: 1 });
    expect(r('lines_head')).toEqual({ layer: 1, head: 1 });
    pryUi.attention.linesPick = null;
    expect(r('lines_head')).toEqual(expect.objectContaining({ layer: expect.any(Number), head: expect.any(Number) }));
  });

  it('head_scores.top', async () => {
    await act('show_copying_heads', { on: true });
    expect(r('head_scores.top', { n: 2 })).toEqual([
      { layer: 1, head: 1, induction: 0.95 },
      { layer: 1, head: 0, induction: 0.6 },
    ]);
  });

  it('lens.first_top_layer', async () => {
    await ran();
    await act('run_logit_lens');
    expect(r('lens.first_top_layer', { token: ' the' })).toBe(1);
  });

  it('lens.peak_layer', async () => {
    await ran();
    await act('run_logit_lens');
    expect(r('lens.peak_layer', { token: ' the' })).toBe(1);
  });

  it('lens.peak_prob', async () => {
    await ran();
    await act('run_logit_lens');
    expect(r('lens.peak_prob', { token: ' the' })).toBe(0.4);
  });

  it('lens.final_prob', async () => {
    await ran();
    await act('run_logit_lens');
    expect(r('lens.final_prob', { token: ' the' })).toBe(0.3);
  });

  async function dlaRan(contrast = true) {
    await ran();
    await act('run_dla', contrast ? { answer: ' Mary', contrast: ' John' } : {});
  }

  it('dla.bars_total', async () => {
    await dlaRan();
    expect(r('dla.bars_total')).toBe(9.5);
  });

  it('dla.answer_logit', async () => {
    await dlaRan();
    expect(r('dla.answer_logit')).toBe(12.5);
  });

  it('dla.contrast_logit', async () => {
    await dlaRan();
    expect(r('dla.contrast_logit')).toBe(10);
  });

  it('dla.actual', async () => {
    await dlaRan();
    expect(r('dla.actual')).toBe(2.5);
  });

  it('dla.gap', async () => {
    await dlaRan();
    expect(r('dla.gap')).toBe(7);
  });

  it('dla.top_parts', async () => {
    await dlaRan();
    expect(r('dla.top_parts', { n: 2 })).toEqual([
      { part: 'MLP0', contribution: -3 },
      { part: 'L1H0', contribution: 2 },
    ]);
  });

  it('dla.target', async () => {
    await dlaRan();
    expect(r('dla.target')).toEqual({ answer: ' Mary', contrast: ' John' });
  });

  it('features.top', async () => {
    await ran();
    expect(r('features.top', { n: 1 })).toEqual([{ id: 105, label: 'label 105', activation: 10 }]);
  });

  it('› features.top hides labels while feature-labels is hidden', async () => {
    await ran();
    pryAnchors['feature-labels'].hide!(true);
    expect(r('features.top', { n: 2 })).toEqual([
      { id: 105, label: undefined, activation: 10 },
      { id: 7, label: undefined, activation: 2 },
    ]);
    expect(r('features.label', { id: 7 })).toBeUndefined();
    pryAnchors['feature-labels'].hide!(false);
    expect((r('features.top', { n: 1 }) as { label: string }[])[0].label).toBe('label 105');
  });

  it('features.has', async () => {
    await ran();
    expect(r('features.has', { id: 7 })).toBe(true);
    expect(r('features.has', { label: 'SHARED' })).toBe(true);
    expect(r('features.has', { id: 999 })).toBe(false);
  });

  it('features.activation', async () => {
    await ran();
    expect(r('features.activation', { id: 105 })).toBe(10);
  });

  it('features.label', async () => {
    await ran();
    expect(r('features.label', { id: 7 })).toBe('shared feature');
  });

  it('features.has_snippets', async () => {
    await ran();
    expect(r('features.has_snippets', { id: 101 })).toBe(true);
    expect(r('features.has_snippets', { id: 102 })).toBe(false);
  });

  async function knocked() {
    await ran();
    await act('set_head_ablation', { heads: [{ layer: 1, head: 0 }], on: true });
    await act('run_head_ablation');
  }

  it('ablation.heads', async () => {
    await knocked();
    expect(r('ablation.heads')).toEqual([{ layer: 1, head: 0 }]);
  });

  it('ablation.head_count', async () => {
    await knocked();
    expect(r('ablation.head_count')).toBe(1);
  });

  it('ablation.top_guess.token', async () => {
    await knocked();
    expect(r('ablation.top_guess.token')).toBe(' a');
  });

  it('ablation.delta', async () => {
    await knocked();
    expect(r('ablation.delta', { token: ' the' })).toBe(-0.15);
  });

  it('ablation.prediction reads one token before and after, undefined before a knockout run', async () => {
    expect(r('ablation.prediction', { side: 'ablated', token: ' the' })).toBeUndefined();
    await knocked();
    expect(r('ablation.prediction', { side: 'original', token: ' the' })).toEqual({ prob: 0.3, logit: undefined, rank: 1 });
    expect(r('ablation.prediction', { side: 'ablated', token: ' the' })).toEqual({ prob: 0.15, logit: undefined, rank: 2 });
    expect(r('ablation.prediction', { side: 'ablated', token: ' zebra' })).toBeUndefined();
  });

  it('ablation.top5', async () => {
    await knocked();
    expect((r('ablation.top5', { side: 'ablated' }) as unknown[]).length).toBe(5);
    expect((r('ablation.top5', { side: 'original' }) as { token: string }[])[0].token).toBe(' the');
  });

  it('patch.cell', async () => {
    await act('run_patching', { clean: 'A B', corrupted: 'A C', type: 'resid' });
    expect(r('patch.cell', { layer: 0, position: 1 })).toEqual({ layer: 0, position: 1, clean: 4, corrupted: 0.5, patched: 2, share: 1.5 / 3.5 });
  });

  it('patch.focused reads the selected cell, undefined when none is selected', async () => {
    await act('run_patching', { clean: 'A B', corrupted: 'A C', type: 'head' });
    expect(r('patch.focused')).toBeUndefined();
    await act('focus_patch_cell', { layer: 1, position: 0 });
    expect(r('patch.focused')).toEqual({ layer: 1, head: 0, clean: 4, corrupted: 0.5, patched: 2, share: 1.5 / 3.5 });
    await act('run_patching', { clean: 'A B', corrupted: 'A C', type: 'resid' });
    await act('focus_patch_cell', { layer: 0, position: 1 });
    expect(r('patch.focused')).toMatchObject({ layer: 0, position: 1 });
  });

  it('patch.peak', async () => {
    await act('run_patching', { clean: 'A B', corrupted: 'A C', type: 'head' });
    expect(r('patch.peak', { type: 'head' })).toMatchObject({ layer: 1, position: 1, patched: 3 });
  });

  it('feature_ablation.count', async () => {
    await ran();
    expect(r('feature_ablation.count')).toBe(0);
    await act('set_feature_ablation', { ids: [7, 105], on: true });
    expect(r('feature_ablation.count')).toBe(2);
    await act('set_feature_ablation', { ids: [7], on: false });
    expect(r('feature_ablation.count')).toBe(1);
  });

  it('feature_ablation.delta', async () => {
    await ran();
    await act('set_feature_ablation', { ids: [7], on: true });
    await act('run_feature_ablation');
    expect(r('feature_ablation.delta', { token: ' the' })).toBe(-0.15);
  });

  it('feature_ablation.prediction reads one token before and after, undefined before a knockout run', async () => {
    expect(r('feature_ablation.prediction', { side: 'original', token: ' a' })).toBeUndefined();
    await ran();
    await act('set_feature_ablation', { ids: [7], on: true });
    await act('run_feature_ablation');
    expect(r('feature_ablation.prediction', { side: 'original', token: ' a' })).toEqual({ prob: 0.15, logit: undefined, rank: 2 });
    expect(r('feature_ablation.prediction', { side: 'ablated', token: ' a' })).toEqual({ prob: 0.4, logit: undefined, rank: 1 });
  });

  it('feature_ablation.top5', async () => {
    await ran();
    await act('set_feature_ablation', { ids: [7], on: true });
    await act('run_feature_ablation');
    expect((r('feature_ablation.top5', { side: 'ablated' }) as { token: string }[])[0].token).toBe(' a');
  });

  async function steered(control = true) {
    await ran();
    await act('set_steering', { feature_id: 7, strength: 8 });
    await act('run_steer', control ? { control: true } : {});
  }

  it('steer.text', async () => {
    await steered();
    expect(r('steer.text', { which: 'steered' })).toBe(' the sea rolled');
    expect(r('steer.text', { which: 'control' })).toBe(' the cat ran');
  });

  it('steer.changed_tokens', async () => {
    await steered();
    expect(r('steer.changed_tokens')).toBe(2);
  });

  it('steer.coherence', async () => {
    await steered();
    expect(r('steer.coherence', { which: 'original' })).toBe(-2.1);
    expect(r('steer.coherence', { which: 'control' })).toBe(-2.5);
  });

  it('steer.control_top_changed', async () => {
    await steered();
    expect(r('steer.control_top_changed')).toBe(true);
  });

  it('steer.persist', async () => {
    await steered(false);
    await act('steer_across', { prompts: ['One', 'Two same', 'Three'] });
    expect(r('steer.persist', { measure: 'count' })).toBe(3);
    expect(r('steer.persist', { measure: 'changed' })).toBe(2);
    expect(r('steer.persist', { measure: 'share' })).toBeCloseTo(2 / 3);
  });

  it('steer.scale', async () => {
    await steered(false);
    expect(r('steer.scale')).toEqual({ strength: 8, activation_p50: 1, activation_p99: 6, activation_max: 9 });
  });

  it('circuit.nodes', async () => {
    await ran();
    await act('run_circuit');
    expect(r('circuit.nodes')).toEqual([{ id: 'L1H0', type: 'attention', layer: 1, head: 0, importance: 0.8 }]);
  });

  it('circuit.target', async () => {
    await ran();
    await act('run_circuit');
    expect(r('circuit.target')).toEqual({ token: ' bank', position: 5 });
  });

  it('readout', async () => {
    await ran();
    expect(typeof r('readout', { panel: 'predictions' })).toBe('string');
    expect(r('readout', { panel: 'dla' })).toBeUndefined();
  });

  it('› a readout with from: reads the capture, not current state', async () => {
    await ran(P12);
    const capture = r('result') as PrySource;
    await ran('The bank');
    expect(r('top_guess.token')).toBe(' the');
    expect(r('token_count')).toBe(3);
    expect(r('token_count', { from_capture: capture })).toBe(6);
    expect(r('tokens', { from_capture: capture })).toContain(' river');
  });

  it('every readout returns undefined before anything ran', () => {
    for (const [name, def] of Object.entries(pryReadouts)) {
      if (['result', 'ablation.heads', 'ablation.head_count', 'feature_ablation.count'].includes(name)) continue;
      expect(def.read({}), name).toBeUndefined();
    }
  });
});
