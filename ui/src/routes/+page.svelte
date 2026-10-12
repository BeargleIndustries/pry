<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { CircleHelp, Settings, Download, FlaskConical, GitCompareArrows, BookOpen, BookmarkPlus } from 'lucide-svelte';
  import PryLogo from '$lib/components/icons/PryLogo.svelte';
  import { health, loadPreset, unloadPreset, listModels } from '$lib/sidecar';
  import { withoutEngineMemory } from '$lib/hardware-adjust';
  import type { LoadProgress, PresetInfo } from '$lib/sidecar';
  import { createAnalysis } from '$lib/analysis.svelte';
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
  import { resetAllTips } from '$lib/tips/coordinate';
  import { invoke } from '@tauri-apps/api/core';
  import LoadProgressBanner from '$lib/components/LoadProgressBanner.svelte';
  import RuntimeUpdatePrompt from '$lib/components/RuntimeUpdatePrompt.svelte';
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
  import { loadExperiments, applyExperiment } from '$lib/experiments/experiments';
  import type { Experiment, ExperimentActions, PatchType } from '$lib/experiments/experiments';
  import { demoFromParams } from '$lib/head-scores';
  import { createCompare } from '$lib/compare.svelte';
  import ComparePanel from '$lib/components/ComparePanel.svelte';
  import NotebookPanel from '$lib/components/NotebookPanel.svelte';
  import { createNotebookStore } from '$lib/notebook.svelte';

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
  let pendingLoad = $state<Promise<void> | null>(null);
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

  let loadAbortController: AbortController | null = null;

  // Load/unload banner state
  let bannerPhase = $state<'idle' | 'unloading' | 'loading' | 'warning' | 'error'>('idle');
  let bannerMessage = $state<string | null>(null);
  let bannerError = $state<string | null>(null);
  let switchInFlight = $state(false);
  let bannerTargetPreset = $state<string | null>(null);
  const bannerVisible = $derived(bannerPhase !== 'idle');

  // ---------------------------------------------------------------------------
  // Responsive layout state
  // ---------------------------------------------------------------------------

  let isWide = $state(true); // >= 1280px → split mode

  $effect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    isWide = mq.matches;
    const handler = (e: MediaQueryListEvent) => { isWide = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

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

  async function ensureLoaded() {
    if (loadState === "loaded") return;
    if (pendingLoad) return pendingLoad;
    pendingLoad = (async () => {
      loadAbortController = new AbortController();
      try {
        loadState = "loading";
        loadProgress = null;
        st.error = null;
        await loadPreset(
          selectedPreset,
          (ev) => {
            loadProgress = ev;
            bannerMessage = ev.message;
          },
          loadAbortController.signal,
        );
        loadState = "loaded";
        if (activePresetId !== selectedPreset) {
          activePresetId = selectedPreset;
          try { localStorage.setItem('pry:active_preset', selectedPreset); } catch { /* ignore */ }
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        loadState = "error";
        st.error = e?.message ?? String(e);
        throw e;
      } finally {
        pendingLoad = null;
        loadAbortController = null;
      }
    })();
    return pendingLoad;
  }

  onDestroy(() => {
    loadAbortController?.abort();
    loadAbortController = null;
  });

  // ---------------------------------------------------------------------------
  // Auto-load persisted active preset
  // ---------------------------------------------------------------------------

  function autoLoadActivePreset() {
    (async () => {
      try {
        let stored: string | null = null;
        try {
          stored = localStorage.getItem('pry:active_preset')
            ?? localStorage.getItem('pry:onboarding_preset');
        } catch { /* localStorage may be unavailable */ }

        let sidecarActive: string | null = null;
        let sidecarLoaded: string[] = [];
        try {
          const models = await listModels();
          sidecarActive = models.active ?? null;
          sidecarLoaded = models.loaded ?? [];
          sidecarPresets = models.available ?? [];
          // Populate available SAE layers from the active or stored preset
          const targetId = sidecarActive ?? stored ?? null;
          if (targetId) {
            const presetInfo = (models.available as any[])?.find((p: any) => p.id === targetId);
            st.availableSaeLayers = presetInfo?.available_sae_layers ?? [];
          }
        } catch { /* sidecar may not be up yet; fall through */ }

        let target = sidecarActive ?? stored ?? null;
        // A remembered custom model that has since been removed: start on the
        // default model instead of quietly reloading it.
        if (target?.startsWith('custom:') && !sidecarLoaded.includes(target)) {
          const saved = await listCustomModels().catch(() => null);
          if (saved && !saved.some((m) => `custom:${m.id}` === target)) {
            try { localStorage.removeItem('pry:active_preset'); } catch { /* unavailable */ }
            target = 'gpt2-small';
          }
        }
        if (!target) return;
        activePresetId = target;

        if (sidecarLoaded.includes(target)) {
          loadState = "loaded";
          return;
        }

        // Fire-and-forget auto-load with banner updates
        bannerPhase = 'loading';
        bannerTargetPreset = target;
        bannerMessage = `Loading ${displayName(target, allCompat)}…`;
        bannerError = null;
        loadProgress = null;
        loadState = "loading";
        loadPreset(target, (ev) => {
          loadProgress = ev;
          bannerMessage = ev.message;
        })
          .then(() => {
            loadState = "loaded";
            bannerPhase = 'idle';
            bannerMessage = null;
            bannerError = null;
            bannerTargetPreset = null;
            try { localStorage.setItem('pry:active_preset', target); } catch { /* ignore */ }
          })
          .catch((err) => {
            loadState = "error";
            bannerPhase = 'error';
            bannerError = err instanceof Error ? err.message : String(err);
            openGateOnError(target, bannerError);
          });
      } catch {
        // swallow — auto-load is best-effort
      }
    })().catch(() => { /* unhandled-rejection guard */ });
  }

  onMount(autoLoadActivePreset);

  // The engine came back (crash restart, manual restart): its memory is empty,
  // so reload whatever was active.
  function handleEngineRestarted() {
    loadAbortController?.abort();
    loadAbortController = null;
    pendingLoad = null;
    loadState = 'idle';
    healthKey++;
    autoLoadActivePreset();
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

  async function handleSwitch(presetId: string, pastGate = false) {
    if (switchInFlight) return;
    if (presetId === activePresetId && loadState === 'loaded') return;
    if (!pastGate && isGated(presetId) && !gatePassed(presetId)) {
      gateFor = { presetId, missing: null };
      return;
    }
    gateFor = null;
    switchInFlight = true;
    bannerError = null;
    bannerTargetPreset = presetId;
    const previousActive = activePresetId;
    try {
      if (previousActive && previousActive !== presetId) {
        bannerPhase = 'unloading';
        bannerMessage = `Unloading ${displayName(previousActive, allCompat)}…`;
        loadProgress = null;
        await unloadPreset(previousActive);
      }
      bannerPhase = 'loading';
      bannerMessage = `Loading ${displayName(presetId, allCompat)}…`;
      loadProgress = null;
      loadState = 'loading';
      await loadPreset(presetId, (ev) => {
        loadProgress = ev;
        bannerMessage = ev.message;
      });
      activePresetId = presetId;
      loadState = 'loaded';
      // Clear ALL analysis state when switching models
      analysis.clearForModelSwitch();
      compare.clear();
      try {
        localStorage.setItem('pry:active_preset', presetId);
        if (isGated(presetId)) localStorage.setItem(gatePassedKey(presetId), '1');
      } catch { /* ignore */ }
      // Repopulate available layers for the new preset
      try {
        const models = await listModels();
        sidecarPresets = models.available ?? [];
        const presetInfo = models.available?.find((p: any) => p.id === presetId);
        st.availableSaeLayers = presetInfo?.available_sae_layers ?? [];
      } catch { /* best-effort */ }
      bannerPhase = 'idle';
      bannerMessage = null;
      bannerTargetPreset = null;
    } catch (err) {
      activePresetId = null;
      loadState = 'error';
      bannerPhase = 'error';
      bannerError = err instanceof Error ? err.message : String(err);
      openGateOnError(presetId, bannerError);
    } finally {
      switchInFlight = false;
    }
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

  async function handleExportJSON() {
    const data = { ...currentRunData(), exportedAt: new Date().toISOString() };
    saveJsonFile(JSON.stringify(data, null, 2)).catch((e) => {
      st.error = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
    });
  }

  const isRunDisabled = $derived(
    st.generating ||
    loadState === "loading" ||
    bannerPhase === 'unloading' ||
    bannerPhase === 'loading' ||
    switchInFlight ||
    activePresetId === null,
  );

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
      loadAbortController?.abort();
      loadAbortController = null;
      st.error = null;
      loadState = "idle";
      pendingLoad = null;
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
    if (!seen || forced) tutorialState.start();
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

  function resetOnboardingTips() {
    if (typeof localStorage === 'undefined') return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pry:tip_seen:')) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    resetAllTips();
  }

  const tutorialActions: TutorialActions = {
    setPrompt: (t) => {
      prompt = t;
    },
    runGenerate: async () => {
      await handleGenerate();
    },
    setActiveTab: (tab) => {
      // In split mode both panels are already visible — no-op
      if (!isWide) {
        activeTab = tab;
      }
    },
    setFocusTokenIndex: (i) => {
      st.focusTokenIndex = i;
    },
    setPanelAAggregation: (agg) => {
      panelAAggregation = agg;
    },
    findTokenIndex: (pred) => st.response?.tokens.find(pred)?.index,
    switchSaeLayer: async (layer: number) => {
      await handleLayerSwitch(layer);
    },
    setLeftTab: (tab) => { leftActiveTab = tab; },
    setRightTab: (tab) => { rightActiveTab = tab; },
    activePresetId: () => activePresetId,
    switchModel: (id: string) => handleSwitch(id),
    exit: () => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pry:tutorial_seen', 'true');
      }
      tutorialState.close();
    },
  };

  let tourMenuOpen = $state(false);

  function openTutorial() {
    tutorialState.start();
    tourMenuOpen = false;
  }

  function openAdvancedTutorial() {
    tutorialState.startAdvanced();
    tourMenuOpen = false;
  }

  // Escape closes the tour menu and the hardware card (T29). Their backdrops
  // close on click too; this is the keyboard way out.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (tradingCardOpen) tradingCardOpen = false;
    else if (tourMenuOpen) tourMenuOpen = false;
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
      if (!isWide) activeTab = 'attention';
      onLeftTabChange(tab);
    },
    openRightTab: (tab) => {
      if (!isWide) activeTab = 'features';
      rightActiveTab = tab;
    },
    setAggregation: (agg) => { panelAAggregation = agg; },
    presetPatching: (p) => { patchingPreset = { ...p }; },
    presetHeadAblations: (heads) => {
      st.headAblations = heads.map((h) => ({ ...h }));
      st.headAblationMode = true;
    },
  };

  async function pickExperiment(exp: Experiment) {
    if (experimentBusy) return;
    experimentsOpen = false;
    activeExperiment = exp;
    experimentBusy = true;
    try {
      await applyExperiment(exp, experimentActions);
    } finally {
      experimentBusy = false;
    }
  }

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

  function saveRunToNotebook(title: string, note: string) {
    const { response, saeLayer, ...rest } = currentRunData();
    if (!response) return Promise.resolve(null);
    const exp = activeExperiment && activeExperiment.prompt === response.prompt ? activeExperiment : null;
    return notebook.add({
      title,
      note,
      modelName: displayName(response.preset_id, allCompat),
      display: presetDisplay,
      experiment: exp ? { id: exp.id, title: exp.title, citations: exp.found.citations } : null,
      run: { ...rest, response, saeLayer: saeLayer ?? null },
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
      title: 'Watch the model change its mind layer by layer — each row shows what it would predict if forced to answer at that depth.',
    },
    {
      id: 'dla',
      label: 'Why (DLA)',
      title: 'Direct Logit Attribution — which parts of the model pushed toward or against the predicted word.',
    },
    {
      id: 'patching',
      label: 'Swap & Compare',
      title: 'Activation Patching — swap part of the model\'s internal state from one prompt into another to see what changes.',
    },
    {
      id: 'circuit',
      label: 'Key parts',
      title: 'The attention heads and layers that pushed this prediction the most, with direct value path lines between them.',
    },
  ];
  const rightTabs: TabDef[] = [
    { id: 'features', label: 'Features', title: 'Internal concepts the model activated for each word — what it "knew" while processing your prompt.' },
    { id: 'predictions', label: 'Predictions', title: "What the model thinks the next word should be, and how likely it thinks each guess is." },
    { id: 'steering', label: 'Steering', title: "Turn a feature up or down and re-run — see how the model's answer shifts." },
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
      disabled={switchInFlight}
      onSwitch={handleSwitch}
    />
    <EngineStatusChip compatibilities={allCompat} refreshKey={healthKey} />

    {#if isWide && !compareMode}
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
          <span role="status" class="flex-shrink-0 whitespace-nowrap text-xs text-amber-400">Prompt edited — press Run to analyze the new text</span>
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
      <button
        onclick={() => (experimentsOpen = true)}
        title="Try a guided experiment"
        data-tip="experiments-button"
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <FlaskConical class="h-4 w-4" />
        Experiments
      </button>
      <button
        onclick={() => (compareMode = !compareMode)}
        aria-pressed={compareMode}
        title={compareMode ? 'Back to the single-prompt view' : 'Compare two prompts side by side'}
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs {compareMode
          ? 'bg-indigo-950/60 text-indigo-300 hover:bg-indigo-900/60'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
      >
        <GitCompareArrows class="h-4 w-4" />
        Compare
      </button>
      <div class="relative">
        <button onclick={() => { tourMenuOpen = !tourMenuOpen; }} aria-label="Open tutorial" data-tour="header-help"
          aria-expanded={tourMenuOpen}
          class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
          <CircleHelp class="h-4 w-4" />
        </button>
        {#if tourMenuOpen}
          <!-- Click-outside catcher; Escape closes the menu via onWindowKeydown. -->
          <div role="presentation" class="fixed inset-0 z-40" onclick={() => { tourMenuOpen = false; }}></div>
          <div class="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
            <button
              type="button"
              onclick={openTutorial}
              class="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
            >Basic Tour</button>
            <button
              type="button"
              onclick={openAdvancedTutorial}
              class="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
            >Advanced Tour</button>
          </div>
        {/if}
      </div>
      <button onclick={openSettings} aria-label="Open settings"
        class="relative rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
        <Settings class="h-4 w-4" />
        {#if hardwareError && !settingsHasBeenOpened}
          <span class="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500"></span>
        {/if}
      </button>
    </div>
  </header>

  <!-- Narrow-mode prompt (below header) -->
  {#if !isWide && !compareMode}
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
        <p role="status" class="mt-1 text-xs text-amber-400">Prompt edited — press Run to analyze the new text</p>
      {/if}
    </div>
  {/if}

  <!-- Load progress banner — spans full width below header.
       Note (critic): its sticky top-0 becomes inert inside this flex layout
       since the parent is overflow-hidden. The banner still renders correctly
       as a flex-shrink-0 child. -->
  <LoadProgressBanner
    visible={bannerVisible}
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
    <div class="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/50 px-4">
      <SharedTokenStrip
        tokens={st.response.tokens}
        focusTokenIndex={st.focusTokenIndex}
        onTokenFocus={(i) => (st.focusTokenIndex = i)}
      />
    </div>
  {/if}

  <!-- Main workspace -->
  <div class="flex-1 overflow-hidden">
    {#if compareMode}
      <div class="h-full overflow-y-auto p-4">
        <ComparePanel {compare} runDisabled={isRunDisabled} runDisabledReason={runButtonTooltip} />
      </div>
    {:else if isWide}
      <!-- Split mode -->
      <ResizableSplit>
        {#snippet left()}
          <TabbedPanel tabs={leftTabs} bind:activeTab={leftActiveTab} onTabChange={onLeftTabChange}>
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
                  />
                {/if}
              </div>
            {/snippet}
          </TabbedPanel>
        {/snippet}
        {#snippet right()}
          <TabbedPanel tabs={rightTabs} bind:activeTab={rightActiveTab}>
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
            <TabbedPanel tabs={leftTabs} bind:activeTab={leftActiveTab} onTabChange={onNarrowLeftTabChange}>
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
                  />
                {/if}
              {/snippet}
            </TabbedPanel>
          {:else}
            <!-- Nested right-side tabs for narrow mode -->
            <TabbedPanel tabs={rightTabs} bind:activeTab={rightActiveTab}>
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
      <PresetList compatibilities={presets} {activePresetId} onSwitch={handleSwitch} />
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
        + Add a model from HuggingFace
      </button>
    </div>

    <!-- Custom models (reloaded from disk at startup) -->
    {#if customCompat.length > 0}
      <PresetList
        title="Your models (no feature dictionary)"
        switchLabel="Load"
        compatibilities={customCompat}
        {activePresetId}
        onSwitch={handleSwitch}
        onRemove={handleCustomModelRemove}
      />
    {/if}
    {#if customModelsError}
      <p class="mb-4 text-xs text-red-400">Couldn't read your custom models: {customModelsError}</p>
    {/if}
    {/if}

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

      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm text-zinc-300">Reset onboarding tips</p>
          <p class="text-xs text-zinc-500">Re-show first-time tooltips on next mount.</p>
        </div>
        <button
          onclick={resetOnboardingTips}
          class="shrink-0 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-indigo-600 hover:text-indigo-300"
        >Reset</button>
      </div>
    </div>
  </SettingsDrawer>

  <!-- Driven tutorial -->
  <DrivenTutorial generating={st.generating} response={st.response} {loadState} {bannerVisible} saeLayerSwitching={st.layerSwitching} error={st.error} actions={tutorialActions} />

  <ExperimentGallery
    open={experimentsOpen}
    {experiments}
    active={activeExperiment}
    busy={experimentBusy}
    presetLabel={(id) => displayName(id, presets)}
    onPick={pickExperiment}
    onClose={() => (experimentsOpen = false)}
    onDismissGuide={() => (activeExperiment = null)}
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
