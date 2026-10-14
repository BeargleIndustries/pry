// Compare mode (T25) state + runner, as plain TS so vitest can exercise it.
// `compare.svelte.ts` wraps the state in `$state(...)`.
//
// Each prompt is one `/generate` call (analysis only, no new text) with the SAE
// layer the main view is on and a wider feature list than the main view (top
// 20 instead of 5), so "only in A / only in B" is less likely to just mean "6th
// place". `/generate` returns predictions, attention and SAE features in one go,
// which is everything `/sae-features` would add.
import { buildGenerateRequest, sidecarFetch } from './sidecar';
import { directCall, type SidecarCaller } from './analysis-core';
import { sidecarErrorMessage } from './sidecar-errors';
import type { GenerateResponse } from './types';

export const COMPARE_TOP_K_FEATURES = 20;

export interface CompareState {
  promptA: string;
  promptB: string;
  a: GenerateResponse | null;
  b: GenerateResponse | null;
  running: boolean;
  error: string | null;
  /** Index into `alignedPositions(a, b)`; 0 = last word. */
  positionIndex: number;
}

export function createInitialCompareState(): CompareState {
  return {
    promptA: 'The doctor said that',
    promptB: 'The nurse said that',
    a: null,
    b: null,
    running: false,
    error: null,
    positionIndex: 0,
  };
}

export interface CompareDeps {
  getSelectedPreset: () => string;
  /** SAE layer the main view is on (undefined = preset default). */
  getSaeLayer: () => number | undefined;
  ensureLoaded: () => Promise<void>;
}

async function generateOne(
  presetId: string,
  prompt: string,
  saeLayer: number | undefined,
  call: SidecarCaller,
): Promise<GenerateResponse> {
  // Same bytes as before; the shared builder gives lessons the same request key.
  const body = buildGenerateRequest({ presetId, prompt, topKFeatures: COMPARE_TOP_K_FEATURES, saeLayer });
  return call({ endpoint: '/generate', model: presetId, body }, async () => {
    const resp = await sidecarFetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(sidecarErrorMessage(text) ?? `/generate failed: ${resp.status}`);
    }
    return (await resp.json()) as GenerateResponse;
  });
}

export class CompareController {
  constructor(
    readonly state: CompareState,
    private readonly deps: CompareDeps,
  ) {}

  /** True when either text box no longer matches what was run. */
  get edited(): boolean {
    const s = this.state;
    return !!s.a && !!s.b && (s.a.prompt !== s.promptA || s.b.prompt !== s.promptB);
  }

  swap() {
    const s = this.state;
    [s.promptA, s.promptB] = [s.promptB, s.promptA];
  }

  /** `call`: the runner memo for a lesson's run_compare; the Run button goes direct. */
  async run(call: SidecarCaller = directCall) {
    const s = this.state;
    if (s.running) return;
    const promptA = s.promptA.trim();
    const promptB = s.promptB.trim();
    if (!promptA || !promptB) {
      s.error = 'Type a prompt in both boxes to compare them.';
      return;
    }
    s.running = true;
    s.error = null;
    const gen = this.generation;
    try {
      await this.deps.ensureLoaded();
      const preset = this.deps.getSelectedPreset();
      const layer = this.deps.getSaeLayer();
      // One after the other: the engine runs one model call at a time anyway.
      const a = await generateOne(preset, s.promptA, layer, call);
      const b = await generateOne(preset, s.promptB, layer, call);
      // A model switch cleared things while this ran: drop the old model's results.
      if (gen !== this.generation) return;
      s.a = a;
      s.b = b;
      s.positionIndex = 0;
    } catch (e) {
      if (gen === this.generation) s.error = (e as { message?: string })?.message ?? String(e);
    } finally {
      s.running = false;
    }
  }

  private generation = 0;

  clear() {
    this.generation++;
    this.state.a = null;
    this.state.b = null;
    this.state.positionIndex = 0;
  }
}
