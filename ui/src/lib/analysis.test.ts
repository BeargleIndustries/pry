import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `$lib/sidecar` (imported relatively by the analysis module, since vitest here
// has no SvelteKit alias). Every analysis call is a spy.
vi.mock('./sidecar', () => ({
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
    expect(sidecar.fetchCircuit).toHaveBeenCalledWith('gpt2-small', RAN, 'dla', undefined);
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
