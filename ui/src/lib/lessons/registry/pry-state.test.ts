import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { pryApply, pryBaselineSchema, pryOverlaySchema, prySnapshot, pryTarget } from './pry-apply';
import { pryUi } from './pry-state.svelte';
import { ctx, makeHost, recordingFetch, type Recorded, type TestHost } from './pry-test-host';

let h: TestHost;
let calls: Recorded[];

beforeEach(() => {
  h = makeHost();
  calls = recordingFetch();
});
afterEach(() => vi.unstubAllGlobals());

const scene = (baseline: object, overlay: object = {}) => pryTarget(baseline, overlay);

describe('Pry scene state', () => {
  it('› apply(snapshot()) then snapshot() is equal', async () => {
    await pryApply(
      scene(
        { prompt: 'When Mary and John went to the store, John gave a drink to', run: true },
        {
          open_panel: ['dla', 'steering'],
          focus_token: { text: ' John', occurrence: 'last' },
          dla_target: { answer: ' Mary', contrast: ' John' },
          head_ablation: { heads: [{ layer: 1, head: 0 }], on: true },
          steering: { feature_id: 7, strength: 4 },
          hidden: { 'predictions-panel': true },
          analyses: ['logit_lens', 'head_ablation', 'patching'],
          patch_cell: { layer: 1, position: 1 },
        },
      ),
      ctx(),
    );
    const before = prySnapshot();
    const n = calls.length;
    await pryApply(before, ctx());
    expect(prySnapshot()).toEqual(before);
    expect(calls.length).toBe(n);
  });

  it('apply runs in the fixed order: model, SAE layer, prompt, run, panel state, analyses', async () => {
    await pryApply(scene({ model: 'pythia-70m', prompt: 'The bank', run: true, sae_layer: 3 }, { open_panel: 'logit-lens' }), ctx());
    expect(h.switchModel).toHaveBeenCalledWith('pythia-70m');
    // (/models refills the layer menu after the switch.)
    expect(calls.map((c) => c.endpoint).filter((e) => e !== '/models')).toEqual(['/generate', '/sae-features', '/logit-lens']);
    expect(calls[0].body.preset_id).toBe('pythia-70m');
    expect(h.analysis.state.saeLayer).toBe(3);
    expect(h.page.leftTab).toBe('logit-lens');
  });

  it('an abort stops apply between steps, after a stateful step commits', async () => {
    const ac = new AbortController();
    h.switchModel.mockImplementationOnce(async (id: string) => {
      ac.abort();
      h.page.active = id;
    });
    await expect(pryApply(scene({ model: 'pythia-70m', prompt: 'The bank', run: true }), ctx(ac.signal))).rejects.toBeDefined();
    expect(h.page.active).toBe('pythia-70m');
    expect(calls).toEqual([]);
  });

  it('target folds an overlay onto the baseline and a later enter wins', () => {
    const s1 = scene({ prompt: 'A' }, { open_panel: 'dla', run: true });
    const s2 = pryTarget({ prompt: 'A' }, { open_panel: 'patching' }, s1);
    expect(s2.left_panel).toBe('patching');
    expect(s2.run).toBe(true);
    expect(pryTarget({ prompt: 'A' }, { reset: true }).left_panel).toBe('attention');
  });

  it('baseline and overlay schemas are strict and take dla_target and reset', () => {
    expect(pryOverlaySchema.safeParse({ dla_target: { answer: ' Mary', contrast: ' John' }, reset: true }).success).toBe(true);
    expect(pryOverlaySchema.safeParse({ prompt: 'x', extra: 1 }).success).toBe(false);
    expect(pryBaselineSchema.safeParse({ prompt: 'x', reset: true }).success).toBe(false);
    expect(pryOverlaySchema.safeParse({ hidden: { 'predictions-panel': true } }).success).toBe(true);
    expect(pryOverlaySchema.safeParse({ hidden: { 'run-button': true } }).success).toBe(false);
  });

  it('workspaceSplit starts as the wide layout', () => {
    expect(pryUi.workspaceSplit).toBe(true);
  });
});
