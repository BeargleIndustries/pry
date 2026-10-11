// Analysis state + dispatchers, as plain TypeScript so vitest can exercise it
// without the Svelte compiler. `analysis.svelte.ts` wraps the state object in
// `$state(...)`, which makes every mutation below reactive.
//
// Rule: every analysis call uses `response.prompt` (the prompt that was actually
// run and is shown in the token strip), never the live text box. Only `generate`
// reads the text box, because it is the call that creates a response.
import {
  sidecarFetch,
  switchSaeLayer,
  fetchLogitLens,
  fetchDLA,
  steerGenerate,
  ablateHeads,
  ablateFeatures,
  runPatching,
  fetchCircuit,
  fetchHeadScores,
} from './sidecar';
import { sidecarErrorMessage } from './sidecar-errors';
import type {
  GenerateResponse,
  LogitLensResponse,
  DLAResponse,
  SteerResponse,
  AblateResponse,
  PatchResponse,
  CircuitResponse,
  HeadScoresResponse,
} from './types';

export interface AnalysisState {
  response: GenerateResponse | null;
  generating: boolean;
  error: string | null;
  focusTokenIndex: number | undefined;
  saeLayer: number | undefined;
  layerSwitching: boolean;
  availableSaeLayers: number[];
  logitLensResponse: LogitLensResponse | null;
  logitLensLoading: boolean;
  dlaResponse: DLAResponse | null;
  dlaLoading: boolean;
  steerResponse: SteerResponse | null;
  steerLoading: boolean;
  /** Bumped when the steering feature selection must be cleared (SteeringPanel watches it). */
  steeringResetKey: number;
  headAblateResponse: AblateResponse | null;
  headAblateLoading: boolean;
  headAblations: { layer: number; head: number }[];
  headAblationMode: boolean;
  featureAblateResponse: AblateResponse | null;
  featureAblateLoading: boolean;
  featureAblations: { feature_index: number; layer: number }[];
  featureAblationMode: boolean;
  patchResponse: PatchResponse | null;
  patchLoading: boolean;
  circuitResponse: CircuitResponse | null;
  circuitLoading: boolean;
  /** Attention panel shows the copying-heads view instead of the prompt's grid. */
  headScoresMode: boolean;
  headScoresResponse: HeadScoresResponse | null;
  headScoresLoading: boolean;
}

export function createInitialAnalysisState(): AnalysisState {
  return {
    response: null,
    generating: false,
    error: null,
    focusTokenIndex: undefined,
    saeLayer: undefined,
    layerSwitching: false,
    availableSaeLayers: [],
    logitLensResponse: null,
    logitLensLoading: false,
    dlaResponse: null,
    dlaLoading: false,
    steerResponse: null,
    steerLoading: false,
    steeringResetKey: 0,
    headAblateResponse: null,
    headAblateLoading: false,
    headAblations: [],
    headAblationMode: false,
    featureAblateResponse: null,
    featureAblateLoading: false,
    featureAblations: [],
    featureAblationMode: false,
    patchResponse: null,
    patchLoading: false,
    circuitResponse: null,
    circuitLoading: false,
    headScoresMode: false,
    headScoresResponse: null,
    headScoresLoading: false,
  };
}

/** DLA re-fetch delay after the focused token changes. */
export const DLA_FOCUS_DEBOUNCE_MS = 250;
/** Patching panel token-count delay after typing. */
export const TOKENIZE_DEBOUNCE_MS = 300;

/** `POST /tokenize` response (contract §5). `count` includes BOS, matching `/patch`. */
export interface TokenizeResponse {
  tokens: string[];
  count: number;
}

/** Same-length check for the two patching prompts (null while either count is unknown). */
export function patchLengthStatus(
  cleanCount: number | null,
  corruptedCount: number | null,
): { same: boolean; label: string } | null {
  if (cleanCount === null || corruptedCount === null) return null;
  return cleanCount === corruptedCount
    ? { same: true, label: 'same length ✓' }
    : { same: false, label: `lengths differ: ${cleanCount} vs ${corruptedCount}` };
}

export interface AnalysisDeps {
  /** Preset the user has picked (used by generate). */
  getSelectedPreset: () => string;
  /** Preset currently loaded in the sidecar (used by analysis calls). */
  getActivePresetId: () => string | null;
  /** Make sure the model is loaded before a call. */
  ensureLoaded: () => Promise<void>;
}

function errMsg(e: unknown): string {
  return (e as { message?: string })?.message ?? String(e);
}

export class AnalysisController {
  private dlaTimer: ReturnType<typeof setTimeout> | null = null;
  /** Focus index the current/in-flight DLA result was requested for. */
  private dlaFocus: number | undefined = undefined;

  constructor(
    readonly state: AnalysisState,
    private readonly deps: AnalysisDeps,
  ) {}

  /** The prompt the current results belong to, or null before the first Run. */
  get analysisPrompt(): string | null {
    return this.state.response?.prompt ?? null;
  }

  /** True when the text box no longer matches the prompt that was analyzed. */
  isPromptEdited(textBoxPrompt: string): boolean {
    const p = this.analysisPrompt;
    return p !== null && p !== textBoxPrompt;
  }

  /** Clear every derived analysis result (not the generate response itself). */
  private clearAnalyses() {
    const s = this.state;
    this.cancelDlaRefresh();
    s.logitLensResponse = null;
    s.dlaResponse = null;
    s.steerResponse = null;
    s.headAblateResponse = null;
    s.featureAblateResponse = null;
    s.patchResponse = null;
    s.circuitResponse = null;
    s.headAblations = [];
    s.featureAblations = [];
    s.headAblationMode = false;
    s.featureAblationMode = false;
  }

  /** Called after a successful model switch: drop everything tied to the old model. */
  clearForModelSwitch() {
    this.state.saeLayer = undefined;
    this.clearAnalyses();
    // Head scores belong to the model, not the prompt, so only a switch clears them.
    this.state.headScoresResponse = null;
    this.state.response = null;
    this.state.steeringResetKey++;
  }

  async generate(textBoxPrompt: string) {
    const s = this.state;
    if (s.generating) return;
    s.error = null;
    s.generating = true;
    try {
      await this.deps.ensureLoaded();
      const resp = await sidecarFetch('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset_id: this.deps.getSelectedPreset(),
          prompt: textBoxPrompt,
          max_new_tokens: 0,
          top_k_features: 5,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(sidecarErrorMessage(body) ?? `/generate failed: ${resp.status}`);
      }
      const response = (await resp.json()) as GenerateResponse;
      s.response = response;
      this.clearAnalyses();
      s.focusTokenIndex = response.tokens.length > 0
        ? response.tokens[response.tokens.length - 1].index
        : undefined;
      s.saeLayer = response.sae_layer_used;
    } catch (e) {
      s.error = errMsg(e);
      s.response = null;
    } finally {
      s.generating = false;
    }
  }

  async layerSwitch(layer: number) {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const response = s.response;
    if (s.layerSwitching || !response || !presetId) return;
    s.layerSwitching = true;
    try {
      const result = await switchSaeLayer(presetId, response.prompt, layer);
      s.response = {
        ...response,
        sae_features: result.sae_features,
        sae_layer_used: result.sae_layer_used,
        timing_ms: { ...response.timing_ms, ...result.timing_ms },
      };
      s.saeLayer = layer;
      // Feature ids are per-layer: old ablations / steering picks no longer apply.
      s.featureAblations = [];
      s.featureAblateResponse = null;
      s.steeringResetKey++;
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.layerSwitching = false;
    }
  }

  async logitLens() {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (s.logitLensLoading || !presetId || prompt === null) return;
    s.logitLensLoading = true;
    try {
      await this.deps.ensureLoaded();
      s.logitLensResponse = await fetchLogitLens(presetId, prompt);
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.logitLensLoading = false;
    }
  }

  async dla() {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (s.dlaLoading || !presetId || prompt === null) return;
    s.dlaLoading = true;
    const focus = s.focusTokenIndex;
    this.dlaFocus = focus;
    try {
      await this.deps.ensureLoaded();
      const result = await fetchDLA(presetId, prompt, focus);
      // Drop a result whose prompt was replaced while it was in flight.
      if (this.analysisPrompt === prompt) s.dlaResponse = result;
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.dlaLoading = false;
    }
    // Focus moved while this request ran: refresh for the new token.
    if (s.dlaResponse && s.focusTokenIndex !== this.dlaFocus) this.focusChanged();
  }

  /**
   * Call when the focused token changes. Once DLA has been shown for this
   * response, re-fetch it for the new token, debounced so arrowing through the
   * token strip sends one request. `analysis.svelte.ts` wires this to
   * `state.focusTokenIndex`.
   */
  focusChanged() {
    const s = this.state;
    this.cancelDlaRefresh();
    if (!s.dlaResponse && !s.dlaLoading) return;
    if (s.focusTokenIndex === this.dlaFocus) return;
    if (s.dlaLoading) return; // dla() re-checks the focus when it finishes
    this.dlaTimer = setTimeout(() => {
      this.dlaTimer = null;
      void this.dla();
    }, DLA_FOCUS_DEBOUNCE_MS);
  }

  private cancelDlaRefresh() {
    if (this.dlaTimer !== null) {
      clearTimeout(this.dlaTimer);
      this.dlaTimer = null;
    }
  }

  /**
   * Token count for a patching prompt on the loaded model (`POST /tokenize`).
   * Doesn't touch state or `ensureLoaded`: it's a background counter, so it
   * just returns null when no model is loaded or the call fails.
   */
  async tokenize(text: string): Promise<TokenizeResponse | null> {
    const presetId = this.deps.getActivePresetId();
    if (!presetId) return null;
    try {
      const resp = await sidecarFetch('/tokenize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset_id: presetId, text }),
      });
      if (!resp.ok) return null;
      return (await resp.json()) as TokenizeResponse;
    } catch {
      return null;
    }
  }

  async steer(featureId: number, saeLayerVal: number, alpha: number) {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (s.steerLoading || !presetId || prompt === null) return;
    s.steerLoading = true;
    try {
      await this.deps.ensureLoaded();
      s.steerResponse = await steerGenerate(presetId, prompt, featureId, saeLayerVal, alpha);
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.steerLoading = false;
    }
  }

  toggleHeadAblation(layer: number, head: number) {
    const s = this.state;
    const idx = s.headAblations.findIndex((a) => a.layer === layer && a.head === head);
    s.headAblations = idx >= 0
      ? s.headAblations.filter((_, i) => i !== idx)
      : [...s.headAblations, { layer, head }];
  }

  async runHeadAblation() {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (s.headAblateLoading || !presetId || prompt === null || s.headAblations.length === 0) return;
    s.headAblateLoading = true;
    try {
      await this.deps.ensureLoaded();
      s.headAblateResponse = await ablateHeads(presetId, prompt, s.headAblations);
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.headAblateLoading = false;
    }
  }

  toggleFeatureAblation(featureIndex: number, layer: number) {
    const s = this.state;
    const idx = s.featureAblations.findIndex((a) => a.feature_index === featureIndex && a.layer === layer);
    s.featureAblations = idx >= 0
      ? s.featureAblations.filter((_, i) => i !== idx)
      : [...s.featureAblations, { feature_index: featureIndex, layer }];
  }

  async runFeatureAblation() {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (s.featureAblateLoading || !presetId || prompt === null || s.featureAblations.length === 0) return;
    s.featureAblateLoading = true;
    try {
      await this.deps.ensureLoaded();
      s.featureAblateResponse = await ablateFeatures(presetId, prompt, s.featureAblations);
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.featureAblateLoading = false;
    }
  }

  /** Patching compares two prompts typed into the patching panel, so it does not need a response. */
  async patching(cleanPrompt: string, corruptedPrompt: string, patchType: 'head' | 'mlp' | 'resid') {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    if (s.patchLoading || !presetId) return;
    s.patchLoading = true;
    try {
      await this.deps.ensureLoaded();
      s.patchResponse = await runPatching(presetId, cleanPrompt, corruptedPrompt, patchType);
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.patchLoading = false;
    }
  }

  /**
   * Switch the attention panel to the copying-heads view, scoring the heads
   * the first time. Head scores use the sidecar's own test sequence, not the
   * prompt, so this works before the first Run.
   */
  async showHeadScores() {
    this.state.headScoresMode = true;
    if (!this.state.headScoresResponse) await this.headScores();
  }

  hideHeadScores() {
    this.state.headScoresMode = false;
  }

  async headScores() {
    const s = this.state;
    if (s.headScoresLoading) return;
    s.headScoresLoading = true;
    try {
      await this.deps.ensureLoaded();
      const presetId = this.deps.getActivePresetId();
      if (!presetId) return;
      const result = await fetchHeadScores(presetId);
      // Drop a result for a model that was switched away while it ran.
      if (this.deps.getActivePresetId() === presetId) s.headScoresResponse = result;
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.headScoresLoading = false;
    }
  }

  async circuit(source: 'dla' | 'patching', threshold?: number) {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (s.circuitLoading || !presetId || prompt === null) return;
    s.circuitLoading = true;
    try {
      await this.deps.ensureLoaded();
      s.circuitResponse = await fetchCircuit(presetId, prompt, source, threshold);
    } catch (e) {
      s.error = errMsg(e);
    } finally {
      s.circuitLoading = false;
    }
  }
}
