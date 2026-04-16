<script lang="ts">
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import type { TutorialActions } from '$lib/tutorial/actions';
  import type { GenerateResponse } from '$lib/types';

  interface Props {
    generating: boolean;
    response: GenerateResponse | null;
    loadState: 'idle' | 'loading' | 'loaded' | 'error';
    actions: TutorialActions;
    bannerVisible?: boolean;
    saeLayerSwitching?: boolean;
  }

  let {
    generating,
    response,
    loadState,
    actions,
    bannerVisible = false,
    saeLayerSwitching = false,
  }: Props = $props();

  let completing = $state(false);

  const step = $derived(tutorialState.currentStep);
  const stepNumber = $derived(tutorialState.stepIndex + 1);
  const totalSteps = $derived(tutorialState.totalSteps);
  const isFinal = $derived(tutorialState.stepIndex >= totalSteps - 1);

  // Advance after async generate completes
  $effect(() => {
    if (tutorialState.awaitingAsync && !generating && response !== null && !step?.awaitLayerSwitch) {
      tutorialState.awaitingAsync = false;
      tutorialState.next();
    }
  });

  // Advance after layer switch completes
  $effect(() => {
    if (tutorialState.awaitingAsync && step?.awaitLayerSwitch && !saeLayerSwitching) {
      tutorialState.awaitingAsync = false;
      tutorialState.next();
    }
  });

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
    if (!step || tutorialState.awaitingAsync || completing) return;
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
      tutorialState.awaitingAsync = true;
      try {
        await step.action(actions);
      } catch (e) {
        console.warn('tutorial async action error', e);
        tutorialState.awaitingAsync = false;
      }
      // advancement happens in the $effect once generate/layer-switch settles
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
    if (tutorialState.awaitingAsync) return;
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
            disabled={tutorialState.stepIndex === 0 || tutorialState.awaitingAsync}
            class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onclick={handleNext}
            disabled={tutorialState.awaitingAsync}
            class="rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFinal ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
