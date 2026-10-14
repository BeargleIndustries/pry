<script lang="ts">
  import Term from './Term.svelte';
  // T26 "Watch it write": ask the model to keep writing, then replay the new
  // text one token at a time with the chosen word, its chance and the
  // runner-up. Replay/state logic lives in $lib/watch-it-write.ts.
  import type { GenerateResponse, GenerationStep } from '$lib/types';
  import { pryUi, responseKey, runWriteIt } from '$lib/lessons/registry/pry-state.svelte';
  import { pct } from '$lib/readouts';
  import {
    DEFAULT_SPEED_INDEX,
    MAX_NEW_TOKENS,
    MAX_TEMPERATURE,
    MIN_NEW_TOKENS,
    SPEEDS,
    initReplay,
    pause,
    play,
    showAll,
    stepBy,
    stepSentence,
    temperatureExplanation,
    tick,
    stepText,
    type ReplayState,
  } from '$lib/watch-it-write';
  import Readout from './Readout.svelte';

  interface Props {
    response: GenerateResponse | null;
  }

  let { response }: Props = $props();

  // Settings, result and replay live in the Pry scene state, so a lesson's
  // write_it shows here (plan T2b state lift). Speed stays local.
  const w = pryUi.writeIt;
  let speedIndex = $state(DEFAULT_SPEED_INDEX);

  const steps = $derived<GenerationStep[]>(w.result?.generation_steps ?? []);
  const current = $derived(w.replay.shown > 0 ? steps[w.replay.shown - 1] : null);
  const stoppedEarly = $derived(
    w.result !== null && w.replay.shown === w.replay.total && steps.length < w.newTokensUsed,
  );

  // A new analyzed prompt or model makes the old continuation stale (a layer
  // switch replaces the response object but keeps both, so key on them).
  $effect(() => {
    const key = responseKey(response);
    if (key === w.key) return;
    w.key = key;
    w.result = null;
    w.error = null;
    w.replay = initReplay(0);
  });

  // Playback timer: one beat per written token.
  $effect(() => {
    if (!w.replay.playing) return;
    const ms = SPEEDS[speedIndex].ms;
    const id = setTimeout(() => {
      w.replay = tick(w.replay);
    }, ms);
    return () => clearTimeout(id);
  });

  function write() {
    void runWriteIt(response);
  }

  function shown(t: string): string {
    return t.replace(/\n/g, '↵\n');
  }
</script>

<section
  class="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="watch-it-write"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Watch it write</h2>
    <span class="text-xs text-zinc-600">One word at a time</span>
  </div>

  <p class="text-xs leading-relaxed text-zinc-400">
    A language model writes by guessing the next word, adding it, and guessing again.
    Here you can watch each guess and see what it almost picked instead.
  </p>

  {#if !response}
    <p class="text-sm text-zinc-600">Run a prompt first, then come back to watch it keep writing.</p>
  {:else}
    <div class="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900 p-3">
      <label class="flex items-center gap-3 text-xs text-zinc-300">
        <span class="w-24 shrink-0"><Term key="temperature">Temperature</Term></span>
        <input
          type="range"
          min="0"
          max={MAX_TEMPERATURE}
          step="0.1"
          data-tour="write-it-temperature"
          bind:value={w.temperature}
          class="flex-1 accent-indigo-500"
          aria-describedby="wiw-temp-help"
        />
        <span class="w-8 text-right font-mono">{w.temperature.toFixed(1)}</span>
      </label>
      <p id="wiw-temp-help" class="text-xs leading-relaxed text-zinc-500">
        {temperatureExplanation(w.temperature)}
      </p>

      <label class="flex items-center gap-3 text-xs text-zinc-300">
        <span class="w-24 shrink-0">Words to write</span>
        <input
          type="number"
          min={MIN_NEW_TOKENS}
          max={MAX_NEW_TOKENS}
          bind:value={w.newTokens}
          class="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
        />
        <span class="text-zinc-600">(1 to {MAX_NEW_TOKENS}; they're really tokens, the word pieces the model reads)</span>
      </label>

      {#if w.temperature > 0 && w.result?.seed_used != null}
        <div class="flex items-center gap-1 text-xs text-zinc-400" data-tour="write-it-seed">
          <label class="flex items-center gap-2">
            <input type="checkbox" bind:checked={w.keepSeed} class="accent-indigo-500" />
            Reuse the same random draws so you can compare
          </label>
          <span>(<Term key="seed">seed</Term> {w.result.seed_used})</span>
        </div>
      {/if}

      <button
        type="button"
        class="self-start rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        onclick={write}
        disabled={w.loading}
      >
        {w.loading ? 'Writing…' : 'Write it'}
      </button>
    </div>

    {#if w.error}
      <p class="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{w.error}</p>
    {/if}

    {#if w.result}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        {#if w.replay.playing}
          <button type="button" class="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700" onclick={() => (w.replay = pause(w.replay))}>Pause</button>
        {:else}
          <button type="button" class="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700" onclick={() => (w.replay = play(w.replay))} disabled={w.replay.total === 0}>
            {w.replay.shown >= w.replay.total ? 'Replay' : 'Play'}
          </button>
        {/if}
        <button type="button" class="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40" onclick={() => (w.replay = stepBy(w.replay, -1))} disabled={w.replay.shown === 0} aria-label="Back one word">◀</button>
        <button type="button" class="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40" data-tour="write-it-step" onclick={() => (w.replay = stepBy(w.replay, 1))} disabled={w.replay.shown >= w.replay.total} aria-label="Forward one word">▶</button>
        <button type="button" class="rounded bg-zinc-800 px-2 py-1 text-zinc-200 hover:bg-zinc-700" onclick={() => (w.replay = showAll(w.replay))}>Show all</button>
        <span class="ml-2 text-zinc-500">Speed</span>
        {#each SPEEDS as sp, i (sp.label)}
          <button
            type="button"
            class="rounded px-2 py-1 {i === speedIndex ? 'bg-indigo-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}"
            aria-pressed={i === speedIndex}
            onclick={() => (speedIndex = i)}
          >{sp.label}</button>
        {/each}
        <span class="ml-auto font-mono text-zinc-600">{w.replay.shown}/{w.replay.total}</span>
      </div>

      <div class="whitespace-pre-wrap rounded-md bg-zinc-900 p-3 text-sm leading-relaxed text-zinc-300">
        <span class="text-zinc-500">{w.result.prompt}</span>{#each steps.slice(0, w.replay.shown) as st, i (i)}<span
            class={i === w.replay.shown - 1 ? 'rounded bg-indigo-900/60 text-indigo-200' : ''}
            title="{pct(st.probability)} chance">{shown(stepText(st))}</span>{/each}{#if w.replay.playing}<span class="animate-pulse text-indigo-400">▍</span>{/if}
      </div>

      <Readout text={current ? stepSentence(current) : null} />

      {#if stoppedEarly}
        <p class="text-xs text-zinc-500">It stopped early because it wrote its end-of-text marker.</p>
      {/if}
      {#if (w.result.temperature_used ?? 0) > 0}
        <p class="text-xs text-zinc-600">
          Random draws used seed {w.result.seed_used}. On this computer, the same seed and settings give the same text.
        </p>
      {/if}
    {/if}
  {/if}
</section>
