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
  listModels,
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

/** Analyses that can be superseded by a newer request of the same kind. */
type AnalysisKind = 'lens' | 'dla' | 'steer' | 'headAblation' | 'featureAblation' | 'patch' | 'circuit';

const LOADING_FLAG = {
  lens: 'logitLensLoading',
  dla: 'dlaLoading',
  steer: 'steerLoading',
  headAblation: 'headAblateLoading',
  featureAblation: 'featureAblateLoading',
  patch: 'patchLoading',
  circuit: 'circuitLoading',
} as const satisfies Record<AnalysisKind, keyof AnalysisState>;

function zeroSeqs(): Record<AnalysisKind, number> {
  return { lens: 0, dla: 0, steer: 0, headAblation: 0, featureAblation: 0, patch: 0, circuit: 0 };
}

export class AnalysisController {
  /** Debounced DLA / Key parts refresh after the focused token changes. */
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  /** Focus index the current/in-flight DLA result was requested for. */
  private dlaFocus: number | undefined = undefined;
  /** Focus index and settings the current/in-flight Key parts result was requested with. */
  private circuitFocus: number | undefined = undefined;
  private circuitSource: 'dla' | 'patching' = 'dla';
  private circuitThreshold: number | undefined = undefined;
  /**
   * One sequence number per analysis kind. A new request bumps it, so an
   * older request still in flight knows it was superseded; clearAnalyses
   * bumps them all.
   */
  private seqs = zeroSeqs();

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

  /**
   * Run one analysis request of `kind`. A newer request of the same kind
   * supersedes this one (there is no "already loading" guard), and only the
   * current request clears the loading flag. Returns the result only while it
   * still belongs to what is shown: same sequence, same loaded model and, when
   * `prompt` is given, the same analyzed prompt. Otherwise null.
   */
  private async request<T>(
    kind: AnalysisKind,
    presetId: string,
    prompt: string | null,
    call: () => Promise<T>,
  ): Promise<{ result: T } | null> {
    const s = this.state;
    const seq = ++this.seqs[kind];
    const isCurrent = () =>
      seq === this.seqs[kind] &&
      this.deps.getActivePresetId() === presetId &&
      (prompt === null || this.analysisPrompt === prompt);
    s[LOADING_FLAG[kind]] = true;
    try {
      await this.deps.ensureLoaded();
      const result = await call();
      return isCurrent() ? { result } : null;
    } catch (e) {
      if (isCurrent()) s.error = errMsg(e);
      return null;
    } finally {
      if (seq === this.seqs[kind]) s[LOADING_FLAG[kind]] = false;
    }
  }

  /** Clear every derived analysis result (not the generate response itself). */
  private clearAnalyses() {
    const s = this.state;
    this.cancelFocusRefresh();
    // Release every in-flight request: its result belongs to the old prompt.
    for (const kind of Object.keys(this.seqs) as AnalysisKind[]) {
      this.seqs[kind]++;
      s[LOADING_FLAG[kind]] = false;
    }
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
    // The layer list belongs to the old model; the next load or Run refills it.
    this.state.availableSaeLayers = [];
    this.clearAnalyses();
    // Head scores belong to the model, not the prompt, so only a switch clears them.
    // Bumping the sequence also releases a request still running for the old model.
    this.headScoresSeq++;
    this.state.headScoresResponse = null;
    this.state.headScoresLoading = false;
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
      s.saeLayer = response.sae_layer_used ?? undefined;
      await this.fillSaeLayers(response.preset_id);
    } catch (e) {
      s.error = errMsg(e);
      s.response = null;
    } finally {
      s.generating = false;
    }
  }

  /**
   * Fill the Features layer menu if it is still empty. Only a model switch and
   * a mount that already knew the model used to fill it, so a fresh profile
   * (first load through ensureLoaded or auto-load) never got the list.
   */
  private async fillSaeLayers(presetId: string) {
    if (this.state.availableSaeLayers.length > 0) return;
    try {
      const models = await listModels();
      const info = models.available?.find((p) => p.id === presetId);
      this.state.availableSaeLayers = info?.available_sae_layers ?? [];
    } catch {
      // Best-effort: the plain layer label still shows.
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
      // A newer Run (or a model switch) replaced the response while this ran.
      if (s.response !== response) return;
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
      if (s.response === response) s.error = errMsg(e);
    } finally {
      s.layerSwitching = false;
    }
  }

  async logitLens() {
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (!presetId || prompt === null) return;
    const out = await this.request('lens', presetId, prompt, () => fetchLogitLens(presetId, prompt));
    if (out) this.state.logitLensResponse = out.result;
  }

  async dla() {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (!presetId || prompt === null) return;
    const focus = s.focusTokenIndex;
    this.dlaFocus = focus;
    const out = await this.request('dla', presetId, prompt, () => fetchDLA(presetId, prompt, focus));
    if (!out) return;
    s.dlaResponse = out.result;
    // Focus moved while this request ran: refresh for the new token.
    if (s.focusTokenIndex !== this.dlaFocus) this.focusChanged();
  }

  /**
   * Call when the focused token changes. Once DLA has been shown for this
   * response, re-fetch it for the new token, debounced so arrowing through the
   * token strip sends one request. `analysis.svelte.ts` wires this to
   * `state.focusTokenIndex`.
   */
  focusChanged() {
    const s = this.state;
    this.cancelFocusRefresh();
    // A request still loading re-checks the focus when it lands.
    const dla = !!s.dlaResponse && !s.dlaLoading && s.focusTokenIndex !== this.dlaFocus;
    const circuit = !!s.circuitResponse && !s.circuitLoading && s.focusTokenIndex !== this.circuitFocus;
    if (!dla && !circuit) return;
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (dla) void this.dla();
      if (circuit) void this.circuit(this.circuitSource, this.circuitThreshold);
    }, DLA_FOCUS_DEBOUNCE_MS);
  }

  private cancelFocusRefresh() {
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
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
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (!presetId || prompt === null) return;
    const out = await this.request('steer', presetId, prompt, () =>
      steerGenerate(presetId, prompt, featureId, saeLayerVal, alpha),
    );
    if (out) this.state.steerResponse = out.result;
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
    if (!presetId || prompt === null || s.headAblations.length === 0) return;
    const ablations = s.headAblations;
    const out = await this.request('headAblation', presetId, prompt, () => ablateHeads(presetId, prompt, ablations));
    if (out) s.headAblateResponse = out.result;
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
    if (!presetId || prompt === null || s.featureAblations.length === 0) return;
    const ablations = s.featureAblations;
    const out = await this.request('featureAblation', presetId, prompt, () =>
      ablateFeatures(presetId, prompt, ablations),
    );
    if (out) s.featureAblateResponse = out.result;
  }

  /** Patching compares two prompts typed into the patching panel, so it does not need a response. */
  async patching(cleanPrompt: string, corruptedPrompt: string, patchType: 'head' | 'mlp' | 'resid') {
    const presetId = this.deps.getActivePresetId();
    if (!presetId) return;
    const out = await this.request('patch', presetId, null, () =>
      runPatching(presetId, cleanPrompt, corruptedPrompt, patchType),
    );
    if (out) this.state.patchResponse = out.result;
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

  private headScoresSeq = 0;

  async headScores() {
    const s = this.state;
    if (s.headScoresLoading) return;
    s.headScoresLoading = true;
    const seq = ++this.headScoresSeq;
    try {
      await this.deps.ensureLoaded();
      const presetId = this.deps.getActivePresetId();
      if (!presetId) return;
      const result = await fetchHeadScores(presetId);
      // Drop a result for a model that was switched away while it ran.
      if (seq === this.headScoresSeq && this.deps.getActivePresetId() === presetId) {
        s.headScoresResponse = result;
      }
    } catch (e) {
      if (seq === this.headScoresSeq) s.error = errMsg(e);
    } finally {
      if (seq === this.headScoresSeq) s.headScoresLoading = false;
    }
  }

  /**
   * Key parts for the focused word's next-word guess, the same word Why (DLA)
   * explains. Refetched when the focus changes, like DLA.
   */
  async circuit(source: 'dla' | 'patching', threshold?: number) {
    const s = this.state;
    const presetId = this.deps.getActivePresetId();
    const prompt = this.analysisPrompt;
    if (!presetId || prompt === null) return;
    const focus = s.focusTokenIndex;
    this.circuitFocus = focus;
    this.circuitSource = source;
    this.circuitThreshold = threshold;
    const out = await this.request('circuit', presetId, prompt, () =>
      fetchCircuit(presetId, prompt, source, threshold, focus),
    );
    if (!out) return;
    s.circuitResponse = out.result;
    if (s.focusTokenIndex !== this.circuitFocus) this.focusChanged();
  }
}
