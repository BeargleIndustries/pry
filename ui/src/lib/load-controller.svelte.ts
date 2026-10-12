// Model load state + flows (first load, auto-load at startup, model switch,
// engine restart), moved out of `+page.svelte` so they can be unit-tested.
// Dependencies are injected the way `analysis-core.ts` does it; the page only
// wires them up.
//
// Rules:
// - At most one load runs at a time. Auto-load, ensureLoaded and a switch all
//   publish their promise as the pending load; a caller that needs the model
//   waits for it instead of starting a second /load.
// - Every load gets a sequence number. A load that was aborted or superseded
//   writes nothing when it finishes: not loadState, not the banner, not
//   pry:active_preset.
// - A switch waits for a running load to finish before it starts, so two
//   models are never loading at once.
import type { LoadProgress, ModelList, PresetInfo } from './sidecar';

export type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
export type BannerPhase = 'idle' | 'unloading' | 'loading' | 'warning' | 'error';

/** Model used when nothing has been picked yet. */
export const DEFAULT_PRESET_ID = 'gpt2-small';
export const ACTIVE_PRESET_KEY = 'pry:active_preset';
const ONBOARDING_PRESET_KEY = 'pry:onboarding_preset';

export interface LoadControllerState {
  activePresetId: string | null;
  loadState: LoadState;
  loadProgress: LoadProgress | null;
  bannerPhase: BannerPhase;
  bannerMessage: string | null;
  bannerError: string | null;
  bannerTargetPreset: string | null;
  switchInFlight: boolean;
  /** `/models` presets, a fallback source of display names. */
  sidecarPresets: PresetInfo[];
}

export function createInitialLoadState(): LoadControllerState {
  return {
    activePresetId: null,
    loadState: 'idle',
    loadProgress: null,
    bannerPhase: 'idle',
    bannerMessage: null,
    bannerError: null,
    bannerTargetPreset: null,
    switchInFlight: false,
    sidecarPresets: [],
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LoadDeps {
  loadPreset: (presetId: string, onProgress: (ev: LoadProgress) => void, signal?: AbortSignal) => Promise<void>;
  unloadPreset: (presetId: string) => Promise<unknown>;
  listModels: () => Promise<ModelList>;
  /** Saved custom model preset ids (`custom:<hf id>`), or null if they can't be read. */
  listCustomPresetIds: () => Promise<string[] | null>;
  /** localStorage, or null where it isn't available. */
  storage: () => StorageLike | null;
  displayName: (presetId: string) => string;
  analysis: {
    clearForModelSwitch: () => void;
    setAvailableSaeLayers: (layers: number[]) => void;
    setError: (message: string | null) => void;
  };
  clearCompare: () => void;
  /** Loading-screen track hooks. */
  onLoadStart: (presetId: string) => void;
  onUnloadStart: (presetId: string) => void;
  onLoadEvent: (ev: LoadProgress) => void;
  /** License gate (Gemma). */
  gate: {
    /** The model needs its license steps shown before the first load. */
    needsSteps: (presetId: string) => boolean;
    open: (presetId: string) => void;
    close: () => void;
    openOnError: (presetId: string, message: string | null) => void;
    markPassed: (presetId: string) => void;
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

export class LoadController {
  private seq = 0;
  private abortCtl: AbortController | null = null;
  /** The load everyone waits on, if one is running. */
  private pending: Promise<void> | null = null;
  /** Model and load state to go back to if the running load is aborted. */
  private before: { activePresetId: string | null; loadState: LoadState } | null = null;

  constructor(
    readonly state: LoadControllerState,
    private readonly deps: LoadDeps,
  ) {}

  /** The model a Run loads: the active one, or the default. */
  get selectedPreset(): string {
    return this.state.activePresetId ?? DEFAULT_PRESET_ID;
  }

  /** The model switcher and the Settings preset list can't start a switch. */
  get switcherDisabled(): boolean {
    return this.state.switchInFlight || this.state.loadState === 'loading';
  }

  /** Run can't start: a load or switch is running, or no model is picked. */
  get runBlocked(): boolean {
    const s = this.state;
    return (
      s.loadState === 'loading' ||
      s.bannerPhase === 'unloading' ||
      s.bannerPhase === 'loading' ||
      s.switchInFlight ||
      s.activePresetId === null
    );
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private begin(): { seq: number; signal: AbortSignal } {
    this.abortCtl?.abort();
    const s = this.state;
    this.before = {
      activePresetId: s.activePresetId,
      loadState: s.loadState === 'loading' ? 'idle' : s.loadState,
    };
    this.abortCtl = new AbortController();
    return { seq: ++this.seq, signal: this.abortCtl.signal };
  }

  private isCurrent(seq: number): boolean {
    return seq === this.seq;
  }

  private finish(seq: number) {
    if (!this.isCurrent(seq)) return;
    this.pending = null;
    this.abortCtl = null;
    this.before = null;
  }

  /** Publish `p` as the load everyone waits on. Its rejection reaches the waiters. */
  private publish(p: Promise<void>): Promise<void> {
    this.pending = p;
    p.catch(() => { /* waiters handle it; this only marks it handled */ });
    return p;
  }

  /** Progress events from a superseded load are dropped. */
  private eventsFor(seq: number) {
    return (ev: LoadProgress) => {
      if (!this.isCurrent(seq)) return;
      this.state.loadProgress = ev;
      this.state.bannerMessage = ev.message;
      this.deps.onLoadEvent(ev);
    };
  }

  /** Change the active model. The SAE layer list belongs to the old one. */
  private setActive(presetId: string | null) {
    if (this.state.activePresetId === presetId) return;
    this.state.activePresetId = presetId;
    this.deps.analysis.setAvailableSaeLayers([]);
  }

  private persist(presetId: string) {
    try { this.deps.storage()?.setItem(ACTIVE_PRESET_KEY, presetId); } catch { /* unavailable */ }
  }

  private clearBanner() {
    const s = this.state;
    s.bannerPhase = 'idle';
    s.bannerMessage = null;
    s.bannerError = null;
    s.bannerTargetPreset = null;
  }

  private fillSaeLayers(available: PresetInfo[], presetId: string) {
    const info = available.find((p) => p.id === presetId);
    this.deps.analysis.setAvailableSaeLayers(info?.available_sae_layers ?? []);
  }

  // -------------------------------------------------------------------------
  // Flows
  // -------------------------------------------------------------------------

  /** Make sure a model is loaded. Waits for a running load instead of starting a second one. */
  async ensureLoaded(): Promise<void> {
    while (this.pending) await this.pending;
    if (this.state.loadState === 'loaded') return;
    const s = this.state;
    const preset = this.selectedPreset;
    const { seq, signal } = this.begin();
    return this.publish((async () => {
      try {
        s.loadState = 'loading';
        s.loadProgress = null;
        this.deps.analysis.setError(null);
        this.deps.onLoadStart(preset);
        await this.deps.loadPreset(preset, this.eventsFor(seq), signal);
        if (!this.isCurrent(seq)) return;
        s.loadState = 'loaded';
        if (s.activePresetId !== preset) {
          this.setActive(preset);
          this.persist(preset);
        }
      } catch (e) {
        if (isAbort(e) || !this.isCurrent(seq)) return;
        s.loadState = 'error';
        this.deps.analysis.setError(errMsg(e));
        throw e;
      } finally {
        this.finish(seq);
      }
    })());
  }

  /**
   * Startup: load the model the engine already has, or the one saved last
   * time. Best-effort: failures show in the banner. Callers of ensureLoaded
   * wait for it (and see its error) instead of starting their own load.
   */
  autoLoad(): Promise<void> {
    const s = this.state;
    const { seq, signal } = this.begin();
    return this.publish((async () => {
      try {
        let stored: string | null = null;
        try {
          const st = this.deps.storage();
          stored = st?.getItem(ACTIVE_PRESET_KEY) ?? st?.getItem(ONBOARDING_PRESET_KEY) ?? null;
        } catch { /* localStorage may be unavailable */ }

        let sidecarActive: string | null = null;
        let sidecarLoaded: string[] = [];
        let available: PresetInfo[] | null = null;
        try {
          const models = await this.deps.listModels();
          if (!this.isCurrent(seq)) return;
          sidecarActive = models.active ?? null;
          sidecarLoaded = models.loaded ?? [];
          available = models.available ?? [];
          s.sidecarPresets = available;
        } catch { /* sidecar may not be up yet; fall through */ }
        if (!this.isCurrent(seq)) return;

        let target = sidecarActive ?? stored ?? null;
        // A remembered custom model that has since been removed: start on the
        // default model instead of quietly reloading it.
        if (target?.startsWith('custom:') && !sidecarLoaded.includes(target)) {
          const saved = await this.deps.listCustomPresetIds().catch(() => null);
          if (!this.isCurrent(seq)) return;
          if (saved && !saved.includes(target)) {
            try { this.deps.storage()?.removeItem(ACTIVE_PRESET_KEY); } catch { /* unavailable */ }
            target = DEFAULT_PRESET_ID;
          }
        }
        if (!target) return;
        this.setActive(target);
        if (available) this.fillSaeLayers(available, target);

        if (sidecarLoaded.includes(target)) {
          s.loadState = 'loaded';
          return;
        }

        s.bannerPhase = 'loading';
        s.bannerTargetPreset = target;
        s.bannerMessage = `Loading ${this.deps.displayName(target)}…`;
        s.bannerError = null;
        s.loadProgress = null;
        s.loadState = 'loading';
        this.deps.onLoadStart(target);
        try {
          await this.deps.loadPreset(target, this.eventsFor(seq), signal);
        } catch (err) {
          if (isAbort(err) || !this.isCurrent(seq)) return;
          s.loadState = 'error';
          s.bannerPhase = 'error';
          s.bannerError = errMsg(err);
          this.deps.gate.openOnError(target, s.bannerError);
          throw err;
        }
        if (!this.isCurrent(seq)) return;
        s.loadState = 'loaded';
        this.clearBanner();
        this.persist(target);
      } finally {
        this.finish(seq);
      }
    })());
  }

  /**
   * Switch to another model. Never throws: a failure shows in the banner and
   * leaves no active model, so callers check `activePresetId` afterwards.
   */
  async switchTo(presetId: string, pastGate = false): Promise<void> {
    const s = this.state;
    if (s.switchInFlight) return;
    if (presetId === s.activePresetId && s.loadState === 'loaded') return;
    if (!pastGate && this.deps.gate.needsSteps(presetId)) {
      this.deps.gate.open(presetId);
      return;
    }
    this.deps.gate.close();
    s.switchInFlight = true;
    try {
      // Let a running load finish first: aborting it wouldn't stop the
      // engine, which would end up with both models resident.
      while (this.pending) await this.pending.catch(() => {});
      if (presetId === s.activePresetId && s.loadState === 'loaded') return;
      await this.publish(this.runSwitch(presetId)).catch(() => { /* shown in the banner */ });
    } finally {
      s.switchInFlight = false;
    }
  }

  private async runSwitch(presetId: string): Promise<void> {
    const s = this.state;
    const { seq, signal } = this.begin();
    s.bannerError = null;
    s.bannerTargetPreset = presetId;
    const previousActive = s.activePresetId;
    try {
      this.deps.onLoadStart(presetId);
      if (previousActive && previousActive !== presetId) {
        s.bannerPhase = 'unloading';
        s.bannerMessage = `Unloading ${this.deps.displayName(previousActive)}…`;
        s.loadProgress = null;
        this.deps.onUnloadStart(previousActive);
        await this.deps.unloadPreset(previousActive);
        if (!this.isCurrent(seq)) return;
      }
      s.bannerPhase = 'loading';
      s.bannerMessage = `Loading ${this.deps.displayName(presetId)}…`;
      s.loadProgress = null;
      s.loadState = 'loading';
      await this.deps.loadPreset(presetId, this.eventsFor(seq), signal);
      if (!this.isCurrent(seq)) return;
      this.setActive(presetId);
      s.loadState = 'loaded';
      // Everything shown belongs to the old model.
      this.deps.analysis.clearForModelSwitch();
      this.deps.clearCompare();
      this.persist(presetId);
      this.deps.gate.markPassed(presetId);
      try {
        const models = await this.deps.listModels();
        if (this.isCurrent(seq)) {
          s.sidecarPresets = models.available ?? [];
          this.fillSaeLayers(s.sidecarPresets, presetId);
        }
      } catch { /* best-effort */ }
      if (!this.isCurrent(seq)) return;
      s.bannerPhase = 'idle';
      s.bannerMessage = null;
      s.bannerTargetPreset = null;
    } catch (err) {
      if (isAbort(err) || !this.isCurrent(seq)) return;
      this.setActive(null);
      s.loadState = 'error';
      s.bannerPhase = 'error';
      s.bannerError = errMsg(err);
      this.deps.gate.openOnError(presetId, s.bannerError);
      throw err;
    } finally {
      this.finish(seq);
    }
  }

  /**
   * Stop the running load. Its late result is dropped, and the state goes
   * back to what it was before it started, so nothing stays disabled.
   */
  abort() {
    const s = this.state;
    if (!this.abortCtl && !this.pending) return;
    this.abortCtl?.abort();
    this.abortCtl = null;
    this.seq++;
    this.pending = null;
    if (this.before) {
      s.activePresetId = this.before.activePresetId;
      s.loadState = this.before.loadState;
    } else if (s.loadState === 'loading') {
      s.loadState = 'idle';
    }
    this.before = null;
    if (s.bannerPhase === 'loading' || s.bannerPhase === 'unloading') this.clearBanner();
  }

  /** Error card Retry: drop any running load and start over on the next Run. */
  reset() {
    this.abort();
    this.state.loadState = 'idle';
  }

  /**
   * The engine came back (crash or manual restart). Its memory is empty, and
   * the reload comes back at the preset's default SAE layer, so everything
   * shown for the old session is dropped before reloading the active model.
   */
  engineRestarted(): Promise<void> {
    this.abort();
    this.state.loadState = 'idle';
    this.deps.analysis.clearForModelSwitch();
    this.deps.analysis.setAvailableSaeLayers([]);
    return this.autoLoad();
  }
}

/**
 * Create the controller. The page passes its own `$state` variables as
 * `state` (getters/setters) so its template keeps reading them by name;
 * without one, the state is a fresh `$state` object.
 */
export function createLoadController(deps: LoadDeps, state?: LoadControllerState): LoadController {
  if (state) return new LoadController(state, deps);
  const own = $state(createInitialLoadState());
  return new LoadController(own, deps);
}
