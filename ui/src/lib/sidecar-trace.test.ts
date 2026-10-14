import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { AnalysisController, createInitialAnalysisState } from './analysis-core';

// Step 0's recorded 0.3.8 session (.omc/evidence/pry-learning-2026-10-12/
// sidecar-trace-0.3.8.json, copied here): load GPT-2 small, Run twice, open
// Logit Lens, open Why (DLA), Swap test (counters + Run swap test), Steering
// (Run Steered). With Lessons off, the same clicks must send exactly the same
// endpoint + body calls. This drives the same calls through the client the
// page uses (scripts/dev/sidecar-trace.mjs drove the real window). The load
// step's /health and /models calls come from page components and the load
// controller, which this file does not touch; they are left out.

interface TraceCall {
  step: string;
  method: string;
  endpoint: string;
  body: unknown;
}

const trace = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/sidecar-trace-0.3.8.json', import.meta.url)), 'utf-8'),
) as { calls: TraceCall[] };

const PROMPT = 'The cat sat on the mat. The cat sat on the mat. The cat sat on the';
const CLEAN = 'When Mary and John went to the store, John gave a drink to';
const CHANGED = 'When Mary and John went to the store, Mary gave a drink to';

afterEach(() => vi.unstubAllGlobals());

describe('sidecar trace', () => {
  it('› Lessons off issues the same sidecar calls as sidecar-trace-0.3.8.json for the scripted session', async () => {
    const calls: { step: string; method: string; endpoint: string; body: unknown }[] = [];
    let step = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const endpoint = new URL(url).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ step, method: init?.method ?? 'GET', endpoint, body });
        // GPT-2 cuts the prompt into 19 tokens after the start marker.
        const json =
          endpoint === '/generate'
            ? {
                preset_id: 'gpt2-small',
                prompt: body.prompt,
                tokens: Array.from({ length: 20 }, (_, index) => ({ index, text: `t${index}` })),
                attention: [],
                sae_features: [],
                sae_layer_used: 8,
                timing_ms: {},
              }
            : endpoint === '/tokenize'
              ? { tokens: [], count: 15 }
              : { components: [] };
        return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );

    const state = createInitialAnalysisState();
    // Loaded: the layer menu was filled by the load, so a Run sends only /generate.
    state.availableSaeLayers = [0, 8, 11];
    const analysis = new AnalysisController(state, {
      getSelectedPreset: () => 'gpt2-small',
      getActivePresetId: () => 'gpt2-small',
      ensureLoaded: async () => {},
    });

    step = 'run-1';
    await analysis.generate(PROMPT); // the Run button
    step = 'run-2';
    await analysis.generate(PROMPT);
    step = 'logit-lens';
    await analysis.logitLens(); // opening the Logit Lens tab
    step = 'dla';
    await analysis.dla(); // opening Why (DLA): focus is the last token
    step = 'swap-test';
    await Promise.all([analysis.tokenize(CLEAN), analysis.tokenize(CHANGED)]); // the panel's counters
    await analysis.patching(CLEAN, CHANGED, 'head'); // Run swap test
    step = 'steer';
    await analysis.steer(11746, 8, 5); // Run Steered with the panel's first feature

    const expected = trace.calls
      .filter((c) => c.step !== 'load')
      .map(({ step: s, method, endpoint, body }) => ({ step: s, method, endpoint, body }));
    expect(calls).toEqual(expected);
  });
});
