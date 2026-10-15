import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('./sidecar', async (importOriginal) => ({ ...(await importOriginal<typeof import('./sidecar')>()), sidecarFetch: fetchMock }));

import { COMPARE_TOP_K_FEATURES, CompareController, createInitialCompareState } from './compare-run';

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('CompareController', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  function make(saeLayer: number | undefined) {
    const state = createInitialCompareState();
    const ensureLoaded = vi.fn(async () => {});
    const c = new CompareController(state, {
      getSelectedPreset: () => 'gpt2-small',
      getSaeLayer: () => saeLayer,
      ensureLoaded,
    });
    return { c, state, ensureLoaded };
  }

  it('runs /generate once per prompt with the current SAE layer and a wider feature list', async () => {
    fetchMock.mockImplementation(async (_path: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return ok({ prompt: body.prompt, tokens: [] });
    });
    const { c, state, ensureLoaded } = make(6);
    await c.run();
    expect(ensureLoaded).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([path, init]) => ({ path, ...JSON.parse(init.body) }));
    expect(bodies[0]).toMatchObject({
      path: '/generate',
      preset_id: 'gpt2-small',
      prompt: 'The doctor said that',
      max_new_tokens: 0,
      sae_layer: 6,
      top_k_features: COMPARE_TOP_K_FEATURES,
    });
    expect(bodies[1].prompt).toBe('The nurse said that');
    expect(state.a?.prompt).toBe('The doctor said that');
    expect(state.b?.prompt).toBe('The nurse said that');
    expect(state.running).toBe(false);
    expect(c.edited).toBe(false);
    state.promptB = 'The nurse said';
    expect(c.edited).toBe(true);
  });

  it('omits sae_layer when none is chosen yet', async () => {
    fetchMock.mockResolvedValue(ok({ prompt: 'x', tokens: [] }));
    const { c } = make(undefined);
    await c.run();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('sae_layer');
  });

  it('reports an error and keeps old results when a call fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => '' });
    const { c, state } = make(6);
    await c.run();
    expect(state.error).toMatch(/500/);
    expect(state.a).toBeNull();
  });

  it('asks for both prompts', async () => {
    const { c, state } = make(6);
    state.promptB = '  ';
    await c.run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.error).toMatch(/both boxes/);
  });

  it('drops results that arrive after a model switch cleared the panel', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async () => { await gate; return ok({ tokens: [], predictions: [] }); });
    const { c, state } = make(8);
    const running = c.run();
    await Promise.resolve();
    c.clear();
    release();
    await running;
    expect(state.a).toBeNull();
    expect(state.b).toBeNull();
    expect(state.running).toBe(false);
  });

  it('swap and clear', () => {
    const { c, state } = make(6);
    c.swap();
    expect(state.promptA).toBe('The nurse said that');
    state.positionIndex = 2;
    c.clear();
    expect(state.positionIndex).toBe(0);
  });
});
