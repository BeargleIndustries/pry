import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DLA vs focus (plan T2b): a scene-set DLA target holds until the learner moves
// focus; a learner focus change resets answer and contrast to the top guess.
vi.mock('./sidecar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sidecar')>()),
  fetchDLA: vi.fn(async () => ({ kind: 'dla' })),
}));

import * as sidecar from './sidecar';
import { AnalysisController, DLA_FOCUS_DEBOUNCE_MS, createInitialAnalysisState } from './analysis-core';
import type { GenerateResponse } from './types';

function setup() {
  const state = createInitialAnalysisState();
  state.response = {
    preset_id: 'gpt2-small',
    prompt: 'When Mary and John went to the store, John gave a drink to',
    tokens: [
      { index: 0, text: '<|endoftext|>' },
      { index: 1, text: 'When' },
      { index: 2, text: ' Mary' },
    ],
    attention: [],
    sae_features: [],
    sae_layer_used: 8,
    timing_ms: {},
  } as GenerateResponse;
  state.focusTokenIndex = 2;
  const ctl = new AnalysisController(state, {
    getSelectedPreset: () => 'gpt2-small',
    getActivePresetId: () => 'gpt2-small',
    ensureLoaded: async () => {},
  });
  return { ctl, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('DLA target vs focus', () => {
  it('› scene-set DLA survives focusChanged', async () => {
    const { ctl, state } = setup();
    ctl.setSceneDlaTarget(' Mary', ' John');
    await ctl.dla();
    expect(sidecar.fetchDLA).toHaveBeenLastCalledWith('gpt2-small', state.response!.prompt, 2, {
      answerToken: ' Mary',
      contrastToken: ' John',
    });
    vi.mocked(sidecar.fetchDLA).mockClear();
    // The focus effect fires for the scene's own focus: nothing resets.
    ctl.focusChanged();
    await vi.advanceTimersByTimeAsync(DLA_FOCUS_DEBOUNCE_MS + 10);
    expect(state.dlaTarget).toEqual({ answer: ' Mary', contrast: ' John' });
    expect(sidecar.fetchDLA).not.toHaveBeenCalled();
  });

  it('› focus change after a contrast scene resets the answer', async () => {
    const { ctl, state } = setup();
    ctl.setSceneDlaTarget(' Mary', ' John');
    await ctl.dla();
    vi.mocked(sidecar.fetchDLA).mockClear();
    // The learner clicks another token.
    state.focusTokenIndex = 1;
    ctl.focusChanged();
    expect(state.dlaTarget).toBeNull();
    await vi.advanceTimersByTimeAsync(DLA_FOCUS_DEBOUNCE_MS + 10);
    expect(sidecar.fetchDLA).toHaveBeenCalledWith('gpt2-small', state.response!.prompt, 1);
  });

  it('a new Run resets the scene target to the top guess', async () => {
    const { ctl, state } = setup();
    ctl.setSceneDlaTarget(' Mary', null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: { body: string }) => ({
        ok: true,
        status: 200,
        json: async () => ({ ...state.response, prompt: JSON.parse(init.body).prompt }),
      })),
    );
    try {
      await ctl.generate('The bank');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(state.dlaTarget).toBeNull();
  });
});
