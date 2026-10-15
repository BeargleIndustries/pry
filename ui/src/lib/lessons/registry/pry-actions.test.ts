import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { pryActions } from './pry-actions';
import { pryToolSet } from './pry-set';
import { createDispatcher } from './dispatcher';
import { RequestMemo, memoKey, MEMO_MAX_BYTES } from './memo';
import { requestKey } from './request-key';
import { pryMemo, pryUi } from './pry-state.svelte';
import { ctx, makeHost, recordingFetch, type Recorded, type TestHost } from './pry-test-host';

let h: TestHost;
let calls: Recorded[];
const run = (name: string, args: unknown = {}) => pryActions[name].run(args, ctx());
const runner = () => createDispatcher(pryToolSet, pryMemo, { kind: 'bundled' });
const doStep = (name: string, args: unknown = {}, extra: object = {}) =>
  runner().dispatch(name, args, { signal: new AbortController().signal, ...extra });
const count = (endpoint: string) => calls.filter((c) => c.endpoint === endpoint).length;

beforeEach(() => {
  h = makeHost();
  calls = recordingFetch();
});
afterEach(() => vi.unstubAllGlobals());

async function ran(prompt = 'I like the river bank') {
  h.page.prompt = prompt;
  await run('run');
}

describe('Pry actions: one test per action', () => {
  it('set_prompt (and set_input) sets the prompt', async () => {
    await run('set_prompt', { text: 'The bank' });
    expect(h.page.prompt).toBe('The bank');
    await run('set_input', { text: 'Hello' });
    expect(h.page.prompt).toBe('Hello');
  });

  it('run runs generate with the prompt box', async () => {
    await ran();
    expect(calls).toEqual([
      { endpoint: '/generate', body: { preset_id: 'gpt2-small', prompt: 'I like the river bank', max_new_tokens: 0, top_k_features: 5 } },
    ]);
    expect(h.analysis.state.response?.prompt).toBe('I like the river bank');
  });

  it('ensure_run runs only when this prompt has no run', async () => {
    await run('ensure_run', { prompt: 'The bank' });
    await run('ensure_run', { prompt: 'The bank' });
    expect(count('/generate')).toBe(1);
    expect(h.page.prompt).toBe('The bank');
  });

  it('open_panel (and open_view) opens a tab and fetches what it shows', async () => {
    await ran();
    await run('open_panel', { panel: 'dla' });
    expect(h.page.leftTab).toBe('dla');
    expect(count('/dla')).toBe(1);
    await run('open_view', { panel: 'steering' });
    expect(h.page.rightTab).toBe('steering');
    await run('open_panel', { panel: 'watch-it-write' });
    expect(h.page.rightTab).toBe('predictions');
  });

  it('focus_token (and focus_item) selects by text or by index', async () => {
    await ran();
    await run('focus_token', { text: ' river' });
    expect(h.analysis.state.focusTokenIndex).toBe(4);
    await run('focus_item', { index: 0 });
    expect(h.analysis.state.focusTokenIndex).toBe(0);
    await expect(run('focus_token', { text: ' nope' })).rejects.toThrow();
  });

  it('› focus_token occurrence last picks the last " to"', async () => {
    await ran('When Mary and John went to the store, John gave a drink to');
    // <|endoftext|> When Mary and John went to(6) the store, John gave a drink to(13)
    await run('focus_token', { text: ' to', occurrence: 'last' });
    expect(h.analysis.state.focusTokenIndex).toBe(13);
    await run('focus_token', { text: ' to', occurrence: 'first' });
    expect(h.analysis.state.focusTokenIndex).toBe(6);
    await run('focus_token', { text: ' to', occurrence: 2 });
    expect(h.analysis.state.focusTokenIndex).toBe(13);
  });

  it('highlight records the anchors to point at, in order', async () => {
    await run('highlight', { anchors: ['left-tab-strip', 'right-tab-strip'] });
    expect(pryUi.highlight).toEqual({ anchors: ['left-tab-strip', 'right-tab-strip'], seq: 1 });
    await run('highlight', { anchor: 'run-button' });
    expect(pryUi.highlight).toEqual({ anchors: ['run-button'], seq: 2 });
    await expect(run('highlight', { anchor: 'no-such-anchor' })).rejects.toThrow();
  });

  it('set_hidden hides and shows a hideable region', async () => {
    await run('set_hidden', { anchor: 'predictions-panel', on: true });
    expect(pryUi.hidden['predictions-panel']).toBe(true);
    await run('set_hidden', { anchor: 'predictions-panel', on: false });
    expect(pryUi.hidden['predictions-panel']).toBe(false);
    await expect(run('set_hidden', { anchor: 'run-button', on: true })).rejects.toThrow();
  });

  it('› reset clears feature knockouts too', async () => {
    await ran();
    h.analysis.state.featureAblations = [{ feature_index: 7, layer: 8 }];
    h.analysis.state.featureAblationMode = true;
    await run('run_feature_ablation');
    expect(h.analysis.state.featureAblateResponse).not.toBeNull();
    await run('reset');
    expect(h.analysis.state.featureAblations).toEqual([]);
    expect(h.analysis.state.featureAblationMode).toBe(false);
    expect(h.analysis.state.featureAblateResponse).toBeNull();
  });

  it('reset is Back to normal without the guide or tour, and keeps the prompt', async () => {
    await ran();
    h.analysis.state.headAblations = [{ layer: 1, head: 1 }];
    h.analysis.state.headAblationMode = true;
    h.analysis.state.headScoresMode = true;
    h.page.patchingPreset = { clean: 'a', corrupted: 'b', patchType: 'mlp' };
    pryUi.patching.cleanPrompt = 'a';
    await run('reset');
    expect(h.analysis.state.headAblations).toEqual([]);
    expect(h.analysis.state.headAblationMode).toBe(false);
    expect(h.analysis.state.headScoresMode).toBe(false);
    expect(h.page.patchingPreset).toBeNull();
    expect(pryUi.patching.cleanPrompt).toMatch(/^When Mary and John/);
    expect(h.page.prompt).toBe('I like the river bank');
    expect(Object.keys(h)).not.toContain('dismissGuide');
    expect(pryActions.reset.run.toString()).not.toMatch(/dismissGuide|endTour/);
  });

  it('set_compare_mode turns Compare on and off', async () => {
    await run('set_compare_mode', { on: true });
    expect(h.page.compareMode).toBe(true);
    await run('set_compare_mode', { on: false });
    expect(h.page.compareMode).toBe(false);
  });

  it('set_compare sets both prompts', async () => {
    await run('set_compare', { a: 'The doctor said', b: 'The nurse said' });
    expect(h.compare.state.promptA).toBe('The doctor said');
    expect(h.compare.state.promptB).toBe('The nurse said');
  });

  it('run_compare runs both prompts', async () => {
    await run('set_compare', { a: 'The doctor said', b: 'The nurse said' });
    await run('run_compare');
    expect(count('/generate')).toBe(2);
    expect(h.compare.state.a?.prompt).toBe('The doctor said');
    expect(h.compare.state.b?.prompt).toBe('The nurse said');
  });

  it('› focus_token in Compare mode picks the Compare position from side a or b', async () => {
    await run('set_compare', { a: 'The doctor said that', b: 'The nurse said that' });
    await run('run_compare');
    await expect(run('focus_token', { text: ' nurse', side: 'b' })).rejects.toThrow(/needs Compare mode/);
    await run('set_compare_mode', { on: true });
    // <|endoftext|> The doctor(2) said(3) that(4); positions run from the last word: that 0, said 1, doctor 2.
    await run('focus_token', { text: ' said', side: 'b' });
    expect(h.compare.state.positionIndex).toBe(1);
    await run('focus_token', { text: ' doctor' });
    expect(h.compare.state.positionIndex).toBe(2);
    await run('focus_token', { text: ' nurse', side: 'b' });
    expect(h.compare.state.positionIndex).toBe(2);
    await expect(run('focus_token', { text: ' nurse' })).rejects.toThrow(/Compare prompt a/);
  });

  it('write_it writes with the given temperature, seed and length', async () => {
    await ran();
    await run('write_it', { temperature: 0.7, seed: 3, max_tokens: 4 });
    const g = calls.filter((c) => c.endpoint === '/generate')[1];
    expect(g.body).toEqual({ preset_id: 'gpt2-small', prompt: 'I like the river bank', max_new_tokens: 4, temperature: 0.7, seed: 3, top_k_features: 1 });
    expect(pryUi.writeIt.result?.generation).toBe(' w0 w1 w2 w3');
    expect(pryUi.writeIt.temperature).toBe(0.7);
  });

  it('set_attention_view picks Lines or Expert', async () => {
    await run('set_attention_view', { view: 'expert' });
    expect(pryUi.attention.view).toBe('expert');
  });

  it('set_aggregation picks Score by', async () => {
    await run('set_aggregation', { aggregation: 'previous' });
    expect(h.page.aggregation).toBe('previous');
  });

  it('set_lines_head picks the Lines head', async () => {
    await run('set_lines_head', { layer: 1, head: 0 });
    expect(pryUi.attention.linesPick).toEqual({ layer: 1, head: 0 });
  });

  it('set_focus_mode picks FROM or TO', async () => {
    await run('set_focus_mode', { mode: 'to' });
    expect(pryUi.attention.focusMode).toBe('to');
  });

  it('open_head opens one head in the Expert view', async () => {
    await run('open_head', { layer: 1, head: 1 });
    expect(pryUi.attention).toMatchObject({ view: 'expert', expandedLayer: 1, expandedHead: 1 });
  });

  it('show_copying_heads scores the heads once and hides again', async () => {
    await run('show_copying_heads', { on: true });
    expect(h.analysis.state.headScoresMode).toBe(true);
    expect(count('/head-scores')).toBe(1);
    await run('show_copying_heads', { on: false });
    expect(h.analysis.state.headScoresMode).toBe(false);
  });

  it('run_logit_lens waits for the logit lens', async () => {
    await ran();
    await run('run_logit_lens');
    expect(h.analysis.state.logitLensResponse?.n_layers).toBe(3);
  });

  it('run_dla waits for DLA, with an answer and contrast token', async () => {
    await ran();
    await run('run_dla', { answer: ' Mary', contrast: ' John' });
    expect(calls.at(-1)?.body).toMatchObject({ answer_token: ' Mary', contrast_token: ' John' });
    expect(h.analysis.state.dlaResponse?.contrast_token).toBe(' John');
  });

  it('switch_sae_layer switches the SAE layer', async () => {
    await ran();
    await run('switch_sae_layer', { layer: 6 });
    expect(h.analysis.state.saeLayer).toBe(6);
    expect(calls.at(-1)).toMatchObject({ endpoint: '/sae-features', body: { sae_layer: 6 } });
  });

  it('› aborting during switch_sae_layer still records the new layer', async () => {
    await ran();
    const ac = new AbortController();
    const p = runner().dispatch('switch_sae_layer', { layer: 3 }, { signal: ac.signal });
    ac.abort();
    await p;
    expect(h.analysis.state.saeLayer).toBe(3);
    expect(pryToolSet.actions.switch_sae_layer.stateful).toBe(true);
  });

  it('open_feature focuses the token where it fires most and opens its card', async () => {
    await ran();
    await run('open_feature', { id: 103 });
    expect(h.analysis.state.focusTokenIndex).toBe(3);
    expect(pryUi.openFeatureId).toBe(103);
    expect(h.page.rightTab).toBe('features');
  });

  it('search_concepts looks the concept up through the sidecar', async () => {
    await ran();
    await run('search_concepts', { text: 'the ocean' });
    expect(calls.at(-1)).toMatchObject({ endpoint: '/concept-search', body: { query: 'the ocean' } });
    expect(pryUi.steering.conceptResult?.results[0].feature_id).toBe(42);
    expect(h.page.rightTab).toBe('steering');
  });

  it('set_head_ablation marks and unmarks heads', async () => {
    await run('set_head_ablation', { heads: [{ layer: 1, head: 0 }], on: true });
    expect(h.analysis.state.headAblations).toEqual([{ layer: 1, head: 0 }]);
    expect(h.analysis.state.headAblationMode).toBe(true);
    await run('set_head_ablation', { heads: [{ layer: 1, head: 0 }], on: false });
    expect(h.analysis.state.headAblations).toEqual([]);
  });

  it('run_head_ablation runs with the marked heads', async () => {
    await ran();
    await run('set_head_ablation', { heads: [{ layer: 1, head: 0 }], on: true });
    await run('run_head_ablation');
    expect(calls.at(-1)).toMatchObject({ endpoint: '/ablate-head', body: { ablations: [{ layer: 1, head: 0 }] } });
  });

  it('run_patching runs the Swap test and fills the panel', async () => {
    await run('run_patching', { clean: 'A B', corrupted: 'A C', type: 'head' });
    expect(calls.at(-1)).toMatchObject({ endpoint: '/patch', body: { clean_prompt: 'A B', corrupted_prompt: 'A C', patch_type: 'head' } });
    expect(pryUi.patching.cleanPrompt).toBe('A B');
    expect(h.page.patchingPreset).toEqual({ clean: 'A B', corrupted: 'A C', patchType: 'head' });
  });

  it('set_patch_view shows a stored view without a new run', async () => {
    await run('run_patching', { clean: 'A B', corrupted: 'A C', type: 'resid' });
    await run('run_patching', { clean: 'A B', corrupted: 'A C', type: 'head' });
    const n = calls.length;
    await run('set_patch_view', { type: 'resid' });
    expect(calls.length).toBe(n);
    expect(h.analysis.state.patchResponse?.patch_type).toBe('resid');
  });

  it('› focus_patch_cell exposes clean, corrupted, patched and share', async () => {
    await run('run_patching', { clean: 'A B', corrupted: 'A C', type: 'head' });
    await run('focus_patch_cell', { layer: 1, position: 1 });
    expect(pryUi.patching.selectedComponent?.name).toBe('L1H1');
    expect(pryToolSet.readouts['patch.cell'].read({ layer: 1, position: 1 })).toEqual({
      layer: 1,
      position: 1,
      clean: 4,
      corrupted: 0.5,
      patched: 3,
      share: (3 - 0.5) / (4 - 0.5),
    });
  });

  it('set_feature_ablation marks features at the run\'s layer', async () => {
    await ran();
    await run('set_feature_ablation', { ids: [7], on: true });
    expect(h.analysis.state.featureAblations).toEqual([{ feature_index: 7, layer: 8 }]);
  });

  it('run_feature_ablation runs with the marked features', async () => {
    await ran();
    await run('set_feature_ablation', { ids: [7], on: true });
    await run('run_feature_ablation');
    expect(calls.at(-1)).toMatchObject({ endpoint: '/ablate-feature', body: { feature_ablations: [{ feature_index: 7, layer: 8 }] } });
  });

  it('set_steering sets the feature and strength', async () => {
    await run('set_steering', { feature_id: 7, strength: -4 });
    expect(pryUi.steering).toMatchObject({ selectedFeatureId: 7, alpha: -4 });
  });

  it('run_steer steers, with an optional control', async () => {
    await ran();
    await run('set_steering', { feature_id: 7, strength: 5 });
    await run('run_steer');
    expect(calls.at(-1)?.body).toEqual({ preset_id: 'gpt2-small', prompt: 'I like the river bank', feature_id: 7, sae_layer: 8, alpha: 5, max_new_tokens: 50 });
    await run('run_steer', { control: true });
    expect(calls.at(-1)?.body.control).toBe(true);
    expect(h.analysis.state.steerResponse?.control?.feature_id).toBe(9);
  });

  it('steer_across runs the same steering on other prompts', async () => {
    await ran();
    await run('set_steering', { feature_id: 7, strength: 5 });
    await run('steer_across', { prompts: ['One', 'Two same'] });
    expect(pryUi.steerAcross.map((r) => r.prompt)).toEqual(['One', 'Two same']);
    expect(count('/steer')).toBe(2);
  });

  it('run_circuit builds Key parts with the threshold', async () => {
    await ran();
    await run('run_circuit', { threshold: 0.2 });
    expect(calls.at(-1)).toMatchObject({ endpoint: '/circuit', body: { threshold: 0.2, source: 'dla' } });
    expect(pryUi.circuit.thresholdInput).toBe('0.2');
  });

  it('show_embedding fetches both positions for the embedding reader', async () => {
    await run('show_embedding', {
      a: { prompt: 'I like the river bank', token: ' bank' },
      b: { prompt: 'The bank', token: ' bank' },
      split: true,
    });
    expect(calls.filter((c) => c.endpoint === '/embedding').map((c) => c.body.positions)).toEqual([[5], [2]]);
    expect(pryUi.embedding?.split).toBe(true);
    expect(pryUi.embedding?.a.position).toBe(5);
  });

  it('› switch_model goes through the load controller', async () => {
    await run('switch_model', { preset: 'pythia-70m' });
    expect(h.switchModel).toHaveBeenCalledWith('pythia-70m');
    expect(h.page.active).toBe('pythia-70m');
  });

  it('open_link opens through the host', async () => {
    await run('open_link', { url: 'https://arxiv.org/abs/2211.00593' });
    expect(h.openLink).toHaveBeenCalledWith('https://arxiv.org/abs/2211.00593');
  });
});

describe('the memo: runner-issued calls only', () => {
  it('› a runner do step on a memoised request makes no sidecar call', async () => {
    await doStep('run');
    await doStep('run');
    expect(count('/generate')).toBe(1);
  });

  it('› Lessons off: two identical Runs make two sidecar calls', async () => {
    await h.analysis.generate('I like the river bank');
    await h.analysis.generate('I like the river bank');
    expect(count('/generate')).toBe(2);
    expect(pryMemo.size).toBe(0);
  });

  it('› Lessons on: a learner-pressed Run makes a sidecar call', async () => {
    await doStep('run');
    expect(pryMemo.size).toBe(1);
    // The Run button calls the controller directly, never through the dispatcher.
    await h.analysis.generate(h.getPrompt());
    expect(count('/generate')).toBe(2);
  });

  it('› a fresh do step makes a sidecar call on a memoised key', async () => {
    await doStep('run');
    await doStep('run', {}, { fresh: true });
    expect(count('/generate')).toBe(2);
    await doStep('run');
    expect(count('/generate')).toBe(2);
  });

  it('› $earlier argument resolves the learner\'s head, and the fallback when skipped', async () => {
    const args = { layer: { $earlier: 'picked_layer', fallback: 9 }, head: { $earlier: 'picked_head', fallback: 9 } };
    const journal: Record<string, unknown> = { picked_layer: 1, picked_head: 0 };
    await doStep('set_lines_head', args, { bindings: { earlier: (k: string) => journal[k], row: () => undefined } });
    expect(pryUi.attention.linesPick).toEqual({ layer: 1, head: 0 });
    await doStep('set_lines_head', args, { bindings: { earlier: () => undefined, row: () => undefined } });
    expect(pryUi.attention.linesPick).toEqual({ layer: 9, head: 9 });
  });

  it('› $row argument resolves from rows.json', async () => {
    // rows.json is T6a's output; the runner passes its lookup in.
    const rows: Record<string, Record<string, unknown>> = { 'row-7': { prompt: 'I like the money bank' } };
    await doStep('set_prompt', { text: '$row.row-7.prompt' }, { bindings: { earlier: () => undefined, row: (id: string, f: string) => rows[id]?.[f] } });
    expect(h.page.prompt).toBe('I like the money bank');
  });

  it('› $row argument resolves from the bundled rows.json constants by default', async () => {
    // Row 23's constants: the head with a heavy line to " gave" is L2H8.
    await doStep('set_lines_head', { layer: '$row.23.layer', head: '$row.23.head' }, { bindings: { earlier: () => undefined } });
    expect(pryUi.attention.linesPick).toEqual({ layer: 2, head: 8 });
  });

  it('› memo key differs when only the loaded SAE layer differs', async () => {
    const req = { endpoint: '/generate', model: 'gpt2-small', body: { preset_id: 'gpt2-small', prompt: 'x' } };
    const k = await requestKey(req);
    await ran();
    const c8 = pryToolSet.memoContext();
    h.analysis.state.saeLayer = 6;
    const c6 = pryToolSet.memoContext();
    expect(c8).not.toBe(c6);
    expect(memoKey(k, 'rev-1', c8)).not.toBe(memoKey(k, 'rev-1', c6));
  });

  it('› unseeded sampling is not memoised', async () => {
    await ran();
    await doStep('write_it', { temperature: 0.8 });
    await doStep('write_it', { temperature: 0.8 });
    expect(count('/generate')).toBe(3);
    await doStep('write_it', { temperature: 0.8, seed: 1 });
    await doStep('write_it', { temperature: 0.8, seed: 1 });
    expect(count('/generate')).toBe(4);
  });

  it('› memo evicts by bytes past 256 MB', async () => {
    const memo = new RequestMemo({ sizeOf: (v) => v as number });
    memo.set('a', 200 * 1024 * 1024);
    memo.set('b', 100 * 1024 * 1024);
    expect(memo.has('a')).toBe(false);
    expect(memo.has('b')).toBe(true);
    expect(memo.bytes).toBeLessThanOrEqual(MEMO_MAX_BYTES);
  });
});
