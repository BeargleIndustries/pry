import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `$lib/sidecar` (imported relatively by the analysis module, since vitest here
// has no SvelteKit alias). Every analysis call is a spy.
vi.mock('./sidecar', async (importOriginal) => ({
  // The request builders stay real: the controller builds bodies with them.
  ...(await importOriginal<typeof import('./sidecar')>()),
  // Delegates to the (stubbed) global fetch so tests can inspect URL + body.
  sidecarFetch: vi.fn((path: string, init?: RequestInit) => fetch(`http://sidecar.test${path}`, init)),
  switchSaeLayer: vi.fn(async (_p: string, _prompt: string, layer: number) => ({
    preset_id: 'gpt2-small',
    prompt: 'ran prompt',
    sae_features: [],
    sae_layer_used: layer,
    timing_ms: { sae: 1 },
  })),
  fetchLogitLens: vi.fn(async () => ({ kind: 'logit-lens' })),
  fetchDLA: vi.fn(async () => ({ kind: 'dla' })),
  steerGenerate: vi.fn(async () => ({ kind: 'steer' })),
  ablateHeads: vi.fn(async () => ({ kind: 'ablate-heads' })),
  ablateFeatures: vi.fn(async () => ({ kind: 'ablate-features' })),
  runPatching: vi.fn(async () => ({ kind: 'patch' })),
  fetchCircuit: vi.fn(async () => ({ kind: 'circuit' })),
  fetchHeadScores: vi.fn(async (presetId: string) => ({ kind: 'head-scores', preset_id: presetId })),
  listModels: vi.fn(async () => ({
    loaded: ['gpt2-small'],
    active: 'gpt2-small',
    available: [
      { id: 'gpt2-small', tier: 'free', downloaded: true, available_sae_layers: [0, 6, 11] },
      { id: 'pythia-70m', tier: 'free', downloaded: false, available_sae_layers: [0, 1] },
    ],
  })),
}));

import * as sidecar from './sidecar';
import {
  AnalysisController,
  DLA_FOCUS_DEBOUNCE_MS,
  createInitialAnalysisState,
  patchLengthStatus,
} from './analysis-core';
import type { GenerateResponse } from './types';

const RAN = 'ran prompt';
const EDITED = 'edited text box';

function fakeResponse(prompt = RAN): GenerateResponse {
  return {
    preset_id: 'gpt2-small',
    prompt,
    tokens: [
      { index: 0, text: 'ran' },
      { index: 1, text: ' prompt' },
    ] as unknown as GenerateResponse['tokens'],
    attention: [],
    sae_features: [],
    sae_layer_used: 6,
    timing_ms: {},
  };
}

function makeController(withResponse = true) {
  const state = createInitialAnalysisState();
  if (withResponse) state.response = fakeResponse();
  const deps = {
    getSelectedPreset: () => 'gpt2-small',
    getActivePresetId: (): string | null => 'gpt2-small',
    ensureLoaded: vi.fn(async () => {}),
  };
  return { ctl: new AnalysisController(state, deps), state, deps };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('analysis dispatchers use response.prompt, not the text box', () => {
  it('every analysis call sends the prompt that was run', async () => {
    const { ctl, state } = makeController();
    // The user typed something new but did not press Run.
    expect(ctl.isPromptEdited(EDITED)).toBe(true);
    expect(ctl.analysisPrompt).toBe(RAN);

    await ctl.logitLens();
    await ctl.dla();
    await ctl.steer(42, 6, 5);
    ctl.toggleHeadAblation(0, 1);
    await ctl.runHeadAblation();
    ctl.toggleFeatureAblation(7, 6);
    await ctl.runFeatureAblation();
    await ctl.circuit('dla');
    await ctl.layerSwitch(8);

    expect(sidecar.fetchLogitLens).toHaveBeenCalledWith('gpt2-small', RAN);
    expect(sidecar.fetchDLA).toHaveBeenCalledWith('gpt2-small', RAN, state.focusTokenIndex);
    expect(sidecar.steerGenerate).toHaveBeenCalledWith('gpt2-small', RAN, 42, 6, 5);
    expect(sidecar.ablateHeads).toHaveBeenCalledWith('gpt2-small', RAN, [{ layer: 0, head: 1 }]);
    expect(sidecar.ablateFeatures).toHaveBeenCalledWith('gpt2-small', RAN, [{ feature_index: 7, layer: 6 }]);
    expect(sidecar.fetchCircuit).toHaveBeenCalledWith('gpt2-small', RAN, 'dla', undefined, state.focusTokenIndex);
    expect(sidecar.switchSaeLayer).toHaveBeenCalledWith('gpt2-small', RAN, 8);

    const allCalls = [
      sidecar.fetchLogitLens, sidecar.fetchDLA, sidecar.steerGenerate, sidecar.ablateHeads,
      sidecar.ablateFeatures, sidecar.fetchCircuit, sidecar.switchSaeLayer,
    ].flatMap((fn) => vi.mocked(fn).mock.calls as unknown[][]);
    expect(allCalls.some((args) => args.includes(EDITED))).toBe(false);
  });

  it('generate is the one call that reads the text box', async () => {
    const { ctl, state } = makeController(false);
    const fetchSpy = vi.fn(async (_url: string, init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => fakeResponse(JSON.parse(init.body).prompt),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await ctl.generate(EDITED);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).prompt).toBe(EDITED);
    expect(state.response?.prompt).toBe(EDITED);
    expect(ctl.isPromptEdited(EDITED)).toBe(false);
    expect(state.focusTokenIndex).toBe(1);
  });
});

describe('Features layer menu on a fresh profile', () => {
  function stubGenerate() {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => fakeResponse() })));
  }

  it('the first Run fills the layer list when nothing filled it at mount', async () => {
    // Fresh profile: no saved model, so the mount path never looked up layers.
    const { ctl, state } = makeController(false);
    expect(state.availableSaeLayers).toEqual([]);
    stubGenerate();
    try {
      await ctl.generate(RAN);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(state.availableSaeLayers).toEqual([0, 6, 11]);
  });

  it('does not refetch once the list is known', async () => {
    const { ctl, state } = makeController(false);
    state.availableSaeLayers = [3, 4];
    stubGenerate();
    try {
      await ctl.generate(RAN);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sidecar.listModels).not.toHaveBeenCalled();
    expect(state.availableSaeLayers).toEqual([3, 4]);
  });
});

describe('layer switch', () => {
  it('clears feature ablations and resets the steering selection', async () => {
    const { ctl, state } = makeController();
    ctl.toggleFeatureAblation(7, 6);
    await ctl.runFeatureAblation();
    expect(state.featureAblations).toHaveLength(1);
    expect(state.featureAblateResponse).not.toBeNull();
    const keyBefore = state.steeringResetKey;

    await ctl.layerSwitch(8);

    expect(state.featureAblations).toEqual([]);
    expect(state.featureAblateResponse).toBeNull();
    expect(state.steeringResetKey).toBe(keyBefore + 1);
    expect(state.saeLayer).toBe(8);
    expect(state.response?.sae_layer_used).toBe(8);
    expect(state.response?.prompt).toBe(RAN);
  });

  it('model switch clears everything, including the response', () => {
    const { ctl, state } = makeController();
    ctl.toggleHeadAblation(0, 1);
    state.saeLayer = 6;
    ctl.clearForModelSwitch();
    expect(state.response).toBeNull();
    expect(state.headAblations).toEqual([]);
    expect(state.saeLayer).toBeUndefined();
    expect(ctl.isPromptEdited(EDITED)).toBe(false);
  });
});

describe('dispatch without a response', () => {
  it('is a no-op for every response-bound analysis', async () => {
    const { ctl, state, deps } = makeController(false);
    ctl.toggleHeadAblation(0, 1);
    ctl.toggleFeatureAblation(7, 6);

    await ctl.logitLens();
    await ctl.dla();
    await ctl.steer(42, 6, 5);
    await ctl.runHeadAblation();
    await ctl.runFeatureAblation();
    await ctl.circuit('dla');
    await ctl.layerSwitch(8);

    for (const fn of [
      sidecar.fetchLogitLens, sidecar.fetchDLA, sidecar.steerGenerate, sidecar.ablateHeads,
      sidecar.ablateFeatures, sidecar.fetchCircuit, sidecar.switchSaeLayer,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(deps.ensureLoaded).not.toHaveBeenCalled();
    expect(state.error).toBeNull();
    expect(state.logitLensLoading || state.dlaLoading || state.steerLoading || state.circuitLoading).toBe(false);
    expect(ctl.isPromptEdited(EDITED)).toBe(false);
  });
});

describe('copying heads (head scores)', () => {
  it('works before the first Run and fetches only once', async () => {
    const { ctl, state, deps } = makeController(false);
    await ctl.showHeadScores();
    expect(state.headScoresMode).toBe(true);
    expect(deps.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(sidecar.fetchHeadScores).toHaveBeenCalledWith('gpt2-small');
    expect(state.headScoresResponse).toMatchObject({ kind: 'head-scores' });

    ctl.hideHeadScores();
    await ctl.showHeadScores();
    expect(state.headScoresMode).toBe(true);
    expect(sidecar.fetchHeadScores).toHaveBeenCalledTimes(1);
    expect(state.headScoresLoading).toBe(false);
  });

  it('survives a new Run but not a model switch', async () => {
    const { ctl, state } = makeController();
    await ctl.headScores();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fakeResponse('new')))));
    await ctl.generate('new');
    vi.unstubAllGlobals();
    expect(state.response?.prompt).toBe('new');
    expect(state.headScoresResponse).not.toBeNull();

    ctl.clearForModelSwitch();
    expect(state.headScoresResponse).toBeNull();
  });

  it('drops a result for a model that was switched away mid-request', async () => {
    const { state, deps } = makeController();
    let active: string | null = 'gpt2-small';
    const ctl = new AnalysisController(state, { ...deps, getActivePresetId: () => active });
    vi.mocked(sidecar.fetchHeadScores).mockImplementationOnce(async () => {
      active = 'pythia-70m';
      return { kind: 'head-scores' } as never;
    });
    await ctl.headScores();
    expect(state.headScoresResponse).toBeNull();
  });

  it('a model switch releases a running request so the new model can score at once', async () => {
    const { ctl, state } = makeController();
    let finishOld: (v: unknown) => void = () => {};
    vi.mocked(sidecar.fetchHeadScores).mockImplementationOnce(
      () => new Promise((resolve) => { finishOld = resolve as (v: unknown) => void; }) as never,
    );
    const old = ctl.headScores();
    await Promise.resolve();
    ctl.clearForModelSwitch();
    expect(state.headScoresLoading).toBe(false);

    vi.mocked(sidecar.fetchHeadScores).mockResolvedValueOnce({ kind: 'head-scores', fresh: true } as never);
    await ctl.headScores();
    expect(state.headScoresResponse).toMatchObject({ fresh: true });

    finishOld({ kind: 'head-scores', stale: true });
    await old;
    expect(state.headScoresResponse).toMatchObject({ fresh: true });
    expect(state.headScoresLoading).toBe(false);
  });

  it('reports errors in the shared error slot', async () => {
    const { ctl, state } = makeController();
    vi.mocked(sidecar.fetchHeadScores).mockRejectedValueOnce(new Error('boom'));
    await ctl.headScores();
    expect(state.error).toBe('boom');
    expect(state.headScoresLoading).toBe(false);
  });
});

describe('DLA refreshes when the focused token changes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-fetches once, 250 ms after the last focus change, with response.prompt', async () => {
    const { ctl, state } = makeController();
    state.focusTokenIndex = 1;
    await ctl.dla();
    expect(sidecar.fetchDLA).toHaveBeenCalledTimes(1);

    state.focusTokenIndex = 0;
    ctl.focusChanged();
    await vi.advanceTimersByTimeAsync(100);
    state.focusTokenIndex = 1;
    ctl.focusChanged();
    state.focusTokenIndex = 0;
    ctl.focusChanged();
    await vi.advanceTimersByTimeAsync(DLA_FOCUS_DEBOUNCE_MS - 1);
    expect(sidecar.fetchDLA).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sidecar.fetchDLA).toHaveBeenCalledTimes(2);
    expect(sidecar.fetchDLA).toHaveBeenLastCalledWith('gpt2-small', RAN, 0);
  });

  it('does nothing until DLA has been shown for this response', async () => {
    const { ctl, state } = makeController();
    state.focusTokenIndex = 0;
    ctl.focusChanged();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sidecar.fetchDLA).not.toHaveBeenCalled();
  });

  it('does not re-fetch when focus returns to the token DLA already shows', async () => {
    const { ctl, state } = makeController();
    state.focusTokenIndex = 1;
    await ctl.dla();
    ctl.focusChanged();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sidecar.fetchDLA).toHaveBeenCalledTimes(1);
  });

  it('a new Run cancels a pending refresh', async () => {
    const { ctl, state } = makeController();
    state.focusTokenIndex = 1;
    await ctl.dla();
    state.focusTokenIndex = 0;
    ctl.focusChanged();
    ctl.clearForModelSwitch();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sidecar.fetchDLA).toHaveBeenCalledTimes(1);
  });

  it('a focus change during an in-flight DLA refreshes after it lands', async () => {
    const { ctl, state } = makeController();
    let release!: () => void;
    vi.mocked(sidecar.fetchDLA).mockImplementationOnce(
      () => new Promise((r) => { release = () => r({ kind: 'dla' } as never); }),
    );
    state.focusTokenIndex = 1;
    const first = ctl.dla();
    await vi.advanceTimersByTimeAsync(0);
    state.focusTokenIndex = 0;
    ctl.focusChanged();
    release();
    await first;
    await vi.advanceTimersByTimeAsync(DLA_FOCUS_DEBOUNCE_MS);
    expect(sidecar.fetchDLA).toHaveBeenCalledTimes(2);
    expect(sidecar.fetchDLA).toHaveBeenLastCalledWith('gpt2-small', RAN, 0);
  });
});

describe('tokenize (patching token counters)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs {preset_id, text} to /tokenize and returns {tokens, count}', async () => {
    const { ctl } = makeController();
    const fetchSpy = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ tokens: ['<|endoftext|>', 'Hi'], count: 2 }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const out = await ctl.tokenize('Hi');
    expect(out).toEqual({ tokens: ['<|endoftext|>', 'Hi'], count: 2 });
    expect(fetchSpy.mock.calls[0][0]).toBe('http://sidecar.test/tokenize');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ preset_id: 'gpt2-small', text: 'Hi' });
  });

  it('returns null on HTTP errors and when no model is loaded', async () => {
    const { ctl, deps } = makeController();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    expect(await ctl.tokenize('Hi')).toBeNull();
    deps.getActivePresetId = () => null;
    expect(await ctl.tokenize('Hi')).toBeNull();
  });

  it('patchLengthStatus labels same vs differing lengths', () => {
    expect(patchLengthStatus(null, 5)).toBeNull();
    expect(patchLengthStatus(14, 14)).toEqual({ same: true, label: 'same length ✓' });
    expect(patchLengthStatus(14, 15)).toEqual({ same: false, label: 'lengths differ: 14 vs 15' });
  });
});

/** A sidecar call held open until the test releases it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function stubGenerateFetch(prompt: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fakeResponse(prompt)))));
}

describe('a newer Run or request supersedes one in flight (B1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drops a stale lens result after Run', async () => {
    const { ctl, state } = makeController();
    const old = deferred<unknown>();
    vi.mocked(sidecar.fetchLogitLens).mockImplementationOnce(() => old.promise as never);
    const lens = ctl.logitLens();
    await Promise.resolve();
    expect(state.logitLensLoading).toBe(true);

    stubGenerateFetch('new prompt');
    await ctl.generate('new prompt');
    expect(state.logitLensLoading).toBe(false);

    old.resolve({ kind: 'logit-lens', stale: true });
    await lens;
    expect(state.logitLensResponse).toBeNull();
    expect(state.logitLensLoading).toBe(false);
    expect(state.response?.prompt).toBe('new prompt');
  });

  it('a lens request issued after Run while an old one is in flight shows the new result', async () => {
    const { ctl, state } = makeController();
    const old = deferred<unknown>();
    vi.mocked(sidecar.fetchLogitLens).mockImplementationOnce(() => old.promise as never);
    const oldLens = ctl.logitLens();
    await Promise.resolve();

    stubGenerateFetch('new prompt');
    await ctl.generate('new prompt');

    // Not blocked by the old request's loading flag.
    vi.mocked(sidecar.fetchLogitLens).mockResolvedValueOnce({ kind: 'logit-lens', fresh: true } as never);
    await ctl.logitLens();
    expect(sidecar.fetchLogitLens).toHaveBeenLastCalledWith('gpt2-small', 'new prompt');
    expect(state.logitLensResponse).toMatchObject({ fresh: true });

    old.resolve({ kind: 'logit-lens', stale: true });
    await oldLens;
    expect(state.logitLensResponse).toMatchObject({ fresh: true });
    expect(state.logitLensLoading).toBe(false);
  });

  it('drops a Run result when the model is switched while it is in flight', async () => {
    const { state, deps } = makeController(false);
    let active: string | null = 'gpt2-small';
    const ctl = new AnalysisController(state, { ...deps, getActivePresetId: () => active });
    vi.stubGlobal('fetch', vi.fn(async () => {
      // The switcher finishes loading another model before /generate answers.
      active = 'pythia-70m';
      ctl.clearForModelSwitch();
      return new Response(JSON.stringify(fakeResponse()), { status: 200 });
    }));
    try {
      await ctl.generate(RAN);
      expect(state.response).toBeNull();
      expect(state.generating).toBe(false);
      expect(state.error).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a Run result when the model did not change', async () => {
    const { ctl, state } = makeController(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fakeResponse()), { status: 200 })));
    try {
      await ctl.generate(RAN);
      expect(state.response?.prompt).toBe(RAN);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drops a lens result for a model that was switched away mid-request', async () => {
    const { state, deps } = makeController();
    let active: string | null = 'gpt2-small';
    const ctl = new AnalysisController(state, { ...deps, getActivePresetId: () => active });
    vi.mocked(sidecar.fetchLogitLens).mockImplementationOnce(async () => {
      active = 'pythia-70m';
      return { kind: 'logit-lens' } as never;
    });
    await ctl.logitLens();
    expect(state.logitLensResponse).toBeNull();
    expect(state.logitLensLoading).toBe(false);
  });

  type Case = {
    name: string;
    fn: keyof typeof sidecar;
    loading: 'steerLoading' | 'headAblateLoading' | 'featureAblateLoading' | 'circuitLoading';
    result: 'steerResponse' | 'headAblateResponse' | 'featureAblateResponse' | 'circuitResponse';
    run: (ctl: AnalysisController) => Promise<void>;
    prep?: (ctl: AnalysisController) => void;
  };
  const cases: Case[] = [
    { name: 'steer', fn: 'steerGenerate', loading: 'steerLoading', result: 'steerResponse',
      run: (c) => c.steer(42, 6, 5) },
    { name: 'headAblation', fn: 'ablateHeads', loading: 'headAblateLoading', result: 'headAblateResponse',
      prep: (c) => c.toggleHeadAblation(0, 1), run: (c) => c.runHeadAblation() },
    { name: 'featureAblation', fn: 'ablateFeatures', loading: 'featureAblateLoading', result: 'featureAblateResponse',
      prep: (c) => c.toggleFeatureAblation(7, 6), run: (c) => c.runFeatureAblation() },
    { name: 'circuit', fn: 'fetchCircuit', loading: 'circuitLoading', result: 'circuitResponse',
      run: (c) => c.circuit('dla') },
  ];

  it.each(cases)('$name: a stale result is dropped and a newer request wins', async (c) => {
    const { ctl, state } = makeController();
    const mock = vi.mocked(sidecar[c.fn] as (...a: unknown[]) => Promise<unknown>);

    // 1. A Run while the request is in flight drops its result.
    const stale = deferred<unknown>();
    mock.mockImplementationOnce(() => stale.promise);
    c.prep?.(ctl);
    const first = c.run(ctl);
    await Promise.resolve();
    expect(state[c.loading]).toBe(true);
    stubGenerateFetch('new prompt');
    await ctl.generate('new prompt');
    vi.unstubAllGlobals();
    expect(state[c.loading]).toBe(false);
    stale.resolve({ stale: true });
    await first;
    expect(state[c.result]).toBeNull();

    // 2. A second request while the first is in flight supersedes it.
    const slow = deferred<unknown>();
    mock.mockImplementationOnce(() => slow.promise);
    c.prep?.(ctl);
    const older = c.run(ctl);
    await Promise.resolve();
    mock.mockResolvedValueOnce({ fresh: true });
    await c.run(ctl);
    expect(state[c.result]).toMatchObject({ fresh: true });
    slow.resolve({ stale: true });
    await older;
    expect(state[c.result]).toMatchObject({ fresh: true });
    expect(state[c.loading]).toBe(false);
  });
});

describe('layer switch vs a newer Run (B2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('layer switch does not overwrite a newer response', async () => {
    const { ctl, state } = makeController();
    const pending = deferred<unknown>();
    vi.mocked(sidecar.switchSaeLayer).mockImplementationOnce(() => pending.promise as never);
    const sw = ctl.layerSwitch(8);
    await Promise.resolve();
    expect(state.layerSwitching).toBe(true);

    stubGenerateFetch('new prompt');
    await ctl.generate('new prompt');
    pending.resolve({ preset_id: 'gpt2-small', prompt: RAN, sae_features: [], sae_layer_used: 8, timing_ms: {} });
    await sw;

    expect(state.response?.prompt).toBe('new prompt');
    expect(state.response?.sae_layer_used).toBe(6);
    // Commit-on-complete (plan T2b): the engine loaded layer 8, so it is recorded.
    expect(state.saeLayer).toBe(8);
    expect(state.layerSwitching).toBe(false);
  });
});

describe('Key parts follows the focused word (A4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the focus and refetches when it changes', async () => {
    const { ctl, state } = makeController();
    state.focusTokenIndex = 1;
    await ctl.circuit('dla', 0.5);
    expect(sidecar.fetchCircuit).toHaveBeenLastCalledWith('gpt2-small', RAN, 'dla', 0.5, 1);

    state.focusTokenIndex = 0;
    ctl.focusChanged();
    await vi.advanceTimersByTimeAsync(DLA_FOCUS_DEBOUNCE_MS);
    expect(sidecar.fetchCircuit).toHaveBeenCalledTimes(2);
    expect(sidecar.fetchCircuit).toHaveBeenLastCalledWith('gpt2-small', RAN, 'dla', 0.5, 0);
  });
});

describe('SAE layer list belongs to the model (B8)', () => {
  it('a model switch empties the layer list', () => {
    const { ctl, state } = makeController();
    state.availableSaeLayers = [0, 6, 11];
    ctl.clearForModelSwitch();
    expect(state.availableSaeLayers).toEqual([]);
  });
});
