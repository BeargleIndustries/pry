<script lang="ts">
  import { untrack } from 'svelte';
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import type { TourContext, TutorialActions } from '$lib/tutorial/actions';
  import { tourUi, targetLabels } from '$lib/tutorial/tour-steps';
  import Pointer from './Pointer.svelte';
  import { findAnchor } from '$lib/tutorial/anchors';
  import { asyncStepSucceeded, needsModelOffer, TOUR_PRESET_ID } from '$lib/tutorial/step-machine';
  import { MAX_ARROW, placePopup, type Placement, type Point } from '$lib/popup/place';
  import { focusPoint, placementAttrs, placementChanged, rectOf, viewportSize } from '$lib/popup/measure';
  import { occupied, OCCUPIED } from '$lib/popup/occupied.svelte';

  /** Narrower than this, the card docks as a bottom sheet (decision 4). */
  const SHEET_BELOW = 760;

  interface Props {
    generating: boolean;
    loadState: 'idle' | 'loading' | 'loaded' | 'error';
    actions: TutorialActions;
    bannerVisible?: boolean;
    saeLayerSwitching?: boolean;
    /** Analysis error (st.error), shown when a tour step's work fails. */
    error?: string | null;
  }

  let {
    generating,
    loadState,
    actions,
    bannerVisible = false,
    saeLayerSwitching = false,
    error = null,
  }: Props = $props();

  const ctx: TourContext = $derived({
    ...actions,
    setAttentionView: (view) => tutorialState.requestAttentionView(view),
  });

  let completing = $state(false);
  let chaptersOpen = $state(false);
  let cardEl: HTMLDivElement | null = $state(null);
  /** The element the current step points at, once it's on screen. */
  let pointedEl: HTMLElement | null = $state(null);
  /** True once the target has been missing for a moment (not just mounting). */
  let targetMissing = $state(false);

  const step = $derived(tutorialState.currentStep);
  const chapter = $derived(tutorialState.currentChapter);
  const chapters = $derived(tutorialState.chapterList);
  const isFinal = $derived(tutorialState.isFinal);
  const failed = $derived(tutorialState.machine.status === 'failed');

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- GPT-2 small pin: the tour copy is written for GPT-2 small ----
  let switchingModel = $state(false);
  let modelSwitchError = $state<string | null>(null);
  const activeModel = $derived(actions.activePresetId());
  const showModelOffer = $derived(
    tutorialState.open && needsModelOffer(activeModel, tutorialState.modelOfferDismissed),
  );

  async function switchToTourModel() {
    if (switchingModel) return;
    switchingModel = true;
    modelSwitchError = null;
    try {
      await actions.switchModel(TOUR_PRESET_ID);
    } catch (e) {
      console.warn('tutorial model switch error', e);
    }
    switchingModel = false;
    if (actions.activePresetId() !== TOUR_PRESET_ID) modelSwitchError = tourUi.modelOfferFailed;
  }

  function dismissModelOffer() {
    tutorialState.modelOfferDismissed = true;
    modelSwitchError = null;
  }

  // ---- Step setup: runs when a step appears (Next, Back, chapter jump) ----
  $effect(() => {
    if (!tutorialState.open) return;
    // Track only the position; the step's own reads must not re-run it.
    void tutorialState.chapterIndex;
    void tutorialState.stepIndex;
    untrack(() => {
      const s = tutorialState.currentStep;
      if (!s) return;
      try {
        ctx.setCompareMode(!!s.compare);
        s.enter?.(ctx);
      } catch (e) {
        console.warn('tour step setup error', e);
      }
    });
  });

  // ---- Highlight: find the step's anchor, re-find it if it re-renders ----
  // Anchors can appear late (a tab mounting, a result arriving), so this
  // checks a few times a second while the step is up.
  $effect(() => {
    if (!tutorialState.open) return;
    const target = step?.target ?? null;
    clearHighlights();
    pointedEl = null;
    targetMissing = false;
    if (!target) return;
    const missingTimer = setTimeout(() => (targetMissing = pointedEl === null), 1200);
    let el: HTMLElement | null = null;
    const find = () => {
      if (el?.isConnected && el.getClientRects().length > 0) return;
      el?.removeAttribute('data-tour-active');
      el = findAnchor(target);
      pointedEl = el;
      if (!el) return;
      targetMissing = false;
      el.setAttribute('data-tour-active', 'true');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };
    find();
    const timer = setInterval(find, 250);
    return () => {
      clearInterval(timer);
      clearTimeout(missingTimer);
      el?.removeAttribute('data-tour-active');
      pointedEl = null;
    };
  });

  // ---- Card placement (placePopup) ----
  // Beside the target, inside it for large panels, a bottom sheet in narrow
  // windows, bottom-right with no target. Measured every frame, but the card
  // only moves when the result changes: hysteresis keeps the side while it
  // still fits, so it re-places on step change, resize, a moving target, or
  // the current side no longer fitting.
  let placed = $state<Placement | null>(null);
  let placedFocus = $state<Point | null>(null);

  $effect(() => {
    if (!tutorialState.open) return;
    const s = step;
    if (!s) return;
    let prev: Placement | null = null; // hysteresis is per step
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!cardEl) return;
      const t = pointedEl ? rectOf(pointedEl) : null;
      const focus = t ? focusPoint(t, s.focus) : null;
      const next = placePopup({
        target: t,
        focus: focus ?? undefined,
        size: { w: cardEl.offsetWidth, h: cardEl.offsetHeight },
        viewport: viewportSize(),
        preferred: s.placement ?? 'bottom',
        previousSide: prev?.side,
        previousMode: prev?.mode,
        avoid: occupied.rects([OCCUPIED.tourCard]),
        sheetBelow: SHEET_BELOW,
      });
      prev = next;
      if (placementChanged(placed, next)) {
        placed = next;
        placedFocus = focus;
      }
    };
    // Started from a frame callback so the effect itself tracks only the step.
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  // The card is an occupied area for every other popup while it's up.
  $effect(() => {
    if (!cardEl) return;
    return occupied.registerElement(OCCUPIED.tourCard, cardEl);
  });

  /** Arrow shown for this placement: always for the sheet, else only when short (rule 6). */
  const showArrow = $derived(
    !!placed?.arrowFrom &&
      (placed.mode === 'sheet' || (!placed.arrowExempt && placed.arrowLen <= MAX_ARROW)),
  );

  function clearHighlights() {
    document
      .querySelectorAll<HTMLElement>('[data-tour-active="true"]')
      .forEach((el) => el.removeAttribute('data-tour-active'));
  }

  $effect(() => {
    if (tutorialState.open) return;
    clearHighlights();
    chaptersOpen = false;
  });

  // Escape closes the chapter menu first, then the tour.
  $effect(() => {
    if (!tutorialState.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (chaptersOpen) chaptersOpen = false;
      else handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- Async steps ----
  // The work is awaited (the page's actions resolve after the request settles
  // and don't throw), then success is read off the step's result: a new value
  // means it worked; anything else clears `running` and offers Try again / Skip.
  async function runAsyncStep() {
    const current = step;
    const run = current?.run;
    if (!run) return;
    const at = { c: tutorialState.chapterIndex, s: tutorialState.stepIndex };
    const before = run.result(ctx);
    try {
      await run.act(ctx);
    } catch (e) {
      console.warn('tour step error', e);
    }
    // The user closed the tour, skipped, or moved on while it ran.
    if (
      !tutorialState.open ||
      tutorialState.chapterIndex !== at.c ||
      tutorialState.stepIndex !== at.s ||
      !tutorialState.awaitingAsync
    )
      return;
    if (asyncStepSucceeded(before, run.result(ctx))) {
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

  const busy = $derived(tutorialState.awaitingAsync || failed || switchingModel || completing);

  async function handleNext() {
    if (!step || busy) return;
    if (isFinal) {
      completing = true;
      setTimeout(() => {
        completing = false;
        tutorialState.finish();
        actions.exit();
      }, 2500);
      return;
    }
    if (step.run && !step.run.skipIf?.(ctx)) {
      tutorialState.dispatch({ type: 'run' });
      await runAsyncStep();
      return;
    }
    tutorialState.next();
  }

  function handleBack() {
    if (tutorialState.awaitingAsync || switchingModel || completing) return;
    tutorialState.back();
  }

  function handleClose() {
    if (completing) {
      completing = false;
      tutorialState.finish();
    }
    actions.exit();
  }

  function jumpTo(index: number) {
    if (tutorialState.awaitingAsync || switchingModel || completing) return;
    chaptersOpen = false;
    tutorialState.goToChapter(index);
  }

  const nextLabel = $derived(
    isFinal ? tourUi.done : step?.run && !step.run.skipIf?.(ctx) ? step.run.label : tourUi.next,
  );

  const asyncHint = $derived.by(() => {
    if (bannerVisible) return null;
    if (!tutorialState.awaitingAsync) return null;
    if (loadState === 'loading') return tourUi.busy.loading;
    if (generating) return tourUi.busy.running;
    if (saeLayerSwitching) return tourUi.busy.layer;
    return tourUi.busy.working;
  });
</script>

{#if tutorialState.open && step && chapter}
  {#if pointedEl}
    <Pointer
      target={pointedEl}
      arrowFrom={showArrow ? placed?.arrowFrom : null}
      arrowTo={showArrow ? placed?.arrowTo : null}
      focusRing={placed?.mode === 'inset' && !placed.arrowExempt}
      z={49}
    />
  {/if}
  <div
    bind:this={cardEl}
    class="pry-tour-card fixed z-50 flex flex-col rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur {placed?.mode === 'sheet' ? 'max-h-[45vh]' : 'w-[400px] max-w-[calc(100vw-2rem)]'}"
    style:top="{placed?.top ?? 0}px"
    style:left="{placed?.left ?? 0}px"
    style:width={placed?.mode === 'sheet' ? `${placed.width}px` : null}
    style:visibility={placed ? 'visible' : 'hidden'}
    role="dialog"
    aria-label={tourUi.cardLabel}
    data-testid="tour-card"
    data-popup="tour"
    data-step-id={step.id}
    {...placementAttrs(placed, placedFocus)}
  >
    {#if placed?.caretEdge}
      <span
        class="pry-card-caret pry-card-caret-{placed.caretEdge}"
        style:--caret="{placed.caret}px"
        aria-hidden="true"
      ></span>
    {/if}
    <!-- Header -->
    <div class="flex flex-shrink-0 items-start justify-between gap-2 border-b border-zinc-800 px-4 py-2">
      <div class="min-w-0">
        <p class="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
          {tourUi.chapterOf(tutorialState.chapterIndex + 1, chapters.length)} · {tourUi.stepOf(tutorialState.stepIndex + 1, chapter.steps.length)}
        </p>
        <p class="truncate text-sm font-medium text-zinc-100">{chapter.title}</p>
      </div>
      <div class="flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          onclick={() => (chaptersOpen = !chaptersOpen)}
          aria-expanded={chaptersOpen}
          aria-controls="tour-chapter-list"
          disabled={tutorialState.awaitingAsync || switchingModel || completing}
          class="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {tourUi.chaptersButton}
        </button>
        <button
          type="button"
          onclick={handleClose}
          aria-label="{tourUi.exit} {tourUi.cardLabel.toLowerCase()}"
          class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    {#if chaptersOpen}
      <ol id="tour-chapter-list" class="max-h-72 overflow-y-auto border-b border-zinc-800 py-1" aria-label={tourUi.chaptersButton}>
        {#each chapters as c, i (c.id)}
          <li>
            <button
              type="button"
              onclick={() => jumpTo(i)}
              aria-current={i === tutorialState.chapterIndex ? 'step' : undefined}
              class="flex w-full items-start gap-2 px-4 py-1.5 text-left hover:bg-zinc-800 {i === tutorialState.chapterIndex ? 'bg-zinc-800/60' : ''}"
            >
              <span class="w-4 flex-shrink-0 pt-px text-right text-[11px] tabular-nums text-zinc-500">{i + 1}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs text-zinc-200">
                  {c.title}
                  {#if tutorialState.isCompleted(c.id)}
                    <span class="ml-1 text-emerald-400" aria-label={tourUi.menuDone}>✓</span>
                  {/if}
                </span>
                <span class="block text-[11px] leading-snug text-zinc-500">{c.summary}</span>
              </span>
            </button>
          </li>
        {/each}
      </ol>
    {/if}

    <!-- Body -->
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
      {#if completing}
        <p class="py-4 text-center text-sm text-indigo-300">{tourUi.complete}</p>
      {:else}
        {#if showModelOffer || switchingModel || modelSwitchError}
          <div class="mb-3 rounded border border-amber-900/60 bg-amber-950/30 px-2.5 py-2">
            {#if switchingModel}
              <p class="text-[11px] text-amber-200">{tourUi.modelLoading}</p>
            {:else}
              <p class="text-[11px] leading-relaxed text-amber-200">
                {modelSwitchError ?? tourUi.modelOffer(activeModel ?? '')}
              </p>
              <div class="mt-2 flex gap-2">
                <button
                  type="button"
                  onclick={switchToTourModel}
                  class="rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-amber-400"
                >
                  {modelSwitchError ? tourUi.retry : tourUi.switchModel}
                </button>
                <button
                  type="button"
                  onclick={dismissModelOffer}
                  class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  {tourUi.continueAnyway}
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if step.target}
          <p class="mb-1.5 text-[11px] text-indigo-300" data-testid="tour-look-at">
            <span class="font-semibold uppercase tracking-widest">{tourUi.lookAt}</span>
            {targetLabels[step.target] ?? step.target}{#if targetMissing}<span class="text-zinc-500"> · {tourUi.notOnScreen}</span>{/if}
          </p>
        {/if}
        <p class="text-sm leading-relaxed text-zinc-200">{step.blurb}</p>

        {#if step.why}
          <button
            type="button"
            onclick={() => (tutorialState.whyExpanded = !tutorialState.whyExpanded)}
            aria-expanded={tutorialState.whyExpanded}
            class="mt-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-indigo-400 hover:text-indigo-300"
          >
            <span aria-hidden="true">{tutorialState.whyExpanded ? '▼' : '▶'}</span>
            <span>{tourUi.why}</span>
          </button>
          {#if tutorialState.whyExpanded}
            <div class="mt-2 max-h-56 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-400">
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
                {tourUi.tryAgain}
              </button>
              <button
                type="button"
                onclick={handleSkipStep}
                class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                {tourUi.skip}
              </button>
            </div>
          </div>
        {/if}

        {#if asyncHint}
          <div class="mt-3 flex items-center gap-2 rounded border border-indigo-900/50 bg-indigo-950/30 px-2.5 py-1.5">
            <span class="inline-block h-3 w-3 rounded-full border-2 border-indigo-400 border-t-transparent motion-safe:animate-spin"></span>
            <span class="text-[11px] text-indigo-300">{asyncHint}</span>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    {#if !completing}
      <div class="flex flex-shrink-0 items-center justify-between gap-2 border-t border-zinc-800 px-4 py-2">
        <button type="button" onclick={handleClose} class="text-[11px] text-zinc-500 hover:text-zinc-300">
          {tourUi.exit}
        </button>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={handleBack}
            disabled={tutorialState.isFirst || tutorialState.awaitingAsync || switchingModel}
            class="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tourUi.back}
          </button>
          <button
            type="button"
            onclick={handleNext}
            disabled={busy}
            class="rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {nextLabel}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  @media (prefers-reduced-motion: no-preference) {
    .pry-tour-card {
      transition: top 150ms ease, left 150ms ease;
    }
  }
  /* Caret: a small rotated square on the card edge facing the target. */
  .pry-card-caret {
    position: absolute;
    width: 12px;
    height: 12px;
    background: rgb(24 24 27);
    border: 1px solid rgb(63 63 70); /* zinc-700 */
    transform: rotate(45deg);
    pointer-events: none;
  }
  .pry-card-caret-top { top: -7px; left: calc(var(--caret) - 6px); border-right: none; border-bottom: none; }
  .pry-card-caret-bottom { bottom: -7px; left: calc(var(--caret) - 6px); border-left: none; border-top: none; }
  .pry-card-caret-left { left: -7px; top: calc(var(--caret) - 6px); border-right: none; border-top: none; }
  .pry-card-caret-right { right: -7px; top: calc(var(--caret) - 6px); border-left: none; border-bottom: none; }
</style>
