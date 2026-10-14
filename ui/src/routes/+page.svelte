<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Settings, Download, FlaskConical, GitCompareArrows, BookOpen, BookmarkPlus, GraduationCap, MoveHorizontal } from 'lucide-svelte';
  import PryLogo from '$lib/components/icons/PryLogo.svelte';
  import { health, loadPreset, unloadPreset, listModels } from '$lib/sidecar';
  import { withoutEngineMemory } from '$lib/hardware-adjust';
  import type { LoadProgress, PresetInfo } from '$lib/sidecar';
  import { createAnalysis } from '$lib/analysis.svelte';
  import { createLoadController } from '$lib/load-controller.svelte';
  import {
    cachedHardwareReport,
    probeHardware,
    evaluatePresets,
    saveJsonFile,
    listCustomModels,
    removeCustomModel,
    evaluateCustomModel,
  } from '$lib/tauri';
  import type { HardwareReport, PresetCompatibility, CustomPreset } from '$lib/tauri';
  import HardwareCard from '$lib/components/HardwareCard.svelte';
  import PresetList from '$lib/components/PresetList.svelte';
  import PanelA from '$lib/components/PanelA.svelte';
  import PanelB from '$lib/components/PanelB.svelte';
  import TabbedPanel from '$lib/components/TabbedPanel.svelte';
  import PredictionsPanel from '$lib/components/PredictionsPanel.svelte';
  import LogitLensPanel from '$lib/components/LogitLensPanel.svelte';
  import DLAPanel from '$lib/components/DLAPanel.svelte';
  import SteeringPanel from '$lib/components/SteeringPanel.svelte';
  import PatchingPanel from '$lib/components/PatchingPanel.svelte';
  import CircuitPanel from '$lib/components/CircuitPanel.svelte';
  import type { TabDef } from '$lib/components/TabbedPanel.svelte';
  import SharedTokenStrip from '$lib/components/SharedTokenStrip.svelte';
  import ResizableSplit from '$lib/components/ResizableSplit.svelte';
  import CustomModelDialog from '$lib/components/CustomModelDialog.svelte';
  import HardwareTradingCard from '$lib/components/HardwareTradingCard.svelte';
  import SettingsDrawer from '$lib/components/SettingsDrawer.svelte';
  import DrivenTutorial from '$lib/components/DrivenTutorial.svelte';
  import FirstTimeTip from '$lib/components/FirstTimeTip.svelte';
  import { occupied, OCCUPIED } from '$lib/popup/occupied.svelte';
  import { POPUP_AUDIT } from '$lib/popup/dev';
  import TourMenu from '$lib/components/TourMenu.svelte';
  import TourSettings from '$lib/components/TourSettings.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import LoadProgressBanner from '$lib/components/LoadProgressBanner.svelte';
  import LoadingScreen from '$lib/components/LoadingScreen.svelte';
  import { startLoad, applyEvent, recordEvent, readHistory, type LoadTrack } from '$lib/load-progress';
  import RuntimeUpdatePrompt from '$lib/components/RuntimeUpdatePrompt.svelte';
  import UpdateCard from '$lib/components/UpdateCard.svelte';
  import UpdateSettings from '$lib/components/UpdateSettings.svelte';
  import ModelSwitcher from '$lib/components/ModelSwitcher.svelte';
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import type { TutorialActions } from '$lib/tutorial/actions';
  import { page } from '$app/stores';
  import EngineStatusChip from '$lib/components/EngineStatusChip.svelte';
  import EngineCrashBanner from '$lib/components/EngineCrashBanner.svelte';
  import { CUSTOM_MODELS_ENABLED } from '$lib/flags';
  import { customCompatibility, hfIdOf, isCustomPresetId } from '$lib/custom-models';
  import NoFeaturesNotice from '$lib/components/NoFeaturesNotice.svelte';
  import { friendlyError } from '$lib/errors';
  import { displayName, findPreset, needsHfToken } from '$lib/preset-display';
  import { gatePassedKey, gateStepMissing, type GateStep } from '$lib/hf-gate';
  import LicenseGateSteps from '$lib/components/LicenseGateSteps.svelte';
  import { goto } from '$app/navigation';
  import ExperimentGallery from '$lib/components/ExperimentGallery.svelte';
  import { loadExperiments, applyExperiment, resetExperiment } from '$lib/experiments/experiments';
  import type { Experiment, ExperimentActions, ResetActions, PatchType } from '$lib/experiments/experiments';
  import { demoFromParams } from '$lib/head-scores';
  import { createCompare } from '$lib/compare.svelte';
  import ComparePanel from '$lib/components/ComparePanel.svelte';
  import NotebookPanel from '$lib/components/NotebookPanel.svelte';
  import { createNotebookStore } from '$lib/notebook.svelte';
  import { bindPryHost, hasPryHost, pryMemo, pryUi } from '$lib/lessons/registry/pry-state.svelte';
  import { buildProvenance, type ProvenanceExtras } from '$lib/notebook';
  import { isTauri } from '$lib/is-tauri';
  import LessonSidebar from '$lib/lessons/LessonSidebar.svelte';
  import InstallSheet from '$lib/lessons/InstallSheet.svelte';
  import LessonsSettings from '$lib/lessons/LessonsSettings.svelte';
  import { lessonsCopy } from '$lib/lessons/copy';
  import { clampSidebar, layoutFor, readPrefs, widenShown, widenTarget, writePref, type Side } from '$lib/lessons/layout';
  import { prySnapshot } from '$lib/lessons/registry/pry-apply';
  import { pryToolSet } from '$lib/lessons/registry/pry-set';
  import type { LessonsApp } from '$lib/lessons-app.svelte';

  // ---------------------------------------------------------------------------
  // Hardware probe state
  // ---------------------------------------------------------------------------

  let hardware = $state<HardwareReport | null>(null);
  let hardwareLoading = $state(true);
  let hardwareError = $state<string | null>(null);

  let presets = $state<PresetCompatibility[] | null>(null);
  let presetsLoading = $state(false);
  let presetsError = $state<string | null>(null);

  // `live`: the report was just probed, so its GPU use includes the engine's
  // current model and that model's memory can be discounted (switching
  // unloads it first). A cached report predates the load, so it's used as-is.
  async function loadPresets(hw: HardwareReport, live = false) {
    presetsLoading = true;
    try {
      const reserved = live ? await health().then((h) => h.vram_reserved_mb ?? null, () => null) : null;
      presets = await evaluatePresets(withoutEngineMemory(hw, reserved));
      presetsError = null;
    } catch (e) {
      presets = null;
      presetsError = e instanceof Error ? e.message : String(e);
    } finally {
      presetsLoading = false;
    }
  }

  async function runProbe() {
    hardwareLoading = true;
    hardwareError = null;
    try {
      const report = await probeHardware();
      hardware = report;
      void loadPresets(report, true);
    } catch (err) {
      hardwareError = err instanceof Error ? err.message : String(err);
    } finally {
      hardwareLoading = false;
    }
  }

  onMount(() => {
    cachedHardwareReport().then((cached) => {
      if (cached) {
        hardware = cached;
        hardwareLoading = false;
        void loadPresets(cached);
      }
    }).catch((e) => console.error('cached hardware report failed:', e));
    runProbe();
  });

  // ---------------------------------------------------------------------------
  // Sidecar health
  // ---------------------------------------------------------------------------

  let sidecarOk = $state<boolean | null>(null);
  let sidecarStatus = $state<string | null>(null);
  let sidecarVersion = $state<string | null>(null);

  onMount(() => {
    health()
      .then((h) => { sidecarOk = true; sidecarStatus = h.status; sidecarVersion = h.version; })
      .catch(() => { sidecarOk = false; });
  });

  // ---------------------------------------------------------------------------
  // Generate state (Svelte 5 runes)
  // ---------------------------------------------------------------------------

  let prompt = $state("The cat sat on the mat. The cat sat on the mat. The cat sat on the");
  let activePresetId = $state<string | null>(null);
  const selectedPreset = $derived(activePresetId ?? 'gpt2-small');
  let loadState = $state<"idle" | "loading" | "loaded" | "error">("idle");
  // Re-judge the other models once a model is resident: a fresh probe sees its
  // GPU memory, which loadPresets then discounts.
  let probedFor: string | null = null;
  $effect(() => {
    if (loadState !== 'loaded' || !activePresetId || activePresetId === probedFor) return;
    probedFor = activePresetId;
    void runProbe();
  });
  let loadProgress = $state<LoadProgress | null>(null);
  // Bumped whenever the engine state changes, so the status chip re-reads /health.
  let healthKey = $state(0);
  $effect(() => {
    if (loadState === 'loaded') untrack(() => healthKey++);
  });
  // /models presets, as a fallback source of the display block.
  let sidecarPresets = $state<PresetInfo[]>([]);
  const presetDisplay = $derived(
    findPreset(activePresetId, presets)?.display ??
      findPreset(activePresetId, sidecarPresets)?.display ??
      null,
  );

  // Generate response + all analysis state/dispatchers live in the analysis
  // module. Analyses always use the prompt that was run (response.prompt).
  const analysis = createAnalysis({
    getSelectedPreset: () => selectedPreset,
    getActivePresetId: () => activePresetId,
    ensureLoaded,
  });
  const st = analysis.state;
  const friendly = $derived(st.error ? friendlyError(st.error) : null);
  const promptEdited = $derived(analysis.isPromptEdited(prompt));

  // Compare mode (T25): two prompts side by side. Swaps the workspace for the compare view.
  const compare = createCompare({
    getSelectedPreset: () => selectedPreset,
    getSaeLayer: () => st.saeLayer,
    ensureLoaded,
  });
  let compareMode = $state(false);

  // Load/unload banner state
  let bannerPhase = $state<'idle' | 'unloading' | 'loading' | 'warning' | 'error'>('idle');
  let bannerMessage = $state<string | null>(null);
  let bannerError = $state<string | null>(null);
  let switchInFlight = $state(false);
  let bannerTargetPreset = $state<string | null>(null);
  const bannerVisible = $derived(bannerPhase !== 'idle');

  // Full loading screen: one track per load, fed by every load path. The slim
  // banner stays for errors and warnings.
  let loadTrack = $state<LoadTrack | null>(null);
  const loadingScreenOn = $derived(
    !!loadTrack && !loadTrack.done && !loadTrack.failed &&
      (bannerPhase === 'loading' || bannerPhase === 'unloading' || loadState === 'loading'),
  );
  function beginLoadTrack(presetId: string) {
    loadTrack = startLoad(presetId, Date.now(), readHistory(presetId));
  }
  // The loaded weights' revision (MF-5 ready event): part of the Lessons memo key.
  let loadedRevision: string | null = null;
  function onLoadEvent(ev: LoadProgress) {
    if (loadTrack) loadTrack = recordEvent(loadTrack, ev, Date.now());
    if (ev.stage === 'ready' || ev.stage === 'already_loaded') loadedRevision = ev.model_revision ?? null;
  }

  // ---------------------------------------------------------------------------
  // Responsive layout state
  // ---------------------------------------------------------------------------

  // §P-layout (plan D2): `windowWide` is 0.3.8's isWide (>= 1280px) and only
  // places the prompt; `workspaceSplit` decides split vs tabbed. With Lessons
  // off they're equal and nothing new observes anything.
  let windowWide = $state(true); // >= 1280px → prompt in the header

  $effect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    windowWide = mq.matches;
    const handler = (e: MediaQueryListEvent) => { windowWide = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  // Lessons beside the app (plan T3 "Layout"): width, side and rail remembered.
  const lessonPrefs = readPrefs();
  let lessons = $state<LessonsApp | null>(null);
  let lessonsOn = $state(false);
  let lessonSide = $state<Side>(lessonPrefs.side);
  let lessonWidth = $state<number | null>(lessonPrefs.width);
  let lessonCollapsed = $state(lessonPrefs.collapsed);
  let lessonRowEl = $state<HTMLElement | null>(null);
  let lessonMainEl = $state<HTMLElement | null>(null);
  let lessonRowWidth = $state(0);
  let lessonWorkspace = $state<number | null>(null);
  let lessonWin = $state<{ maximized: boolean; workArea: { width: number; height: number } | null; scale: number }>({ maximized: false, workArea: null, scale: 1 });
  const lessonLayout = $derived(
    layoutFor({ on: lessonsOn, windowWidth: lessonRowWidth || 1280, sidebarWidth: lessonWidth, collapsed: lessonCollapsed, measuredWorkspace: lessonWorkspace }),
  );
  const workspaceSplit = $derived(lessonsOn ? lessonLayout.workspaceSplit : windowWide);
  const widenVisible = $derived(
    lessonsOn &&
      widenShown({ on: true, workspaceSplit, maximized: lessonWin.maximized, window: { width: lessonRowWidth, height: 0 }, sidebar: lessonLayout.sidebar, workArea: lessonWin.workArea, scale: lessonWin.scale }),
  );

  // On only: the row and the workspace are measured (ResizeObserver), and the monitor read for "Widen window".
  $effect(() => {
    if (!lessonsOn || !lessonRowEl || !lessonMainEl) return;
    const row = lessonRowEl;
    const main = lessonMainEl;
    const measure = () => {
      lessonRowWidth = row.clientWidth;
      lessonWorkspace = main.clientWidth;
      void readMonitor();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    ro.observe(main);
    measure();
    return () => {
      ro.disconnect();
      lessonWorkspace = null;
    };
  });

  async function readMonitor() {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow, currentMonitor } = await import('@tauri-apps/api/window');
      const [maximized, mon] = await Promise.all([getCurrentWindow().isMaximized(), currentMonitor()]);
      const area = mon ? (mon.workArea?.size ?? mon.size) : null;
      lessonWin = { maximized, workArea: area ? { width: area.width, height: area.height } : null, scale: mon?.scaleFactor ?? 1 };
    } catch {
      /* no window API: no widen button */
    }
  }

  /** "Widen window": freeze the sidebar width, then size the window to fit both panels (never setMinSize). */
  async function widenWindow() {
    lessonWidth = lessonLayout.sidebar;
    writePref('width', String(lessonWidth));
    const t = widenTarget({ on: true, workspaceSplit, maximized: lessonWin.maximized, window: { width: lessonRowWidth, height: window.innerHeight }, sidebar: lessonLayout.sidebar, workArea: lessonWin.workArea, scale: lessonWin.scale });
    try {
      const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setSize(new LogicalSize(t.width, t.height));
    } catch {
      /* outside Tauri */
    }
  }

  async function ensureLessons(watch: boolean): Promise<LessonsApp> {
    if (!lessons) {
      const [{ createLessonsApp }, log] = await Promise.all([
        import('$lib/lessons-app.svelte'),
        isTauri() ? import('$lib/lessons/log').then((m) => m.openLessonLog()).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const app = createLessonsApp({
        notebook,
        provenance: () => buildProvenance({ ...currentRunData(), saeLayer: st.saeLayer ?? null }, { snapshot: prySnapshot() }),
        modelName: (id) => displayName(id, allCompat),
        currentModel: () => activePresetId,
        log,
      });
      await app.load();
      lessons = app;
    }
    if (watch) await lessons.watch();
    return lessons;
  }

  async function openLessons() {
    // Quick tour and Lessons are exclusive.
    if (tutorialState.open) tutorialState.close();
    lessonsOn = true;
    const app = await ensureLessons(true);
    if (app.state.pending.length) app.state.installOpen = true;
  }

  function closeLessons() {
    lessons?.closeLesson();
    lessonsOn = false;
  }

  $effect(() => {
    if (tutorialState.open && lessonsOn) closeLessons();
  });

  function resizeLessons(w: number) {
    lessonWidth = clampSidebar(w, lessonRowWidth || window.innerWidth);
    writePref('width', String(lessonWidth));
  }

  function setLessonSide(side: Side) {
    lessonSide = side;
    writePref('side', side);
  }

  function setLessonCollapsed(on: boolean) {
    lessonCollapsed = on;
    writePref('collapsed', String(on));
  }

  // Dev-only (POPUP_AUDIT): what the popup audit's learning-mode pass and the
  // harness driver (scripts/dev/popup-audit.mjs) drive Lessons with.
  const auditLessons = {
    open: async (side: Side) => {
      setLessonSide(side);
      setLessonCollapsed(false);
      await openLessons();
    },
    close: () => closeLessons(),
    openLesson: async (id: string, sectionId: string | null = null) => (await ensureLessons(true)).openLesson(id, sectionId),
    sectionCount: () => lessons?.runner.lesson?.sections.length ?? 0,
    goto: async (i: number) => {
      await lessons?.runner.goto(i);
    },
    hasExplainResult: () => {
      const has = (b: { kind: string; children: { kind: string; children: unknown[] }[] }): boolean =>
        b.kind === 'explain-result' || b.children.some((c) => has(c as never));
      return !!lessons?.model.step?.blocks.some((b) => has(b as never));
    },
    railed: () => lessonLayout.railed,
    loaded: () => loadState === 'loaded',
    collapse: (on: boolean) => setLessonCollapsed(on),
    widenVisible: () => widenVisible,
    widen: () => widenWindow(),
    setWindowSize: async (w: number, h: number) => {
      const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
      await getCurrentWindow().unmaximize().catch(() => {});
      await getCurrentWindow().setSize(new LogicalSize(w, h));
    },
    /** Answers, runs and shows the lesson's first observe that has a check. */
    driveObserve: async () => {
      const r = lessons?.runner;
      const lesson = r?.lesson;
      if (!r || !lesson) return false;
      for (let i = 0; i < lesson.sections.length; i++) {
        await r.goto(i);
        const flat = (bs: NonNullable<typeof r.section>['steps']): typeof bs => bs.flatMap((s) => [s, ...flat(s.children)]);
        const steps = flat(lesson.sections[i].steps);
        for (const obs of steps.filter((s) => s.kind === 'observe' && s.fields.check && s.id)) {
          for (const s of steps) {
            if (s === obs) break;
            const key = r.keyOf(lesson.sections[i], s);
            if (s.kind === 'predict') await r.skipStep(key);
            if (s.kind === 'do') await r.doStep(key);
          }
          const key = r.keyOf(lesson.sections[i], obs);
          await r.showObserve(key);
          const flat2 = (bs: { key: string; children: unknown[]; observe?: { result: unknown } }[]): typeof bs =>
            bs.flatMap((b) => [b, ...flat2(b.children as typeof bs)]);
          if (flat2(r.render().blocks as never).find((b) => b.key === key)?.observe?.result) return true;
        }
      }
      return false;
    },
    /** Points at an anchor whose tab is closed (the pointer-hidden-target screenshot). */
    pointHidden: (anchor: string) => {
      lessons?.model.clearPointer();
      lessons?.model.point({ anchor });
    },
    showInstall: () => {
      if (!lessons) return;
      lessons.state.pending = [
        {
          entry: { id: 'someone.lens-tour', source: 'user', folder: '', file: '', lesson: { id: 'someone.lens-tour', title: 'A tour of the logit lens', draft: false, permissions: {}, sections: [], images: [] }, error: null, images: {} },
          manifest: { id: 'someone.lens-tour', sourcePath: '', permissions: { download: ['gpt2-medium'], network: ['neuronpedia'], external: ['arxiv.org'] } },
          ask: { download: ['gpt2-medium'], network: ['neuronpedia'], external: ['arxiv.org'] },
        },
      ];
      lessons.state.installOpen = true;
    },
    openSettings: () => {
      settingsOpen = true;
    },
  };
  if (POPUP_AUDIT && typeof window !== 'undefined') (window as unknown as { __pryLessons: typeof auditLessons }).__pryLessons = auditLessons;

  // ---------------------------------------------------------------------------
  // Inline prompt handler
  // ---------------------------------------------------------------------------

  function onPromptKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }

  // ---------------------------------------------------------------------------
  // Load flow (shared helper)
  // ---------------------------------------------------------------------------

  // Load state and flows live in the load controller (unit-tested). It reads
  // and writes the page's own state variables, so the template is unchanged.
  const load = createLoadController(
    {
      loadPreset,
      unloadPreset,
      listModels,
      listCustomPresetIds: () => listCustomModels().then((list) => list.map((m) => `custom:${m.id}`)),
      storage: () => (typeof localStorage === 'undefined' ? null : localStorage),
      displayName: (id) => displayName(id, allCompat),
      analysis: {
        clearForModelSwitch: () => {
          analysis.clearForModelSwitch();
          // The runner memo belongs to the old weights.
          pryMemo.onModelLoad();
        },
        setAvailableSaeLayers: (layers) => { st.availableSaeLayers = layers; },
        setError: (message) => { st.error = message; },
      },
      clearCompare: () => compare.clear(),
      onLoadStart: beginLoadTrack,
      onUnloadStart: (id) => {
        if (!loadTrack) return;
        loadTrack = applyEvent(
          loadTrack,
          { stage: 'unload', message: `Putting ${displayName(id, allCompat)} away…`, progress: 0 },
          Date.now(),
        );
      },
      onLoadEvent,
      gate: {
        needsSteps: (id) => isGated(id) && !gatePassed(id),
        open: (id) => { gateFor = { presetId: id, missing: null }; },
        close: () => { gateFor = null; },
        openOnError: openGateOnError,
        markPassed: (id) => {
          try { if (isGated(id)) localStorage.setItem(gatePassedKey(id), '1'); } catch { /* ignore */ }
        },
      },
    },
    {
      get activePresetId() { return activePresetId; },
      set activePresetId(v) { activePresetId = v; },
      get loadState() { return loadState; },
      set loadState(v) { loadState = v; },
      get loadProgress() { return loadProgress; },
      set loadProgress(v) { loadProgress = v; },
      get bannerPhase() { return bannerPhase; },
      set bannerPhase(v) { bannerPhase = v; },
      get bannerMessage() { return bannerMessage; },
      set bannerMessage(v) { bannerMessage = v; },
      get bannerError() { return bannerError; },
      set bannerError(v) { bannerError = v; },
      get bannerTargetPreset() { return bannerTargetPreset; },
      set bannerTargetPreset(v) { bannerTargetPreset = v; },
      get switchInFlight() { return switchInFlight; },
      set switchInFlight(v) { switchInFlight = v; },
      get sidecarPresets() { return sidecarPresets; },
      set sidecarPresets(v) { sidecarPresets = v; },
    },
  );

  function ensureLoaded() {
    return load.ensureLoaded();
  }

  onDestroy(() => load.abort());

  // Auto-load the persisted active preset (or the engine's) at startup.
  function autoLoadActivePreset() {
    void load.autoLoad();
  }

  onMount(autoLoadActivePreset);

  // The engine came back (crash restart, manual restart): its memory is empty,
  // so reload whatever was active.
  function handleEngineRestarted() {
    healthKey++;
    void load.engineRestarted();
  }

  // ---------------------------------------------------------------------------
  // Model switch flow
  // ---------------------------------------------------------------------------

  // T31: a gated model (Gemma) explains its license steps before the first
  // load, and again whenever a load fails on a missing step.
  let gateFor = $state<{ presetId: string; missing: GateStep | null } | null>(null);

  function isGated(presetId: string): boolean {
    const c = findPreset(presetId, presets);
    return !!c && needsHfToken(c);
  }

  function gatePassed(presetId: string): boolean {
    try { return localStorage.getItem(gatePassedKey(presetId)) === '1'; } catch { return false; }
  }

  function openGateOnError(presetId: string, message: string | null) {
    const missing = gateStepMissing(message);
    if (missing) gateFor = { presetId, missing };
  }

  function handleSwitch(presetId: string, pastGate = false) {
    return load.switchTo(presetId, pastGate);
  }

  // ---------------------------------------------------------------------------
  // Generate flow
  // ---------------------------------------------------------------------------

  // Thin wrappers so the template and tutorial keep their existing names.
  // Generate reads the text box; every analysis uses the prompt that was run.
  const handleGenerate = () => analysis.generate(prompt);
  const handleLayerSwitch = (layer: number) => analysis.layerSwitch(layer);
  const handleLogitLens = () => analysis.logitLens();
  const handleDLA = () => analysis.dla();
  const handleSteer = (featureId: number, saeLayerVal: number, alpha: number) =>
    analysis.steer(featureId, saeLayerVal, alpha);
  const toggleHeadAblation = (layer: number, head: number) => analysis.toggleHeadAblation(layer, head);
  const handleHeadAblation = () => analysis.runHeadAblation();
  const toggleFeatureAblation = (featureIndex: number, layer: number) =>
    analysis.toggleFeatureAblation(featureIndex, layer);
  const handleFeatureAblation = () => analysis.runFeatureAblation();
  const handlePatching = (cleanPrompt: string, corruptedPrompt: string, patchType: 'head' | 'mlp' | 'resid') =>
    analysis.patching(cleanPrompt, corruptedPrompt, patchType);
  const handleCircuit = (threshold?: number) => analysis.circuit('dla', threshold);
  // The word Key parts explains: the focused word, as in Why (DLA).
  const circuitTarget = $derived(
    st.response?.tokens.find((t) => t.index === st.focusTokenIndex) ?? null,
  );

  // What the JSON export and the lab notebook save for the current run.
  function currentRunData() {
    return {
      response: st.response,
      saeLayer: st.saeLayer,
      activePresetId,
      logitLensResponse: st.logitLensResponse,
      dlaResponse: st.dlaResponse,
      steerResponse: st.steerResponse,
      headAblateResponse: st.headAblateResponse,
      featureAblateResponse: st.featureAblateResponse,
      patchResponse: st.patchResponse,
      circuitResponse: st.circuitResponse,
    };
  }

  // What provenance needs beyond the run's own responses: app and engine versions.
  async function provenanceExtras(): Promise<ProvenanceExtras> {
    const [h, appVersion] = await Promise.all([
      health().catch(() => null),
      isTauri()
        ? import('@tauri-apps/api/app').then((m) => m.getVersion()).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { appVersion, health: h, snapshot: hasPryHost() ? prySnapshot() : undefined };
  }

  async function handleExportJSON() {
    const run = currentRunData();
    const [extras] = await Promise.all([provenanceExtras(), notebook.load()]);
    const data = {
      ...run,
      provenance: buildProvenance({ ...run, saeLayer: run.saeLayer ?? null }, extras),
      journal: notebook.state.journal,
      exportedAt: new Date().toISOString(),
    };
    saveJsonFile(JSON.stringify(data, null, 2)).catch((e) => {
      st.error = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
    });
  }

  const isRunDisabled = $derived(st.generating || st.layerSwitching || load.runBlocked);

  const runButtonTooltip = $derived(
    activePresetId === null
      ? 'No model loaded'
      : bannerVisible
        ? 'Model loading…'
        : '',
  );

  let retrying = $state(false);
  async function handleRetry() {
    if (st.generating || retrying) return;
    retrying = true;
    try {
      load.reset();
      st.error = null;
      await handleGenerate();
    } finally {
      retrying = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 6 — Custom model dialog
  // ---------------------------------------------------------------------------
  // Custom models (T32): the saved list is reloaded from disk at startup and
  // shown in Settings and the model switcher with the same verdicts as presets.
  let customModelDialogOpen = $state(false);
  let customModels = $state<CustomPreset[]>([]);
  let customCompat = $state<PresetCompatibility[]>([]);
  let customModelsError = $state<string | null>(null);
  // Presets plus custom models, for the switcher and name lookups.
  const allCompat = $derived(
    presets ? [...presets, ...customCompat] : customCompat.length > 0 ? customCompat : null,
  );
  // The loaded model has no feature dictionary (SAE).
  const noFeatures = $derived(isCustomPresetId(activePresetId));

  onMount(() => {
    if (!CUSTOM_MODELS_ENABLED) return;
    listCustomModels()
      .then((list) => { customModels = list; customModelsError = null; })
      .catch((e) => { customModelsError = e instanceof Error ? e.message : String(e); });
  });

  $effect(() => {
    const list = customModels;
    const hw = hardware;
    let cancelled = false;
    Promise.all(list.map((m) => customCompatibility(m, hw, evaluateCustomModel)))
      .then((rows) => { if (!cancelled) customCompat = rows; })
      .catch((e) => console.error('custom model verdicts failed:', e));
    return () => { cancelled = true; };
  });

  function handleCustomModelAdded(preset: CustomPreset) {
    customModels = [...customModels, preset];
  }

  async function handleCustomModelRemove(presetId: string) {
    const hfId = hfIdOf(presetId);
    try {
      await removeCustomModel(hfId);
      customModels = customModels.filter((m) => m.id !== hfId);
      customModelsError = null;
    } catch (e) {
      customModelsError = e instanceof Error ? e.message : String(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 7 — Hardware trading card modal
  // ---------------------------------------------------------------------------
  let tradingCardOpen = $state(false);

  // ---------------------------------------------------------------------------
  // Phase 2 — Settings drawer
  // ---------------------------------------------------------------------------
  let settingsOpen = $state(false);
  let settingsHasBeenOpened = $state(false);
  function openSettings() {
    settingsOpen = true;
    settingsHasBeenOpened = true;
  }

  // ---------------------------------------------------------------------------
  // Phase 2 — Driven tutorial (replaces TutorialModal)
  // ---------------------------------------------------------------------------
  let panelAAggregation = $state<import('$lib/attention-agg').Aggregation>('max');

  // ?demo=induction-heads (T20): open the attention panel on the copying-heads
  // view instead of the tour, and score the heads once the model has loaded.
  let headScoresDemoPending = $state(false);
  $effect(() => {
    if (!headScoresDemoPending) return;
    if (loadState === 'loaded') {
      headScoresDemoPending = false;
      untrack(() => analysis.showHeadScores());
    } else if (loadState === 'error') {
      // The panel falls back to its "Score the heads" retry button.
      headScoresDemoPending = false;
    }
  });

  onMount(() => {
    if (typeof localStorage === 'undefined') return;
    const seen = localStorage.getItem('pry:tutorial_seen') === 'true';
    const params = $page.url.searchParams;
    const demo = demoFromParams(params);
    if (demo === 'induction-heads') {
      st.headScoresMode = true;
      leftActiveTab = 'attention';
      activeTab = 'attention';
      headScoresDemoPending = true;
      return;
    }
    const forced = params.get('tutorial') === '1' || demo === 'tour';
    // §P-popups: the popup audit drives the tour itself.
    if ((!seen || forced) && !popupAuditRequested()) tutorialState.start();
  });

  // ---------------------------------------------------------------------------
  // §P-popups: areas popups must not cover, and the dev-only popup audit
  // ---------------------------------------------------------------------------
  function popupAuditRequested(): boolean {
    return POPUP_AUDIT && $page.url.searchParams.get('popupAudit') === '1';
  }

  onMount(() => {
    // The experiment guide registers itself (ExperimentGallery); the update
    // banner renders in the page flow, so it's tracked from here.
    const offBanner = occupied.registerSelector(OCCUPIED.updateBanner, '[data-testid="update-banner"]');
    if (popupAuditRequested()) {
      const params = $page.url.searchParams;
      void import('$lib/popup/audit').then(({ runPopupAudit }) =>
        runPopupAudit(
          {
            actions: tutorialActions,
            loadState: () => loadState,
            ensureModel: () => handleSwitch('gpt2-small'),
            startExperiment: async (id) => {
              const exp = experiments.find((e) => e.id === id);
              if (exp) await pickExperiment(exp);
            },
            closeExperiment: () => dismissGuide(),
            setCustomModelDialog: (open) => (customModelDialogOpen = open),
            lessons: auditLessons,
          },
          {
            guideTour: params.get('guideTour') === '1',
            skipTour: params.get('skipTour') === '1',
            lessons: params.get('lessons') === 'both' ? ['right', 'left'] : params.get('lessons') === 'right' ? ['right'] : params.get('lessons') === 'left' ? ['left'] : [],
          },
        ),
      );
    }
    return offBanner;
  });

  // Developer: auto-open devtools if the user opted in via the drawer toggle.
  let devtoolsAutoopen = $state(false);
  onMount(() => {
    if (typeof localStorage === 'undefined') return;
    devtoolsAutoopen = localStorage.getItem('pry:devtools_autoopen') === 'true';
    if (devtoolsAutoopen) {
      invoke('open_devtools').catch(() => {});
    }
  });

  function toggleDevtoolsAutoopen() {
    devtoolsAutoopen = !devtoolsAutoopen;
    try {
      localStorage.setItem('pry:devtools_autoopen', devtoolsAutoopen ? 'true' : 'false');
    } catch {}
  }

  function openDevtoolsNow() {
    invoke('open_devtools').catch(() => {});
  }

  // The guided tour's moves (see $lib/tutorial/tour-steps.ts).
  const tutorialActions: TutorialActions = {
    setPrompt: (t) => { prompt = t; },
    runGenerate: () => handleGenerate(),
    response: () => st.response,
    openLeftTab: (tab) => experimentActions.openLeftTab(tab),
    openRightTab: (tab) => experimentActions.openRightTab(tab),
    setFocusTokenIndex: (i) => { st.focusTokenIndex = i; },
    setPanelAAggregation: (agg) => { panelAAggregation = agg; },
    findTokenIndex: (pred) => st.response?.tokens.find(pred)?.index,
    switchSaeLayer: (layer) => handleLayerSwitch(layer),
    currentSaeLayer: () => st.saeLayer ?? null,
    showCopyingHeads: () => { void analysis.showHeadScores(); },
    hideCopyingHeads: () => analysis.hideHeadScores(),
    setHeadAblation: (on, heads) => {
      if (heads) st.headAblations = heads.map((h) => ({ ...h }));
      st.headAblationMode = on;
    },
    runHeadAblation: () => handleHeadAblation(),
    headAblationResult: () => st.headAblateResponse,
    runPatching: (clean, corrupted, patchType) => {
      patchingPreset = { clean, corrupted, patchType };
      return handlePatching(clean, corrupted, patchType);
    },
    patchingResult: () => st.patchResponse,
    setCompareMode: (on) => { compareMode = on; },
    setComparePrompts: (a, b) => { compare.state.promptA = a; compare.state.promptB = b; },
    runCompare: () => compare.run(),
    compareResult: () => compare.state,
    activePresetId: () => activePresetId,
    switchModel: (id) => handleSwitch(id),
    exit: () => {
      try { localStorage.setItem('pry:tutorial_seen', 'true'); } catch { /* unavailable */ }
      tutorialState.close();
    },
  };

  // Escape closes the hardware card (T29). Its backdrop closes on click too;
  // this is the keyboard way out.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && tradingCardOpen) tradingCardOpen = false;
  }

  // Put the cursor in the prompt box once, when the app first opens. This
  // replaces the `autofocus` attribute, which re-fired whenever the input
  // remounted (resizing between wide and narrow, leaving Compare) and pulled
  // focus away from wherever the user was.
  let promptFocusedOnce = false;
  function focusPromptOnce(node: HTMLInputElement) {
    if (promptFocusedOnce) return;
    promptFocusedOnce = true;
    queueMicrotask(() => node.focus());
  }

  // ---------------------------------------------------------------------------
  // Experiment cards (T22)
  // ---------------------------------------------------------------------------
  const experiments = loadExperiments();
  let experimentsOpen = $state(false);
  let activeExperiment = $state<Experiment | null>(null);
  let experimentBusy = $state(false);
  let patchingPreset = $state<{ clean: string; corrupted: string; patchType: PatchType } | null>(null);

  const experimentActions: ExperimentActions = {
    activePresetId: () => activePresetId,
    switchModel: (id) => handleSwitch(id),
    setPrompt: (t) => { prompt = t; },
    runGenerate: () => handleGenerate(),
    openLeftTab: (tab) => {
      if (!pryUi.workspaceSplit) activeTab = 'attention';
      onLeftTabChange(tab);
    },
    openRightTab: (tab) => {
      if (!pryUi.workspaceSplit) activeTab = 'features';
      rightActiveTab = tab;
    },
    setAggregation: (agg) => { panelAAggregation = agg; },
    presetPatching: (p) => { patchingPreset = { ...p }; },
    presetHeadAblations: (heads) => {
      st.headAblations = heads.map((h) => ({ ...h }));
      st.headAblationMode = true;
    },
    endTour: () => tutorialState.endForExperiment(),
  };

  // Lessons (plan T2b): the registry reaches the page only through this host.
  // `workspaceSplit` (pry-state) follows §P-layout's workspaceSplit; the two
  // tab-forcing calls above read it. The registry's reset is its own
  // (registry/pry-actions.ts): it never calls dismissGuide or endTour.
  $effect(() => {
    pryUi.workspaceSplit = workspaceSplit;
  });
  onMount(() =>
    bindPryHost({
      analysis,
      compare,
      getPrompt: () => prompt,
      setPrompt: (t) => { prompt = t; },
      getLeftTab: () => leftActiveTab,
      openLeftTab: (tab) => experimentActions.openLeftTab(tab as Parameters<ExperimentActions["openLeftTab"]>[0]),
      getRightTab: () => rightActiveTab,
      openRightTab: (tab) => experimentActions.openRightTab(tab as Parameters<ExperimentActions["openRightTab"]>[0]),
      getCompareMode: () => compareMode,
      setCompareMode: (on) => { compareMode = on; },
      getAggregation: () => panelAAggregation,
      setAggregation: (agg) => { panelAAggregation = agg; },
      setPatchingPreset: (p) => { patchingPreset = p ? { ...p } : null; },
      activePresetId: () => activePresetId,
      modelRevision: () => loadedRevision,
      switchModel: (id) => handleSwitch(id),
      openLink: async (url) => {
        try {
          const { open: shellOpen } = await import('@tauri-apps/plugin-shell');
          await shellOpen(url);
        } catch {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      },
    }),
  );

  /** Preset the last experiment couldn't load (the guide shows an error instead of its steps). */
  let failedPreset = $state<string | null>(null);

  function dismissGuide() {
    activeExperiment = null;
    failedPreset = null;
  }

  // "Back to normal" (see resetExperiment): the prompt is kept.
  const resetActions: ResetActions = {
    clearHeadAblations: () => {
      st.headAblations = [];
      st.headAblationMode = false;
    },
    hideHeadScores: () => analysis.hideHeadScores(),
    clearPatchingPreset: () => { patchingPreset = null; },
    dismissGuide,
  };

  async function pickExperiment(exp: Experiment) {
    if (experimentBusy) return;
    experimentsOpen = false;
    activeExperiment = exp;
    failedPreset = null;
    experimentBusy = true;
    try {
      const result = await applyExperiment(exp, experimentActions);
      if (!result.ok && activeExperiment === exp) failedPreset = result.preset;
    } finally {
      experimentBusy = false;
    }
  }

  // An experiment picked on the loading screen opens once the model is ready.
  // A failed load drops it: the error needs attention first.
  let queuedExperimentId = $state<string | null>(null);
  $effect(() => {
    const id = queuedExperimentId;
    if (!id) return;
    if (bannerPhase === 'error') {
      queuedExperimentId = null;
      return;
    }
    if (loadState !== 'loaded' || bannerPhase !== 'idle' || switchInFlight) return;
    queuedExperimentId = null;
    const exp = experiments.find((e) => e.id === id);
    if (exp) untrack(() => void pickExperiment(exp));
  });

  // ---------------------------------------------------------------------------
  // Lab notebook (T27)
  // ---------------------------------------------------------------------------
  const notebook = createNotebookStore();
  let notebookOpen = $state(false);
  let notebookSaving = $state(false);

  function openNotebook(saving: boolean) {
    notebookSaving = saving;
    notebookOpen = true;
  }

  async function saveRunToNotebook(title: string, note: string) {
    const { response, saeLayer, ...rest } = currentRunData();
    if (!response) return null;
    const provenance = await provenanceExtras();
    const exp = activeExperiment && activeExperiment.prompt === response.prompt ? activeExperiment : null;
    return notebook.add({
      title,
      note,
      modelName: displayName(response.preset_id, allCompat),
      display: presetDisplay,
      experiment: exp ? { id: exp.id, title: exp.title, citations: exp.found.citations } : null,
      run: { ...rest, response, saeLayer: saeLayer ?? null },
      provenance,
    });
  }

  // ---------------------------------------------------------------------------
  // Tabbed panels — used in both wide (split) and narrow modes
  // ---------------------------------------------------------------------------
  const leftTabs: TabDef[] = [
    { id: 'attention', label: 'Attention' },
    {
      id: 'logit-lens',
      label: 'Logit Lens',
      title: 'A rough read of what each layer would guess. Each row shows what the model would predict if it had to answer at that layer.',
    },
    {
      id: 'dla',
      label: 'Why (DLA)',
      title: "Which parts of the model pushed directly toward or against its guess. Help that goes through other parts isn't counted.",
    },
    {
      id: 'patching',
      label: 'Swap test',
      title: 'Run two prompts one word apart, then swap pieces of one run into the other to see which pieces carry the answer.',
    },
    {
      id: 'circuit',
      label: 'Key parts',
      anchor: 'tab-key-parts',
      title: 'The attention heads and layers that pushed this prediction the most, with direct value path lines between them.',
    },
  ];
  const rightTabs: TabDef[] = [
    { id: 'features', label: 'Features', title: "Patterns a separate network (an SAE) found in the model's numbers at each token, with labels an AI wrote from examples." },
    { id: 'predictions', label: 'Predictions', title: 'The probability the model gives each possible next token, highest first.' },
    { id: 'steering', label: 'Steering', title: "Turn a feature up or down and run again to see how the model's answer shifts." },
  ];
  let leftActiveTab = $state('attention');
  let rightActiveTab = $state('features');

  // Auto-fetch logit lens / DLA when switching to those tabs
  function onLeftTabChange(tabId: string) {
    leftActiveTab = tabId;
    if (tabId === 'logit-lens' && !st.logitLensResponse && !st.logitLensLoading && st.response) {
      handleLogitLens();
    } else if (tabId === 'dla' && !st.dlaResponse && !st.dlaLoading && st.response) {
      handleDLA();
    } else if (tabId === 'circuit' && !st.circuitResponse && !st.circuitLoading && st.response) {
      handleCircuit();
    }
  }

  // Narrow mode: flatten left + right into one tab strip
  let activeTab = $state<'attention' | 'features'>('attention');

  function onTabKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      activeTab = 'features';
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      activeTab = 'attention';
    }
  }

  // Narrow-mode left sub-tabs handler
  function onNarrowLeftTabChange(tabId: string) {
    if (tabId === 'circuit' && !st.circuitResponse && !st.circuitLoading && st.response) {
      handleCircuit();
    } else if (tabId === 'logit-lens' && !st.logitLensResponse && !st.logitLensLoading && st.response) {
      handleLogitLens();
    } else if (tabId === 'dla' && !st.dlaResponse && !st.dlaLoading && st.response) {
      handleDLA();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="flex h-screen flex-col overflow-hidden bg-zinc-950">
  <!-- Header bar — 44px -->
  <header class="flex h-11 flex-shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4">
    <PryLogo class="h-5 w-5 text-indigo-400 flex-shrink-0" />
    <span class="text-sm font-semibold text-zinc-100 flex-shrink-0">Pry</span>

    <ModelSwitcher
      compatibilities={allCompat}
      {activePresetId}
      disabled={load.switcherDisabled}
      onSwitch={handleSwitch}
    />
    <EngineStatusChip compatibilities={allCompat} refreshKey={healthKey} />

    {#if windowWide && !compareMode}
      <!-- Inline prompt input (Wireshark filter-bar style) -->
      <div class="flex flex-1 items-center gap-2 ml-3">
        <span class="text-xs text-zinc-500 mr-1">Prompt</span>
        <input
          type="text"
          bind:value={prompt}
          onkeydown={onPromptKeydown}
          data-tour="prompt-input"
          use:focusPromptOnce
          placeholder="e.g. The cat sat on the"
          class="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-1 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {#if promptEdited}
          <span role="status" class="flex-shrink-0 whitespace-nowrap text-xs text-amber-400">Prompt edited. Press Run to see the new results.</span>
        {/if}
        <button
          onclick={handleGenerate}
          disabled={isRunDisabled}
          title={runButtonTooltip}
          data-tour="run-button"
          class="flex-shrink-0 rounded bg-indigo-500 px-4 py-1 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if st.generating}
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
              Running
            </span>
          {:else}
            Run
          {/if}
        </button>
      </div>
    {/if}

    <div class="flex items-center gap-1 ml-auto flex-shrink-0">
      <button
        onclick={handleExportJSON}
        aria-label="Export JSON"
        data-tip="export-button"
        disabled={!st.response}
        class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Download class="h-4 w-4" />
      </button>
      <button
        onclick={() => openNotebook(true)}
        aria-label="Save to notebook"
        title="Save this run to your lab notebook"
        data-tour="notebook-button"
        disabled={!st.response}
        class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <BookmarkPlus class="h-4 w-4" />
      </button>
      <button
        onclick={() => openNotebook(false)}
        title="Your saved runs and notes"
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <BookOpen class="h-4 w-4" />
        Notebook
      </button>
      <!-- §P-layout: the Experiments button (re-purposed by T7b) gives its label's width to the
           Lessons toggle, so the header row and the prompt keep their 0.3.8 geometry (Step 0). -->
      <button
        onclick={() => (experimentsOpen = true)}
        title="Try a guided experiment"
        aria-label="Experiments"
        data-tip="experiments-button"
        class="flex w-7 items-center justify-center rounded-md py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <FlaskConical class="h-4 w-4" />
      </button>
      <button
        onclick={() => (lessonsOn ? closeLessons() : openLessons())}
        aria-pressed={lessonsOn}
        data-tour="lessons-toggle"
        title={lessonsOn ? lessonsCopy.toggleCloseTitle : lessonsCopy.toggleOpenTitle}
        class="flex w-[70.55px] items-center justify-center gap-1.5 rounded-md py-1 text-xs {lessonsOn
          ? 'bg-indigo-950/60 text-indigo-300 hover:bg-indigo-900/60'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
      >
        <GraduationCap class="h-4 w-4" />
        {lessonsCopy.toggle}
      </button>
      {#if widenVisible}
        <button onclick={widenWindow} title={lessonsCopy.widenTitle} data-testid="lessons-widen" class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
          <MoveHorizontal class="h-4 w-4" />
          {lessonsCopy.widen}
        </button>
      {/if}
      <button
        onclick={() => (compareMode = !compareMode)}
        aria-pressed={compareMode}
        data-tour="compare-button"
        title={compareMode ? 'Back to the single-prompt view' : 'Compare two prompts side by side'}
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs {compareMode
          ? 'bg-indigo-950/60 text-indigo-300 hover:bg-indigo-900/60'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
      >
        <GitCompareArrows class="h-4 w-4" />
        Compare
      </button>
      <TourMenu />
      <button onclick={openSettings} aria-label="Open settings" data-tour="settings-button"
        class="relative rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
        <Settings class="h-4 w-4" />
        {#if hardwareError && !settingsHasBeenOpened}
          <span class="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500"></span>
        {/if}
      </button>
    </div>
  </header>

  <!-- Narrow-mode prompt (below header) -->
  {#if !windowWide && !compareMode}
    <div class="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2">
      <div class="flex gap-2">
        <span class="text-xs text-zinc-500 mr-1 self-center">Prompt</span>
        <input
          type="text"
          bind:value={prompt}
          onkeydown={onPromptKeydown}
          data-tour="prompt-input"
          use:focusPromptOnce
          placeholder="e.g. The cat sat on the"
          class="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onclick={handleGenerate}
          disabled={isRunDisabled}
          title={runButtonTooltip}
          data-tour="run-button"
          class="flex-shrink-0 rounded bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {#if st.generating}Running{:else}Run{/if}
        </button>
      </div>
      {#if promptEdited}
        <p role="status" class="mt-1 text-xs text-amber-400">Prompt edited. Press Run to see the new results.</p>
      {/if}
    </div>
  {/if}

  <!-- §P-layout: everything below the prompt; with Lessons on it sits beside the sidebar. -->
  {#snippet mainColumn()}
  <!-- Load progress banner — spans full width below header.
       Note (critic): its sticky top-0 becomes inert inside this flex layout
       since the parent is overflow-hidden. The banner still renders correctly
       as a flex-shrink-0 child. -->
  <LoadProgressBanner
    visible={bannerVisible && !loadingScreenOn}
    phase={bannerPhase === 'idle' ? 'loading' : bannerPhase}
    presetId={bannerTargetPreset ?? activePresetId ? hfIdOf(bannerTargetPreset ?? activePresetId ?? '') : null}
    progress={loadProgress}
    errorMessage={bannerError}
    onRetry={() => handleSwitch(bannerTargetPreset ?? activePresetId ?? 'gpt2-small')}
    onDismiss={() => { bannerPhase = 'idle'; bannerError = null; bannerMessage = null; }}
  />
  {#if gateFor}
    {@const gate = gateFor}
    {@const gateName = displayName(gate.presetId, presets)}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Before {gateName}">
      <div class="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-xl">
        <h2 class="mb-3 text-base font-semibold text-zinc-100">Before {gateName}: two steps on Hugging Face</h2>
        <LicenseGateSteps
          name={gateName}
          missing={gate.missing}
          onAddToken={() => goto('/welcome/hf-token?next=app')}
        />
        <div class="mt-5 flex items-center justify-end gap-3">
          <button type="button" onclick={() => (gateFor = null)} class="text-sm text-zinc-400 hover:text-zinc-200">
            Not now
          </button>
          <button
            type="button"
            onclick={() => handleSwitch(gate.presetId, true)}
            class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {gate.missing ? "I've done it. Try again" : `Done both. Load ${gateName}`}
          </button>
        </div>
      </div>
    </div>
  {/if}
  <EngineCrashBanner onRestarted={handleEngineRestarted} />
  <RuntimeUpdatePrompt />
  <UpdateCard variant="banner" />

  <!-- Error card — full width, compact -->
  {#if st.error}
    <div class="flex-shrink-0 border-b border-red-800 bg-red-950/40 px-4 py-2 flex items-center justify-between gap-3">
      <div class="min-w-0 text-sm text-red-400">
        <p>{friendly?.message}</p>
        {#if friendly?.details && friendly.details !== friendly.message}
          <details class="mt-0.5 text-xs text-red-400/70">
            <summary class="cursor-pointer select-none">Details</summary>
            <pre class="mt-1 whitespace-pre-wrap break-words font-mono">{friendly.details}</pre>
          </details>
        {/if}
      </div>
      <button onclick={handleRetry} disabled={st.generating || retrying}
        class="shrink-0 rounded bg-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-800 disabled:opacity-50">
        Retry
      </button>
    </div>
  {/if}

  <!-- Shared token strip — below error/banner, above panels -->
  {#if st.response && !compareMode}
    <div class="flex flex-shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/50 px-4" data-tour="token-strip">
      <span class="flex-shrink-0 text-[11px] text-zinc-500">Words (tokens):</span>
      <div class="min-w-0 flex-1">
        <SharedTokenStrip
          tokens={st.response.tokens}
          focusTokenIndex={st.focusTokenIndex}
          onTokenFocus={(i) => (st.focusTokenIndex = i)}
        />
      </div>
    </div>
  {/if}

  <!-- Main workspace -->
  <div class="relative flex-1 overflow-hidden">
    {#if loadingScreenOn && loadTrack}
      <LoadingScreen
        track={loadTrack}
        modelName={displayName(loadTrack.presetId, allCompat)}
        {experiments}
        presetName={(id) => displayName(id, allCompat)}
        {queuedExperimentId}
        onQueueExperiment={(id) => (queuedExperimentId = id)}
      />
    {/if}
    {#if compareMode}
      <div class="h-full overflow-y-auto p-4">
        <ComparePanel {compare} runDisabled={isRunDisabled} runDisabledReason={runButtonTooltip} />
      </div>
    {:else if workspaceSplit}
      <!-- Split mode -->
      <ResizableSplit>
        {#snippet left()}
          <TabbedPanel tabs={leftTabs} bind:activeTab={leftActiveTab} onTabChange={onLeftTabChange} stripAnchor="left-tab-strip">
            {#snippet children(tab)}
              <div class="h-full overflow-y-auto p-4">
                {#if tab === 'attention'}
                  <PanelA
                    response={st.response}
                    focusTokenIndex={st.focusTokenIndex}
                    onTokenFocus={(i) => (st.focusTokenIndex = i)}
                    bind:aggregation={panelAAggregation}
                    showTokenStrip={false}
                    ablationMode={st.headAblationMode}
                    ablations={st.headAblations}
                    ablateResponse={st.headAblateResponse}
                    ablateLoading={st.headAblateLoading}
                    onToggleAblation={toggleHeadAblation}
                    onRunAblation={handleHeadAblation}
                    onToggleAblationMode={(v) => { st.headAblationMode = v; }}
                    headScoresMode={st.headScoresMode}
                    headScoresResponse={st.headScoresResponse}
                    headScoresLoading={st.headScoresLoading}
                    headScoresWaiting={headScoresDemoPending}
                    onShowHeadScores={() => analysis.showHeadScores()}
                    onHideHeadScores={() => analysis.hideHeadScores()}
                  />
                {:else if tab === 'logit-lens'}
                  <LogitLensPanel
                    response={st.logitLensResponse}
                    loading={st.logitLensLoading}
                  />
                {:else if tab === 'dla'}
                  <DLAPanel
                    response={st.dlaResponse}
                    loading={st.dlaLoading}
                  />
                {:else if tab === 'patching'}
                  <PatchingPanel
                    tokenize={(t) => analysis.tokenize(t)}
                    preset={patchingPreset}
                    response={st.patchResponse}
                    loading={st.patchLoading}
                    onRun={handlePatching}
                  />
                {:else if tab === 'circuit'}
                  <CircuitPanel
                    response={st.circuitResponse}
                    loading={st.circuitLoading}
                    onRun={handleCircuit}
                    targetLabel={circuitTarget}
                  />
                {/if}
              </div>
            {/snippet}
          </TabbedPanel>
        {/snippet}
        {#snippet right()}
          <TabbedPanel tabs={rightTabs} bind:activeTab={rightActiveTab} stripAnchor="right-tab-strip">
            {#snippet children(tab)}
              <div class="h-full overflow-y-auto p-4">
                {#if tab === 'features' && noFeatures}
                  <NoFeaturesNotice panel="Features" />
                {:else if tab === 'features'}
                  <PanelB
                    {presetDisplay}
                    response={st.response}
                    focusTokenIndex={st.focusTokenIndex}
                    onTokenFocus={(i) => (st.focusTokenIndex = i)}
                    showTokenStrip={false}
                    availableSaeLayers={st.availableSaeLayers}
                    currentSaeLayer={st.saeLayer}
                    onLayerChange={handleLayerSwitch}
                    layerSwitching={st.layerSwitching}
                    ablationMode={st.featureAblationMode}
                    featureAblations={st.featureAblations}
                    ablateResponse={st.featureAblateResponse}
                    ablateLoading={st.featureAblateLoading}
                    onToggleFeatureAblation={toggleFeatureAblation}
                    onRunFeatureAblation={handleFeatureAblation}
                    onToggleAblationMode={(v) => { st.featureAblationMode = v; }}
                  />
                {:else if tab === 'predictions'}
                  <PredictionsPanel
                    response={st.response}
                    showTokenStrip={false}
                  />
                {:else if tab === 'steering' && noFeatures}
                  <NoFeaturesNotice panel="Steering" />
                {:else if tab === 'steering'}
                  <SteeringPanel
                    response={st.response}
                    steerResponse={st.steerResponse}
                    loading={st.steerLoading}
                    focusTokenIndex={st.focusTokenIndex}
                    currentSaeLayer={st.saeLayer}
                    onSteer={handleSteer}
                    resetKey={st.steeringResetKey}
                  />
                {/if}
              </div>
            {/snippet}
          </TabbedPanel>
        {/snippet}
      </ResizableSplit>
    {:else}
      <!-- Tabbed mode (narrow) -->
      <div class="flex h-full flex-col">
        <!-- Tab strip -->
        <div role="tablist" tabindex="-1" aria-label="Analysis panels" onkeydown={onTabKey}
          class="flex-shrink-0 flex gap-6 border-b border-zinc-800 px-4">
          <button type="button" role="tab" aria-selected={activeTab === 'attention'}
            tabindex={activeTab === 'attention' ? 0 : -1}
            onclick={() => (activeTab = 'attention')}
            class="relative -mb-px border-b-2 px-1 py-2 text-sm transition-colors"
            class:border-indigo-400={activeTab === 'attention'}
            class:text-indigo-300={activeTab === 'attention'}
            class:border-transparent={activeTab !== 'attention'}
            class:text-zinc-500={activeTab !== 'attention'}>
            Attention
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'features'}
            tabindex={activeTab === 'features' ? 0 : -1}
            onclick={() => (activeTab = 'features')}
            data-tour="tab-features"
            class="relative -mb-px border-b-2 px-1 py-2 text-sm transition-colors"
            class:border-indigo-400={activeTab === 'features'}
            class:text-indigo-300={activeTab === 'features'}
            class:border-transparent={activeTab !== 'features'}
            class:text-zinc-500={activeTab !== 'features'}>
            Features
          </button>
        </div>
        <!-- Active panel -->
        <div class="flex-1 overflow-y-auto p-4">
          {#if activeTab === 'attention'}
            <!-- Nested left-side tabs for narrow mode -->
            <TabbedPanel tabs={leftTabs} bind:activeTab={leftActiveTab} onTabChange={onNarrowLeftTabChange} stripAnchor="left-tab-strip">
              {#snippet children(tab)}
                {#if tab === 'attention'}
                  <PanelA
                    response={st.response}
                    focusTokenIndex={st.focusTokenIndex}
                    onTokenFocus={(i) => (st.focusTokenIndex = i)}
                    bind:aggregation={panelAAggregation}
                    showTokenStrip={false}
                    ablationMode={st.headAblationMode}
                    ablations={st.headAblations}
                    ablateResponse={st.headAblateResponse}
                    ablateLoading={st.headAblateLoading}
                    onToggleAblation={toggleHeadAblation}
                    onRunAblation={handleHeadAblation}
                    onToggleAblationMode={(v) => { st.headAblationMode = v; }}
                    headScoresMode={st.headScoresMode}
                    headScoresResponse={st.headScoresResponse}
                    headScoresLoading={st.headScoresLoading}
                    headScoresWaiting={headScoresDemoPending}
                    onShowHeadScores={() => analysis.showHeadScores()}
                    onHideHeadScores={() => analysis.hideHeadScores()}
                  />
                {:else if tab === 'logit-lens'}
                  <LogitLensPanel
                    response={st.logitLensResponse}
                    loading={st.logitLensLoading}
                  />
                {:else if tab === 'dla'}
                  <DLAPanel
                    response={st.dlaResponse}
                    loading={st.dlaLoading}
                  />
                {:else if tab === 'patching'}
                  <PatchingPanel
                    tokenize={(t) => analysis.tokenize(t)}
                    preset={patchingPreset}
                    response={st.patchResponse}
                    loading={st.patchLoading}
                    onRun={handlePatching}
                  />
                {:else if tab === 'circuit'}
                  <CircuitPanel
                    response={st.circuitResponse}
                    loading={st.circuitLoading}
                    onRun={handleCircuit}
                    targetLabel={circuitTarget}
                  />
                {/if}
              {/snippet}
            </TabbedPanel>
          {:else}
            <!-- Nested right-side tabs for narrow mode -->
            <TabbedPanel tabs={rightTabs} bind:activeTab={rightActiveTab} stripAnchor="right-tab-strip">
              {#snippet children(tab)}
                {#if tab === 'features' && noFeatures}
                  <NoFeaturesNotice panel="Features" />
                {:else if tab === 'features'}
                  <PanelB
                    {presetDisplay}
                    response={st.response}
                    focusTokenIndex={st.focusTokenIndex}
                    onTokenFocus={(i) => (st.focusTokenIndex = i)}
                    showTokenStrip={false}
                    availableSaeLayers={st.availableSaeLayers}
                    currentSaeLayer={st.saeLayer}
                    onLayerChange={handleLayerSwitch}
                    layerSwitching={st.layerSwitching}
                    ablationMode={st.featureAblationMode}
                    featureAblations={st.featureAblations}
                    ablateResponse={st.featureAblateResponse}
                    ablateLoading={st.featureAblateLoading}
                    onToggleFeatureAblation={toggleFeatureAblation}
                    onRunFeatureAblation={handleFeatureAblation}
                    onToggleAblationMode={(v) => { st.featureAblationMode = v; }}
                  />
                {:else if tab === 'predictions'}
                  <PredictionsPanel
                    response={st.response}
                    showTokenStrip={false}
                  />
                {:else if tab === 'steering' && noFeatures}
                  <NoFeaturesNotice panel="Steering" />
                {:else if tab === 'steering'}
                  <SteeringPanel
                    response={st.response}
                    steerResponse={st.steerResponse}
                    loading={st.steerLoading}
                    focusTokenIndex={st.focusTokenIndex}
                    currentSaeLayer={st.saeLayer}
                    onSteer={handleSteer}
                    resetKey={st.steeringResetKey}
                  />
                {/if}
              {/snippet}
            </TabbedPanel>
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {/snippet}
  {#if lessonsOn && lessons}
    {@const app = lessons}
    {#snippet sidebar()}
      <LessonSidebar
        model={app.model}
        anchors={pryToolSet.anchors}
        views={pryToolSet.views}
        spine={pryToolSet.spine}
        captures={app.captures}
        runAction={app.runAction}
        highlight={pryUi.highlight}
        side={lessonSide}
        width={lessonLayout.sidebar}
        railed={lessonLayout.railed}
        picker={app.state.loaded ? app.pickerItems() : []}
        pending={app.state.pending.length}
        onPick={(id) => void app.openLesson(id)}
        onReview={() => (app.state.installOpen = true)}
        onAllLessons={() => app.closeLesson()}
        onResize={resizeLessons}
        onCollapse={() => setLessonCollapsed(true)}
        onExpand={() => setLessonCollapsed(false)}
        onClose={closeLessons}
      />
    {/snippet}
    <div class="flex min-h-0 flex-1" bind:this={lessonRowEl} data-lessons-row>
      {#if lessonSide === 'left'}{@render sidebar()}{/if}
      <div class="flex min-h-0 min-w-0 flex-1 flex-col" bind:this={lessonMainEl} data-lessons-main>
        {@render mainColumn()}
      </div>
      {#if lessonSide === 'right'}{@render sidebar()}{/if}
    </div>
  {:else}
    {@render mainColumn()}
  {/if}
  {#if lessons?.state.installOpen && lessons.state.pending[0]}
    {@const p = lessons.state.pending[0]}
    <InstallSheet
      title={p.entry.lesson?.title ?? p.entry.id}
      ask={p.ask}
      services={pryToolSet.services}
      onAllow={(approved) => void lessons?.answerInstall(p, approved)}
      onDeny={() => void lessons?.answerInstall(p, null)}
    />
  {/if}


  <!--
    z-index layering (phase 2):
      - settings drawer backdrop: z-30
      - settings drawer panel:    z-40
      - custom model dialog:      z-50
      - hardware trading card:    z-50
      - tutorial modal:           z-50
  -->

  <!-- Settings drawer: hardware, presets, custom models -->
  <SettingsDrawer open={settingsOpen} onClose={() => (settingsOpen = false)}>
    {#snippet lessonsSection()}
      <LessonsSettings
        side={lessonSide}
        onSide={setLessonSide}
        authorMode={lessons?.state.authorMode ?? false}
        onAuthorMode={(on) => void ensureLessons(false).then((a) => a.setAuthorMode(on))}
        pending={lessons?.state.pending.length ?? 0}
        onReview={() => { if (lessons) lessons.state.installOpen = true; }}
        userLessons={lessons?.userRows() ?? []}
        onAdd={isTauri() ? () => void ensureLessons(false).then((a) => a.addLesson()) : undefined}
        onOpenFolder={isTauri() ? () => void ensureLessons(false).then((a) => a.openFolder()) : undefined}
        onReload={() => void ensureLessons(false).then((a) => a.reload())}
        onGuide={() => void ensureLessons(false).then((a) => a.openGuide())}
        onCopyLinter={() => ensureLessons(false).then((a) => a.copyLinter())}
        onRevoke={(id) => void lessons?.revokeLesson(id)}
        onCheck={(id) => (lessons ? lessons.checkLesson(id) : Promise.resolve([]))}
        onRemove={(id) => void lessons?.removeLesson(id)}
      />
    {/snippet}
    <!-- Hardware probe -->
    {#if hardwareLoading && !hardware}
      <!-- Skeleton -->
      <div class="mb-6 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div class="mb-3 flex items-center gap-3">
          <div class="h-5 w-5 rounded bg-zinc-800"></div>
          <div class="h-4 w-48 rounded bg-zinc-800"></div>
        </div>
        <div class="mb-2 h-2 w-full rounded-full bg-zinc-800"></div>
        <div class="grid grid-cols-2 gap-2">
          <div class="h-3 rounded bg-zinc-800"></div>
          <div class="h-3 rounded bg-zinc-800"></div>
        </div>
      </div>
    {:else if hardwareError && !hardware}
      <div class="mb-6 rounded-md border border-red-800 bg-red-950/40 px-4 py-3">
        <p class="mb-2 text-sm text-red-400">{hardwareError}</p>
        <button
          onclick={runProbe}
          class="rounded bg-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-800"
        >Retry</button>
      </div>
    {:else if hardware}
      <HardwareCard report={hardware} />
      <div class="mt-2 mb-4 flex justify-end">
        <button
          onclick={() => (tradingCardOpen = true)}
          class="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        >
          Export hardware card
        </button>
      </div>
    {/if}

    <!-- Preset compatibility -->
    {#if presetsLoading && !presets}
      <div class="mb-6 animate-pulse space-y-2">
        {#each [1,2,3,4,5] as _}
          <div class="h-12 rounded-md border border-zinc-800 bg-zinc-900/70"></div>
        {/each}
      </div>
    {:else if presets}
      <PresetList compatibilities={presets} {activePresetId} disabled={load.switcherDisabled} onSwitch={handleSwitch} />
    {/if}
    {#if presetsError}
      <div class="mb-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 flex items-center justify-between gap-3">
        <p class="text-sm text-red-400">Presets unavailable: {presetsError}</p>
        <button
          onclick={() => { if (hardware) loadPresets(hardware); }}
          class="shrink-0 rounded bg-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-800"
        >Retry</button>
      </div>
    {/if}

    {#if CUSTOM_MODELS_ENABLED}
    <!-- Custom model button -->
    <div class="mb-6 flex justify-end">
      <button
        onclick={() => (customModelDialogOpen = true)}
        class="rounded-md border border-dashed border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-500 hover:border-indigo-600 hover:text-indigo-400"
      >
        + Add a model from Hugging Face
      </button>
    </div>

    <!-- Custom models (reloaded from disk at startup) -->
    {#if customCompat.length > 0}
      <PresetList
        title="Your models (no feature dictionary)"
        switchLabel="Load"
        compatibilities={customCompat}
        {activePresetId}
        disabled={load.switcherDisabled}
        onSwitch={handleSwitch}
        onRemove={handleCustomModelRemove}
      />
    {/if}
    {#if customModelsError}
      <p class="mb-4 text-xs text-red-400">Couldn't read your custom models: {customModelsError}</p>
    {/if}
    {/if}

    <UpdateSettings />

    <!-- Developer section -->
    <div class="mt-8 border-t border-zinc-800 pt-5">
      <p class="mb-3 text-[10px] font-medium uppercase tracking-widest text-zinc-500">Developer</p>

      <div class="mb-4 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm text-zinc-300">Open DevTools</p>
          <p class="text-xs text-zinc-500">Inspect the webview, console, network.</p>
        </div>
        <button
          onclick={openDevtoolsNow}
          class="shrink-0 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-indigo-600 hover:text-indigo-300"
        >Open</button>
      </div>

      <div class="mb-4 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm text-zinc-300">Auto-open DevTools on launch</p>
          <p class="text-xs text-zinc-500">Persisted in localStorage.</p>
        </div>
        <button
          onclick={toggleDevtoolsAutoopen}
          aria-pressed={devtoolsAutoopen}
          class="shrink-0 rounded-md border px-3 py-1.5 text-xs transition-colors {devtoolsAutoopen
            ? 'border-indigo-600 bg-indigo-950/40 text-indigo-300'
            : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
        >{devtoolsAutoopen ? 'On' : 'Off'}</button>
      </div>

    </div>

    <TourSettings onTourStarted={() => (settingsOpen = false)} />
  </SettingsDrawer>

  <!-- Driven tutorial -->
  <DrivenTutorial generating={st.generating} {loadState} {bannerVisible} saeLayerSwitching={st.layerSwitching} error={st.error} actions={tutorialActions} />

  <ExperimentGallery
    open={experimentsOpen}
    {experiments}
    active={activeExperiment}
    busy={experimentBusy}
    {failedPreset}
    presetLabel={(id) => displayName(id, presets)}
    onPick={pickExperiment}
    onClose={() => (experimentsOpen = false)}
    onDismissGuide={dismissGuide}
    onReset={() => resetExperiment(resetActions)}
  />

  <NotebookPanel
    open={notebookOpen}
    store={notebook}
    saving={notebookSaving}
    currentPrompt={st.response?.prompt ?? null}
    onSaveCurrent={saveRunToNotebook}
    onUsePrompt={(p) => { compareMode = false; prompt = p; }}
    onClose={() => (notebookOpen = false)}
  />

  <!-- First-time contextual tips (registry-driven) -->
  <FirstTimeTip />

  <!-- Custom model dialog (T32) -->
  {#if CUSTOM_MODELS_ENABLED}
    <CustomModelDialog
      open={customModelDialogOpen}
      {hardware}
      onClose={() => (customModelDialogOpen = false)}
      onAdded={handleCustomModelAdded}
    />
  {/if}

  <!-- Hardware trading card modal -->
  {#if tradingCardOpen && hardware}
    <!-- Backdrop: click outside closes; Escape closes via onWindowKeydown. -->
    <div
      role="presentation"
      class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10"
      onclick={(e) => { if (e.target === e.currentTarget) tradingCardOpen = false; }}
    >
      <div
        class="w-full max-w-4xl rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hardware-card-title"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 id="hardware-card-title" class="text-base font-semibold text-zinc-100">Hardware Card</h2>
          <button
            onclick={() => (tradingCardOpen = false)}
            class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
          >Close</button>
        </div>
        <HardwareTradingCard report={hardware} compatibilities={presets ?? []} />
      </div>
    </div>
  {/if}
</div>
