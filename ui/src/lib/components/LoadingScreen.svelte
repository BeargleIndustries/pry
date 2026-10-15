<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import UpdateCard from './UpdateCard.svelte';
  import { fly } from 'svelte/transition';
  import {
    BookOpen,
    Check,
    ChevronLeft,
    ChevronRight,
    GraduationCap,
    Lightbulb,
    Pause,
    Play,
  } from 'lucide-svelte';
  import {
    formatElapsed,
    formatEta,
    stageLabel,
    stageNote,
    stageSteps,
    viewAt,
    type LoadTrack,
  } from '$lib/load-progress';
  import {
    buildDeck,
    deckReducer,
    markSeen,
    readRecent,
    shouldAutoAdvance,
    type DeckCard,
    type DeckState,
  } from '$lib/loading-deck';
  import { tipsRegistry } from '$lib/tips/tips-registry';
  import { glossary } from '$lib/glossary';
  import { deckLessons } from '$lib/lessons/deck-lessons';

  interface Props {
    track: LoadTrack;
    /** Display name of the model being loaded. */
    modelName: string;
    /** Display name for any preset id (for "runs on GPT-2 small"). */
    presetName: (id: string) => string;
    /** The lesson that opens once the model is ready (plan T7b: the queue opens a lesson). */
    queuedLessonId: string | null;
    onQueueLesson: (id: string | null) => void;
  }

  let { track, modelName, presetName, queuedLessonId, onQueueLesson }: Props = $props();

  // ---------------------------------------------------------------------------
  // Clock + honest, monotonic progress
  // ---------------------------------------------------------------------------

  let now = $state(Date.now());
  let reducedMotion = $state(false);

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
    mq.addEventListener('change', onChange);
    const id = setInterval(() => (now = Date.now()), 200);
    return () => {
      clearInterval(id);
      mq.removeEventListener('change', onChange);
    };
  });

  const view = $derived(viewAt(track, now));

  // The bar only ever moves forward for a given load.
  let shown = $state(0);
  let shownFor = -1;
  $effect(() => {
    const f = view.fraction;
    const startedAt = track.startedAt;
    untrack(() => {
      if (shownFor !== startedAt) {
        shownFor = startedAt;
        shown = f;
      } else if (f > shown) {
        shown = f;
      }
    });
  });

  const pct = $derived(Math.floor(shown * 100));
  const stageText = $derived(
    track.message?.trim() || (track.current ? `${stageLabel(track.current)}…` : 'Getting ready…'),
  );
  const steps = $derived(stageSteps(track));
  const note = $derived(stageNote(track, view));
  const etaText = $derived(formatEta(view.etaSeconds));
  const etaLine = $derived(
    etaText ??
      (view.overEstimate
        ? 'Slower than last time'
        : view.hasHistory
          ? ''
          : 'No estimate yet. Pry is timing this load for next time'),
  );

  // Screen readers hear stage changes, not every heartbeat: at most one
  // announcement every few seconds, always ending on the latest stage.
  const ANNOUNCE_GAP_MS = 3000;
  let announced = $state('');
  let lastAnnounceAt = 0;
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const text = track.current ? stageLabel(track.current) : '';
    untrack(() => {
      if (!text || text === announced) return;
      const wait = lastAnnounceAt + ANNOUNCE_GAP_MS - Date.now();
      if (announceTimer) clearTimeout(announceTimer);
      const say = () => {
        announced = text;
        lastAnnounceAt = Date.now();
        announceTimer = null;
      };
      if (wait <= 0) say();
      else announceTimer = setTimeout(say, wait);
    });
  });
  $effect(() => () => {
    if (announceTimer) clearTimeout(announceTimer);
  });

  // ---------------------------------------------------------------------------
  // The stack visual
  // ---------------------------------------------------------------------------

  const LAYERS = 8;
  const SLAB_H = 28;
  const SLAB_GAP = 10;
  const SLAB_TOP = 64;
  const STREAM_BOTTOM = 380;
  const STREAM_TOP = 48;
  const HEADS = 5;
  const TOKENS = ['Pry', 'open', 'the', 'black', 'box'];

  const slabs = Array.from({ length: LAYERS }, (_, i) => ({
    i,
    y: SLAB_TOP + (LAYERS - 1 - i) * (SLAB_H + SLAB_GAP),
    heads: Array.from({ length: HEADS }, (_, k) => ({
      cx: 44 + k * 15,
      // Scattered, repeatable timings so heads don't blink in unison.
      delay: (((i * 7 + k * 13) % 11) * 0.29).toFixed(2),
      dur: (2.2 + ((i + k * 3) % 5) * 0.35).toFixed(2),
    })),
  }));

  // Token chips along the bottom, centred under the stream.
  const CHAR_W = 6.6;
  const tokenChips = (() => {
    const widths = TOKENS.map((t) => t.length * CHAR_W + 12);
    const gap = 5;
    const total = widths.reduce((a, b) => a + b, 0) + gap * (TOKENS.length - 1);
    let x = 120 - total / 2;
    return TOKENS.map((t, n) => {
      const chip = { text: t, x, w: widths[n], delay: (n * 0.35).toFixed(2) };
      x += widths[n] + gap;
      return chip;
    });
  })();

  /** 0..1 how "awake" layer i is: layers light from the bottom as loading progresses. */
  function litFor(i: number, f: number): number {
    return Math.max(0, Math.min(1, f * LAYERS - i));
  }
  const litTopY = $derived(STREAM_BOTTOM - (STREAM_BOTTOM - STREAM_TOP) * shown);

  // ---------------------------------------------------------------------------
  // Card deck
  // ---------------------------------------------------------------------------

  // Built once per screen: the deck shouldn't reshuffle under the reader.
  const deck: DeckCard[] = untrack(() =>
    buildDeck({
      tips: tipsRegistry,
      lessons: deckLessons(),
      glossary,
      presetId: track.presetId,
      recent: readRecent(),
    }),
  );
  let deckState = $state<DeckState>({ index: 0, size: deck.length, shownAt: Date.now() });
  let dir = $state(1);
  let hovering = $state(false);
  let focusInside = $state(false);
  let userPaused = $state(false);
  const paused = $derived(hovering || focusInside || userPaused);
  const card = $derived(deck[deckState.index] ?? null);

  $effect(() => {
    const id = card?.id;
    if (id) untrack(() => markSeen(id));
  });

  // Auto-advance on the shared clock. Hover or focus holds the card; when the
  // pause lifts, the card gets a fresh full interval.
  let wasPaused = false;
  $effect(() => {
    const t = now;
    const p = paused;
    untrack(() => {
      if (p) {
        wasPaused = true;
        return;
      }
      if (wasPaused) {
        wasPaused = false;
        deckState = { ...deckState, shownAt: t };
        return;
      }
      if (shouldAutoAdvance(deckState, t, false)) {
        dir = 1;
        deckState = deckReducer(deckState, { type: 'next', now: t });
      }
    });
  });

  function go(step: 1 | -1) {
    dir = step;
    deckState = deckReducer(deckState, { type: step === 1 ? 'next' : 'prev', now: Date.now() });
  }
  function goTo(i: number) {
    dir = i > deckState.index ? 1 : -1;
    deckState = deckReducer(deckState, { type: 'goto', index: i, now: Date.now() });
  }
  function onDeckKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    }
  }
  // Hover, focus and arrow keys anywhere in the deck. Wired as an action so
  // the region itself stays a plain landmark, not a fake control.
  function deckEvents(node: HTMLElement) {
    const enter = () => (hovering = true);
    const leave = () => (hovering = false);
    const focusIn = () => (focusInside = true);
    const focusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !node.contains(next)) focusInside = false;
    };
    node.addEventListener('mouseenter', enter);
    node.addEventListener('mouseleave', leave);
    node.addEventListener('focusin', focusIn);
    node.addEventListener('focusout', focusOut);
    node.addEventListener('keydown', onDeckKeydown);
    return {
      destroy() {
        node.removeEventListener('mouseenter', enter);
        node.removeEventListener('mouseleave', leave);
        node.removeEventListener('focusin', focusIn);
        node.removeEventListener('focusout', focusOut);
        node.removeEventListener('keydown', onDeckKeydown);
      },
    };
  }

  const KIND_LABEL: Record<DeckCard['kind'], string> = {
    tip: 'Tip',
    lesson: 'A lesson for when it’s ready',
    term: 'Word of the moment',
  };
</script>

<section
  class="loading-screen absolute inset-0 z-10 overflow-y-auto bg-zinc-950"
  aria-labelledby="loading-title"
  data-testid="loading-screen"
>
  <div class="mx-auto grid min-h-full max-w-5xl content-center gap-8 px-6 py-8 sm:grid-cols-[minmax(190px,280px)_1fr] sm:gap-12 lg:px-10">
    <!-- The stack: words in at the bottom, layers wake up as loading progresses -->
    <figure class="mx-auto w-full max-w-[150px] sm:max-w-none">
      <svg
        viewBox="0 0 240 420"
        class="stack h-auto w-full"
        class:still={reducedMotion}
        role="img"
        aria-label="A stack of {LAYERS} layers lighting up from the bottom as the model loads"
      >
        <defs>
          <linearGradient id="ls-stream" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#6366f1" />
            <stop offset="1" stop-color="#a5b4fc" />
          </linearGradient>
          <radialGradient id="ls-pulse">
            <stop offset="0" stop-color="#e0e7ff" />
            <stop offset="0.45" stop-color="#a5b4fc" stop-opacity="0.7" />
            <stop offset="1" stop-color="#6366f1" stop-opacity="0" />
          </radialGradient>
        </defs>

        <!-- output: the guess that comes out of the top once it's running -->
        <g class="output" style="opacity: {0.25 + 0.75 * shown}">
          <rect x="98" y="12" width="44" height="22" rx="6" class="out-chip" />
          <text x="120" y="27.5" text-anchor="middle" class="mono out-text">?</text>
        </g>

        <!-- residual stream (dim track, then the lit part) -->
        <line x1="120" y1={STREAM_BOTTOM} x2="120" y2={STREAM_TOP} class="stream-track" />

        {#each slabs as s (s.i)}
          {@const lit = litFor(s.i, shown)}
          <g class="slab">
            <rect x="28" y={s.y} width="184" height={SLAB_H} rx="7" class="slab-base" />
            <rect x="28" y={s.y} width="184" height={SLAB_H} rx="7" class="slab-lit" style="opacity: {lit}" />
            {#each s.heads as h, k (k)}
              <circle cx={h.cx} cy={s.y + SLAB_H / 2} r="3.4" class="head-off" />
              {#if lit > 0.02}
                <circle
                  cx={h.cx}
                  cy={s.y + SLAB_H / 2}
                  r="3.4"
                  class="head-on"
                  style="--d: {h.delay}s; --t: {h.dur}s; opacity: {lit}"
                />
              {/if}
            {/each}
            <rect x="140" y={s.y + 11} width="58" height="6" rx="3" class="mlp-off" />
            <rect
              x="140"
              y={s.y + 11}
              width="58"
              height="6"
              rx="3"
              class="mlp-on"
              style="transform: scaleX({lit})"
            />
          </g>
        {/each}

        <line x1="120" y1={STREAM_BOTTOM} x2="120" y2={litTopY} class="stream-lit" />
        {#if !reducedMotion && shown > 0.02}
          <circle
            cx="120"
            cy={STREAM_BOTTOM}
            r="7"
            fill="url(#ls-pulse)"
            class="pulse"
            style="--travel: {litTopY - STREAM_BOTTOM}px"
          />
        {/if}

        <!-- input: words drifting in -->
        {#each tokenChips as c, n (n)}
          <g class="token" style="--d: {c.delay}s">
            <rect x={c.x} y="390" width={c.w} height="20" rx="5" class="tok-chip" />
            <text x={c.x + c.w / 2} y="404" text-anchor="middle" class="mono tok-text">{c.text}</text>
          </g>
        {/each}
      </svg>
      <figcaption class="mt-3 hidden text-xs leading-relaxed text-zinc-500 sm:block">
        Inside, a model is a stack of layers. Words go in at the bottom, each layer reads them and adds
        notes to a running stream, and a guess for the next word comes out the top.
      </figcaption>
    </figure>

    <div class="min-w-0 self-center">
      <div class="mono flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-indigo-300/80">
        <span>Loading model</span>
        <span class="h-px flex-1 bg-zinc-800"></span>
        <span class="tabular-nums tracking-normal text-zinc-400" title="Time since loading started">
          {formatElapsed(view.totalElapsed)}
        </span>
      </div>

      <h2 id="loading-title" class="display mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
        {modelName}
      </h2>

      <p class="mt-2 text-lg text-zinc-200" data-testid="loading-stage">{stageText}</p>
      <div class="sr-only" role="status" aria-live="polite">{announced}</div>

      <!-- progress -->
      <div class="mt-5">
        <div
          class="bar relative h-2 overflow-hidden rounded-full bg-zinc-800/80"
          role="progressbar"
          aria-label="Loading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={etaText ? `${pct} percent, ${etaText}` : `${pct} percent`}
        >
          <div class="bar-fill absolute inset-y-0 left-0 w-full origin-left rounded-full" style="transform: scaleX({shown})"></div>
        </div>
        <div class="mono mt-2 flex items-baseline justify-between gap-4 text-xs text-zinc-400">
          <span class="tabular-nums text-zinc-300">{pct}%</span>
          {#if etaLine}<span class="text-right">{etaLine}</span>{/if}
        </div>
      </div>

      <!-- what happens, in order -->
      <ol class="mt-5 space-y-1.5 text-sm" aria-label="Loading steps">
        {#each steps as step (step.stage)}
          <li class="flex items-center gap-2.5 {step.status === 'next' ? 'text-zinc-500' : step.status === 'current' ? 'text-zinc-100' : 'text-zinc-400'}">
            <span class="flex h-4 w-4 flex-none items-center justify-center" aria-hidden="true">
              {#if step.status === 'done'}
                <Check class="h-3.5 w-3.5 text-indigo-400" />
              {:else if step.status === 'current'}
                <span class="now-dot h-2 w-2 rounded-full bg-indigo-400"></span>
              {:else}
                <span class="h-2 w-2 rounded-full border border-zinc-600"></span>
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              {step.label}
              <span class="sr-only">{step.status === 'done' ? '(done)' : step.status === 'current' ? '(now)' : '(next)'}</span>
            </span>
            {#if step.seconds !== null}
              <span class="mono flex-none text-xs tabular-nums text-zinc-500">{step.seconds < 1 ? '<1' : Math.round(step.seconds)} s</span>
            {:else if step.status === 'current'}
              <span class="mono flex-none text-xs tabular-nums text-zinc-400">{Math.floor(view.stageElapsed)} s</span>
            {/if}
          </li>
        {/each}
      </ol>

      {#if note}
        <p class="mt-4 border-l-2 border-indigo-500/50 pl-3 text-sm leading-relaxed text-zinc-400">{note}</p>
      {/if}

      <UpdateCard variant="card" />

      <!-- card deck -->
      {#if card}
        <div
          class="deck mt-7"
          role="region"
          aria-roledescription="carousel"
          aria-label="While you wait"
          use:deckEvents
        >
          <div class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
            {#key card.id}
              <div
                class="card-body flex min-h-[9.5rem] flex-col p-4"
                role="group"
                aria-roledescription="card"
                aria-label="{deckState.index + 1} of {deck.length}: {KIND_LABEL[card.kind]}"
                in:fly={{ x: 16 * dir, duration: reducedMotion ? 0 : 240 }}
              >
                <div class="mono mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-indigo-300/80">
                  {#if card.kind === 'tip'}
                    <Lightbulb class="h-3.5 w-3.5" aria-hidden="true" />
                  {:else if card.kind === 'lesson'}
                    <GraduationCap class="h-3.5 w-3.5" aria-hidden="true" />
                  {:else}
                    <BookOpen class="h-3.5 w-3.5" aria-hidden="true" />
                  {/if}
                  <span>{KIND_LABEL[card.kind]}</span>
                </div>

                {#if card.kind === 'tip'}
                  <h3 class="font-medium text-zinc-100">{card.heading}</h3>
                  <p class="mt-1 text-sm leading-relaxed text-zinc-400">{card.body}</p>
                {:else if card.kind === 'term'}
                  <h3 class="display text-xl font-semibold text-zinc-100">{card.term}</h3>
                  <p class="mt-1 text-sm leading-relaxed text-zinc-400">{card.definition}</p>
                {:else}
                  {@const queued = queuedLessonId === card.lessonId}
                  <h3 class="font-medium text-zinc-100">{card.title}</h3>
                  <p class="mt-1 text-sm leading-relaxed text-zinc-400">{card.summary}</p>
                  {#if card.switchesModel && card.model}
                    <p class="mt-1.5 text-xs text-zinc-500">
                      It runs on {presetName(card.model)}, so the lesson offers to switch to it when it opens.
                    </p>
                  {/if}
                  <div class="mt-auto flex flex-wrap items-center gap-3 pt-3">
                    {#if queued}
                      <span class="inline-flex items-center gap-1.5 text-sm text-indigo-200">
                        <Check class="h-4 w-4" aria-hidden="true" /> Opens when the model is ready
                      </span>
                      <button
                        type="button"
                        class="ctl rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        onclick={() => onQueueLesson(null)}
                      >
                        Cancel
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="ctl rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                        onclick={() => onQueueLesson(card.lessonId)}
                      >
                        Open it when ready
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            {/key}
          </div>

          <div class="mt-3 flex items-center gap-2">
            <button
              type="button"
              class="ctl rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Previous card"
              onclick={() => go(-1)}
            >
              <ChevronLeft class="h-4 w-4" aria-hidden="true" />
            </button>
            <div class="flex flex-1 flex-wrap items-center justify-center gap-1">
              {#each deck as c, i (c.id)}
                <button
                  type="button"
                  class="ctl dot-btn rounded-full p-1"
                  aria-label="Card {i + 1} of {deck.length}"
                  aria-current={i === deckState.index ? 'true' : undefined}
                  onclick={() => goTo(i)}
                >
                  <span
                    class="block h-1.5 rounded-full transition-all {i === deckState.index ? 'w-4 bg-indigo-400' : 'w-1.5 bg-zinc-600'}"
                  ></span>
                </button>
              {/each}
            </div>
            <button
              type="button"
              class="ctl rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label={userPaused ? 'Resume turning cards' : 'Stop turning cards'}
              title={userPaused ? 'Resume turning cards' : 'Stop turning cards'}
              onclick={() => (userPaused = !userPaused)}
            >
              {#if userPaused}
                <Play class="h-4 w-4" aria-hidden="true" />
              {:else}
                <Pause class="h-4 w-4" aria-hidden="true" />
              {/if}
            </button>
            <button
              type="button"
              class="ctl rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Next card"
              onclick={() => go(1)}
            >
              <ChevronRight class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .display {
    font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif;
  }
  .mono {
    font-family: 'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, monospace;
  }

  .loading-screen {
    animation: ls-enter 360ms ease-out both;
  }
  @keyframes ls-enter {
    from {
      opacity: 0;
    }
  }

  .ctl:focus-visible {
    outline: 2px solid #818cf8;
    outline-offset: 2px;
  }

  /* --- progress bar --- */
  .bar-fill {
    background: linear-gradient(90deg, #4f46e5, #818cf8 70%, #c7d2fe);
    transition: transform 260ms linear;
  }
  .bar-fill::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.28), transparent);
    background-size: 40% 100%;
    background-repeat: no-repeat;
    animation: ls-sheen 2.4s ease-in-out infinite;
  }
  @keyframes ls-sheen {
    from {
      background-position: -60% 0;
    }
    to {
      background-position: 160% 0;
    }
  }
  .now-dot {
    animation: ls-breathe 1.6s ease-in-out infinite;
  }
  @keyframes ls-breathe {
    50% {
      opacity: 0.35;
    }
  }

  /* --- the stack --- */
  .stack :global(text) {
    font-family: 'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, monospace;
  }
  .slab-base {
    fill: #131316;
    stroke: #27272a;
    stroke-width: 1;
  }
  .slab-lit {
    fill: rgb(99 102 241 / 0.13);
    stroke: rgb(129 140 248 / 0.75);
    stroke-width: 1;
    transition: opacity 600ms ease-out;
  }
  .head-off {
    fill: #3f3f46;
  }
  .head-on {
    fill: #c7d2fe;
    animation: ls-fire var(--t) ease-in-out var(--d) infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes ls-fire {
    0%,
    100% {
      fill: #6366f1;
      transform: scale(0.85);
    }
    45% {
      fill: #e0e7ff;
      transform: scale(1.15);
    }
  }
  .mlp-off {
    fill: #27272a;
  }
  .mlp-on {
    fill: #818cf8;
    transform-box: fill-box;
    transform-origin: left center;
    transition: transform 600ms ease-out;
  }
  .stream-track {
    stroke: #27272a;
    stroke-width: 3;
    stroke-linecap: round;
  }
  .stream-lit {
    stroke: url(#ls-stream);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .pulse {
    animation: ls-rise 2.8s cubic-bezier(0.45, 0, 0.55, 1) infinite;
  }
  @keyframes ls-rise {
    0% {
      transform: translateY(0);
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    88% {
      opacity: 1;
    }
    100% {
      transform: translateY(var(--travel));
      opacity: 0;
    }
  }
  .tok-chip {
    fill: #18181b;
    stroke: #3f3f46;
  }
  .tok-text {
    fill: #d4d4d8;
    font-size: 11px;
  }
  .token {
    animation: ls-drift 5.6s ease-in-out var(--d) infinite;
  }
  @keyframes ls-drift {
    0%,
    100% {
      transform: translateY(0);
      opacity: 0.55;
    }
    30% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }
  .out-chip {
    fill: #18181b;
    stroke: #6366f1;
    stroke-dasharray: 3 3;
  }
  .out-text {
    fill: #c7d2fe;
    font-size: 13px;
  }
  .output {
    transition: opacity 600ms ease-out;
  }

  /* Reduced motion: the picture still shows progress, nothing moves on its own. */
  .stack.still .head-on,
  .stack.still .token {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .loading-screen,
    .bar-fill::after,
    .now-dot,
    .head-on,
    .token,
    .pulse {
      animation: none;
    }
    .bar-fill,
    .slab-lit,
    .mlp-on,
    .stream-lit,
    .output {
      transition: none;
    }
  }
</style>
