<script lang="ts">
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import type { TutorialActions } from '$lib/tutorial/actions';
  import type { GenerateResponse } from '$lib/types';
  import { asyncStepSucceeded, needsModelOffer, TOUR_PRESET_ID } from '$lib/tutorial/step-machine';

  interface Props {
    generating: boolean;
    response: GenerateResponse | null;
    loadState: 'idle' | 'loading' | 'loaded' | 'error';
    actions: TutorialActions;
    bannerVisible?: boolean;
    saeLayerSwitching?: boolean;
    /** Analysis error (st.error), shown when a tutorial Run fails. */
    error?: string | null;
  }

  let {
    generating,
    response,
    loadState,
    actions,
    bannerVisible = false,
    saeLayerSwitching = false,
    error = null,
  }: Props = $props();

  let completing = $state(false);

  const step = $derived(tutorialState.currentStep);
  const stepNumber = $derived(tutorialState.stepIndex + 1);
  const totalSteps = $derived(tutorialState.totalSteps);
  const isFinal = $derived(tutorialState.stepIndex >= totalSteps - 1);
  const failed = $derived(tutorialState.machine.status === 'failed');

  // ---- GPT-2 small pin: the tour copy is written for GPT-2 small ----
  let switchingModel = $state(false);
  let modelSwitchError = $state<string | null>(null);
  const activeModel = $derived(actions.activePresetId?.() ?? null);
  const showModelOffer = $derived(
    tutorialState.open && needsModelOffer(activeModel, tutorialState.modelOfferDismissed),
  );

  async function switchToTourModel() {
    if (!actions.switchModel || switchingModel) return;
    switchingModel = true;
    modelSwitchError = null;
    try {
      await actions.switchModel(TOUR_PRESET_ID);
    } catch (e) {
      console.warn('tutorial model switch error', e);
    }
    switchingModel = false;
    if (actions.activePresetId?.() !== TOUR_PRESET_ID) {
      modelSwitchError = "Couldn't load GPT-2 small. You can retry, or continue on the current model.";
    }
  }

  function dismissModelOffer() {
    tutorialState.modelOfferDismissed = true;
    modelSwitchError = null;
  }

  // ---- Async steps (Run / layer switch) ----
  // The action is awaited to completion (generate and layer switch both
  // resolve after the request settles and never throw), then success is read
  // off the response: a new response means it worked; anything else is a
  // failure that clears `running` and offers Try again / Skip.
  async function runAsyncStep() {
    const current = step;
    if (!current) return;
    const indexAtStart = tutorialState.stepIndex;
    const before = response;
    try {
      await current.action(actions);
    } catch (e) {
      console.warn('tutorial async action error', e);
    }
    // The user closed the tour, skipped, or moved on while it ran.
    if (!tutorialState.open || tutorialState.stepIndex !== indexAtStart || !tutorialState.awaitingAsync) return;
    if (asyncStepSucceeded(before, response)) {
      tutorialState.dispatch({ type: 'succeeded' });
      tutorialState.next();
    } else {
      tutorialState.dispatch({ type: 'failed', error });
    }
  }

  async function handleRetry() {
    if (!failed) return;
    tutorialState.dispatch({ type: 'retry' });
    await runAsyncStep();
  }

  function handleSkipStep() {
    tutorialState.dispatch({ type: 'skip' });
    tutorialState.next();
  }

  // Highlight effect — data-tour-active attribute toggle, survives Svelte
  // reconciliation because data-* attrs aren't part of component class tracking.
  $effect(() => {
    if (!tutorialState.open) return;
    const target = step?.target ?? null;
    // Clear any stale highlights first
    document
      .querySelectorAll<HTMLElement>('[data-tour-active="true"]')
      .forEach((el) => el.removeAttribute('data-tour-active'));
    if (!target) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (el) el.setAttribute('data-tour-active', 'true');
    return () => {
      if (el) el.removeAttribute('data-tour-active');
    };
  });

  // Clear highlights on close/unmount
  $effect(() => {
    if (tutorialState.open) return;
    document
      .querySelectorAll<HTMLElement>('[data-tour-active="true"]')
      .forEach((el) => el.removeAttribute('data-tour-active'));
  });

  // Escape to close
  $effect(() => {
    if (!tutorialState.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function handleNext() {
    if (!step || tutorialState.awaitingAsync || failed || switchingModel || completing) return;
    if (isFinal) {
      // Run final action (which calls exit()) then show toast briefly
      completing = true;
      try {
        await step.action(actions);
      } catch (e) {
        console.warn('tutorial final step error', e);
      }
      setTimeout(() => {
        completing = false;
        tutorialState.close();
      }, 3000);
      return;
    }
    if (step.awaitGenerate || step.awaitLayerSwitch) {
      tutorialState.dispatch({ type: 'run' });
      await runAsyncStep();
      return;
    }
    try {
      await step.action(actions);
    } catch (e) {
      console.warn('tutorial action error', e);
    }
    tutorialState.next();
  }

  function handleBack() {
    if (tutorialState.awaitingAsync || switchingModel) return;
    tutorialState.back();
  }

  function handleClose() {
    actions.exit();
    completing = false;
  }

  function toggleWhy() {
    tutorialState.whyExpanded = !tutorialState.whyExpanded;
  }

  const asyncHint = $derived.by(() => {
    if (bannerVisible) return null;
    if (!tutorialState.awaitingAsync) return null;
    if (loadState === 'loading') return 'Loading model…';
    if (generating) return 'Running…';
    if (saeLayerSwitching) return 'Switching layer…';
    return 'Working…';
  });
</script>

{#if tutorialState.open && step}
  <div
    class="fixed bottom-4 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur"
    role="dialog"
    aria-label="Tutorial"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
      <div class="flex items-baseline gap-2">
        <span class="text-xs font-semibold uppercase tracking-widest text-indigo-400">Tutorial</span>
        <span class="text-[10px] text-zinc-500">Step {stepNumber} of {totalSteps}</span>
      </div>
      <button
        type="button"
        onclick={handleClose}
        aria-label="Close tutorial"
        class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 1l12 12M13 1L1 13" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <!-- Body -->
    <div class="px-4 py-3">
      {#if completing}
        <p class="py-4 text-center text-sm text-indigo-300">
          Tutorial complete — click ? to relaunch
        </p>
      {:else}
        {#if showModelOffer || switchingModel || modelSwitchError}
          <div class="mb-3 rounded border border-amber-900/60 bg-amber-950/30 px-2.5 py-2">
            {#if switchingModel}
              <p class="text-[11px] text-amber-200">Loading GPT-2 small…</p>
            {:else}
              <p class="text-[11px] leading-relaxed text-amber-200">
                {modelSwitchError ??
                  `This tour is written for GPT-2 small, and you have ${activeModel} loaded. The steps will still run, but the numbers and examples won't match.`}
              </p>
              <div class="mt-2 flex gap-2">
                {#if actions.switchModel}
                  <button
                    type="button"
                    onclick={switchToTourModel}
                    class="rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-400"
                  >
                    {modelSwitchError ? 'Retry' : 'Switch to GPT-2 small'}
                  </button>
                {/if}
                <button
                  type="button"
                  onclick={dismissModelOffer}
                  class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  Continue anyway
                </button>
              </div>
            {/if}
          </div>
        {/if}

        <p class="text-sm leading-relaxed text-zinc-200">{step.blurb}</p>

        {#if step.why}
          <button
            type="button"
            onclick={toggleWhy}
            class="mt-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-indigo-400 hover:text-indigo-300"
          >
            <span>{tutorialState.whyExpanded ? '▼' : '▶'}</span>
            <span>Why should I care?</span>
          </button>
          {#if tutorialState.whyExpanded}
            <div class="mt-2 rounded border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-400">
              {step.why}
            </div>
          {/if}
        {/if}

        {#if failed}
          <div class="mt-3 rounded border border-red-900/60 bg-red-950/30 px-2.5 py-2" role="alert">
            <p class="text-[11px] leading-relaxed text-red-300">{tutorialState.machine.error}</p>
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                onclick={handleRetry}
                class="rounded bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-400"
              >
                Try again
              </button>
              <button
                type="button"
                onclick={handleSkipStep}
                class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Skip
              </button>
            </div>
          </div>
        {/if}

        {#if asyncHint}
          <div class="mt-3 flex items-center gap-2 rounded border border-indigo-900/50 bg-indigo-950/30 px-2.5 py-1.5">
            <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"></span>
            <span class="text-[11px] text-indigo-300">{asyncHint}</span>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    {#if !completing}
      <div class="flex items-center justify-between gap-2 border-t border-zinc-800 px-4 py-2">
        <button
          type="button"
          onclick={handleClose}
          class="text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          Skip
        </button>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={handleBack}
            disabled={tutorialState.stepIndex === 0 || tutorialState.awaitingAsync || switchingModel}
            class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onclick={handleNext}
            disabled={tutorialState.awaitingAsync || failed || switchingModel}
            class="rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFinal ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
