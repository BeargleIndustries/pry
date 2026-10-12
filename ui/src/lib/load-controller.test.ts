import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_PRESET_KEY, createLoadController, type LoadDeps } from './load-controller.svelte';
import type { LoadProgress, ModelList } from './sidecar';

/** A sidecar call held open until the test settles it. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const MODELS: ModelList = {
  loaded: [],
  active: null,
  available: [
    { id: 'gpt2-small', tier: 'free', downloaded: true, available_sae_layers: [0, 6, 11] },
    { id: 'pythia-70m', tier: 'free', downloaded: true, available_sae_layers: [0, 1] },
  ],
};

/**
 * A controller whose /load calls are held open: each call gets a deferred
 * the test resolves. `loads` records every /load (the mock's call count).
 */
function setup(opts: { storage?: Record<string, string>; models?: ModelList } = {}) {
  const loads: { presetId: string; signal?: AbortSignal; d: { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void }; onProgress: (ev: LoadProgress) => void }[] = [];
  const storage = memoryStorage(opts.storage);
  const analysis = {
    clearForModelSwitch: vi.fn(),
    setAvailableSaeLayers: vi.fn(),
    setError: vi.fn(),
  };
  const deps: LoadDeps = {
    loadPreset: vi.fn((presetId: string, onProgress: (ev: LoadProgress) => void, signal?: AbortSignal) => {
      const d = deferred<void>();
      loads.push({ presetId, signal, d, onProgress });
      // Mirror fetch: an abort rejects the stream with AbortError.
      signal?.addEventListener('abort', () => d.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      return d.promise;
    }),
    unloadPreset: vi.fn(async () => ({})),
    listModels: vi.fn(async () => opts.models ?? MODELS),
    listCustomPresetIds: vi.fn(async () => []),
    storage: () => storage,
    displayName: (id: string) => id,
    analysis,
    clearCompare: vi.fn(),
    onLoadStart: vi.fn(),
    onUnloadStart: vi.fn(),
    onLoadEvent: vi.fn(),
    gate: {
      needsSteps: () => false,
      open: vi.fn(),
      close: vi.fn(),
      openOnError: vi.fn(),
      markPassed: vi.fn(),
    },
  };
  const ctl = createLoadController(deps);
  return { ctl, s: ctl.state, deps, loads, storage, analysis };
}

/** Let queued microtasks (listModels, awaits) run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => vi.clearAllMocks());

describe('auto-load and ensureLoaded share one load (B3)', () => {
  it('ensureLoaded during auto-load does not start a second /load', async () => {
    const { ctl, s, deps, loads } = setup({ storage: { [ACTIVE_PRESET_KEY]: 'gpt2-small' } });
    const auto = ctl.autoLoad();
    // ensureLoaded before auto-load even knows its target (listModels pending).
    const early = ctl.ensureLoaded();
    await flush();
    expect(s.loadState).toBe('loading');
    const late = ctl.ensureLoaded();
    await flush();
    expect(deps.loadPreset).toHaveBeenCalledTimes(1);

    loads[0].d.resolve();
    await Promise.all([auto, early, late]);
    expect(deps.loadPreset).toHaveBeenCalledTimes(1);
    expect(s.loadState).toBe('loaded');
    expect(s.activePresetId).toBe('gpt2-small');
  });

  it('ensureLoaded sees an auto-load failure instead of loading again', async () => {
    const { ctl, s, deps, loads } = setup({ storage: { [ACTIVE_PRESET_KEY]: 'gpt2-small' } });
    void ctl.autoLoad();
    await flush();
    const waiting = ctl.ensureLoaded();
    loads[0].d.reject(new Error('out of memory'));
    await expect(waiting).rejects.toThrow('out of memory');
    expect(deps.loadPreset).toHaveBeenCalledTimes(1);
    expect(s.loadState).toBe('error');
    expect(s.bannerPhase).toBe('error');
  });

  it('with nothing saved, ensureLoaded loads the default model after auto-load gives up', async () => {
    const { ctl, s, loads, storage } = setup();
    void ctl.autoLoad();
    const p = ctl.ensureLoaded();
    await flush();
    expect(loads.map((l) => l.presetId)).toEqual(['gpt2-small']);
    loads[0].d.resolve();
    await p;
    expect(s.activePresetId).toBe('gpt2-small');
    expect(storage.getItem(ACTIVE_PRESET_KEY)).toBe('gpt2-small');
  });
});

describe('superseded and aborted loads (B4)', () => {
  it('superseded auto-load does not write pry:active_preset', async () => {
    // Saved only as the onboarding pick, so a write would be visible.
    const { ctl, s, loads, storage } = setup({ storage: { 'pry:onboarding_preset': 'pythia-70m' } });
    void ctl.autoLoad();
    await flush();
    expect(loads).toHaveLength(1);
    expect(s.bannerPhase).toBe('loading');

    ctl.abort();
    // The engine finishes the old load anyway.
    loads[0].onProgress({ stage: 'ready', message: 'stale', progress: 1 });
    loads[0].d.resolve();
    await flush();

    expect(storage.getItem(ACTIVE_PRESET_KEY)).toBeNull();
    expect(s.loadState).toBe('idle');
    expect(s.bannerPhase).toBe('idle');
    expect(s.bannerMessage).toBeNull();
    expect(s.loadProgress).toBeNull();
  });

  it('a restart supersedes the old auto-load; only the new one writes', async () => {
    const { ctl, s, loads, storage } = setup({ storage: { 'pry:onboarding_preset': 'pythia-70m' } });
    void ctl.autoLoad();
    await flush();
    const second = ctl.engineRestarted();
    await flush();
    expect(loads).toHaveLength(2);
    // The old (aborted) stream settles late: nothing changes.
    loads[0].d.resolve();
    await flush();
    expect(s.loadState).toBe('loading');
    expect(storage.getItem(ACTIVE_PRESET_KEY)).toBeNull();

    loads[1].d.resolve();
    await second;
    expect(s.loadState).toBe('loaded');
    expect(storage.getItem(ACTIVE_PRESET_KEY)).toBe('pythia-70m');
  });

  it('switcher is disabled while loading', async () => {
    const { ctl, s, loads } = setup({ storage: { [ACTIVE_PRESET_KEY]: 'gpt2-small' } });
    expect(ctl.switcherDisabled).toBe(false);
    void ctl.autoLoad();
    await flush();
    expect(s.loadState).toBe('loading');
    expect(ctl.switcherDisabled).toBe(true);
    expect(ctl.runBlocked).toBe(true);
    loads[0].d.resolve();
    await flush();
    expect(ctl.switcherDisabled).toBe(false);
    expect(ctl.runBlocked).toBe(false);
  });

  it('aborting an auto-load returns loadState to idle and re-enables the switcher', async () => {
    const { ctl, s, loads } = setup({ storage: { [ACTIVE_PRESET_KEY]: 'pythia-70m' } });
    void ctl.autoLoad();
    await flush();
    expect(ctl.switcherDisabled).toBe(true);
    ctl.abort();
    expect(loads[0].signal?.aborted).toBe(true);
    expect(s.loadState).toBe('idle');
    expect(s.activePresetId).toBeNull();
    expect(ctl.switcherDisabled).toBe(false);
    await flush();
    expect(s.loadState).toBe('idle');
  });

  it('a switch during auto-load waits for it, then unloads it, so only one model loads at a time', async () => {
    const { ctl, s, deps, loads, storage } = setup({ storage: { [ACTIVE_PRESET_KEY]: 'gpt2-small' } });
    void ctl.autoLoad();
    await flush();
    const sw = ctl.switchTo('pythia-70m');
    await flush();
    expect(loads).toHaveLength(1);
    loads[0].d.resolve();
    await flush();
    expect(deps.unloadPreset).toHaveBeenCalledWith('gpt2-small');
    expect(loads.map((l) => l.presetId)).toEqual(['gpt2-small', 'pythia-70m']);
    loads[1].d.resolve();
    await sw;
    expect(s.activePresetId).toBe('pythia-70m');
    expect(s.loadState).toBe('loaded');
    expect(s.bannerPhase).toBe('idle');
    expect(storage.getItem(ACTIVE_PRESET_KEY)).toBe('pythia-70m');
  });

  it('ensureLoaded during a switch waits for it', async () => {
    const { ctl, deps, loads } = setup();
    const sw = ctl.switchTo('pythia-70m');
    await flush();
    const p = ctl.ensureLoaded();
    await flush();
    expect(deps.loadPreset).toHaveBeenCalledTimes(1);
    loads[0].d.resolve();
    await Promise.all([sw, p]);
    expect(deps.loadPreset).toHaveBeenCalledTimes(1);
  });
});

describe('model switch', () => {
  it('a failed switch leaves no active model and does not throw', async () => {
    const { ctl, s, deps, loads } = setup();
    const sw = ctl.switchTo('pythia-70m');
    await flush();
    loads[0].d.reject(new Error('download failed'));
    await sw;
    expect(s.activePresetId).toBeNull();
    expect(s.loadState).toBe('error');
    expect(s.bannerError).toBe('download failed');
    expect(deps.gate.openOnError).toHaveBeenCalledWith('pythia-70m', 'download failed');
  });

  it('a switch clears analyses and fills the new model\'s SAE layers', async () => {
    const { ctl, analysis, loads } = setup();
    const sw = ctl.switchTo('pythia-70m');
    await flush();
    loads[0].d.resolve();
    await sw;
    expect(analysis.clearForModelSwitch).toHaveBeenCalledTimes(1);
    expect(analysis.setAvailableSaeLayers).toHaveBeenLastCalledWith([0, 1]);
  });
});

describe('engine restart (B7, B8)', () => {
  it('engine restart clears analyses and resets SAE layers', async () => {
    const models: ModelList = { ...MODELS, loaded: ['gpt2-small'], active: 'gpt2-small' };
    const { ctl, s, analysis } = setup({ models });
    await ctl.autoLoad();
    expect(s.loadState).toBe('loaded');
    analysis.clearForModelSwitch.mockClear();
    analysis.setAvailableSaeLayers.mockClear();

    // The engine comes back empty; the model reloads at its default layer.
    const restarted = ctl.engineRestarted();
    expect(analysis.clearForModelSwitch).toHaveBeenCalledTimes(1);
    expect(analysis.setAvailableSaeLayers).toHaveBeenNthCalledWith(1, []);
    await restarted;
    // Refilled from the engine's list for the reloaded model.
    expect(analysis.setAvailableSaeLayers).toHaveBeenLastCalledWith([0, 6, 11]);
  });

  it('a change of active model empties the SAE layer list', async () => {
    const { ctl, analysis, loads } = setup({ storage: { [ACTIVE_PRESET_KEY]: 'pythia-70m' } });
    void ctl.autoLoad();
    await flush();
    expect(analysis.setAvailableSaeLayers).toHaveBeenNthCalledWith(1, []);
    expect(analysis.setAvailableSaeLayers).toHaveBeenLastCalledWith([0, 1]);
    loads[0].d.resolve();
  });
});
