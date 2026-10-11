// Compare mode (T25) state + runner, as plain TS so vitest can exercise it.
// `compare.svelte.ts` wraps the state in `$state(...)`.
//
// Each prompt is one `/generate` call (analysis only, no new text) with the SAE
// layer the main view is on and a wider feature list than the main view (top
// 20 instead of 5), so "only in A / only in B" is less likely to just mean "6th
// place". `/generate` returns predictions, attention and SAE features in one go,
// which is everything `/sae-features` would add.
import { sidecarFetch } from './sidecar';
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

async function generateOne(presetId: string, prompt: string, saeLayer: number | undefined): Promise<GenerateResponse> {
  const resp = await sidecarFetch('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: presetId,
      prompt,
      max_new_tokens: 0,
      top_k_features: COMPARE_TOP_K_FEATURES,
      ...(saeLayer !== undefined ? { sae_layer: saeLayer } : {}),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(sidecarErrorMessage(body) ?? `/generate failed: ${resp.status}`);
  }
  return (await resp.json()) as GenerateResponse;
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

  async run() {
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
    try {
      await this.deps.ensureLoaded();
      const preset = this.deps.getSelectedPreset();
      const layer = this.deps.getSaeLayer();
      // One after the other: the engine runs one model call at a time anyway.
      const a = await generateOne(preset, s.promptA, layer);
      const b = await generateOne(preset, s.promptB, layer);
      s.a = a;
      s.b = b;
      s.positionIndex = 0;
    } catch (e) {
      s.error = (e as { message?: string })?.message ?? String(e);
    } finally {
      s.running = false;
    }
  }

  clear() {
    this.state.a = null;
    this.state.b = null;
    this.state.positionIndex = 0;
  }
}
