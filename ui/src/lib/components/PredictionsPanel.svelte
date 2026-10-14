<script lang="ts">
  import { isHidden } from '$lib/lessons/registry/pry-state.svelte';
  import Term from './Term.svelte';
  import type { GenerateResponse, TopPrediction } from '$lib/types';
  import {
    barWidthPct,
    everythingElse,
    predictionLogitLine,
    predictionShape,
    predictionsReadout,
    predictionTags,
    probabilityWithFrequency,
  } from '$lib/readouts';
  import Readout from './Readout.svelte';
  import WatchItWrite from './WatchItWrite.svelte';

  interface Props {
    response: GenerateResponse | null;
    showTokenStrip?: boolean;
  }

  let { response, showTokenStrip = false }: Props = $props();

  const predictions = $derived<TopPrediction[]>(response?.top_predictions ?? []);

  // Shape first, then any tag (plan T4-ui; style guide: probability, natural
  // frequency, shape, and only then a label).
  const shape = $derived(predictionShape(predictions));
  const tags = $derived(predictionTags(predictions));
  const rest = $derived(everythingElse(predictions));

  // Clicking a bar shows its logit (N1).
  let selectedRank = $state<number | null>(null);
  const selected = $derived(predictions.find((p) => p.rank === selectedRank) ?? null);
  const logitLine = $derived(selected ? predictionLogitLine(selected) : null);

  function displayToken(t: string): string {
    return t.startsWith(' ') ? '·' + t.slice(1) : t;
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="predictions-panel"
  data-lesson-hidden={isHidden('predictions-panel') || undefined}
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Next-token guesses (top 10)</h2>
    <span class="text-xs text-zinc-600">With the model's chance for each next <Term key="token">token</Term> (its <Term key="probability">probability</Term>)</span>
  </div>

  <Readout text={predictionsReadout(predictions, response?.tokens.at(-1)?.text ?? null)} />

  {#if !response}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt and this tab fills in on its own.</p>
    </div>
  {:else if predictions.length === 0}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">There's nothing to show for this run. Press Run again.</p>
    </div>
  {:else}
    {#if shape}
      <div class="flex flex-wrap items-baseline gap-2">
        <p class="text-xs text-zinc-300">{shape}</p>
        {#each tags as tag (tag)}
          <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">{tag}</span>
        {/each}
      </div>
    {/if}

    <div class="flex flex-col gap-1.5">
      <!-- The track's scale: every bar is drawn on the same 0-100% track. -->
      <div class="flex items-center gap-3 px-3 text-[10px] text-zinc-600" aria-hidden="true">
        <span class="w-5 shrink-0"></span>
        <span class="w-28 shrink-0"></span>
        <div class="flex flex-1 justify-between">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
        <span class="w-36 shrink-0"></span>
      </div>

      {#each predictions as pred (pred.rank)}
        <button
          type="button"
          data-tour="prediction-bar"
          data-token={pred.token}
          aria-pressed={selectedRank === pred.rank}
          onclick={() => { selectedRank = selectedRank === pred.rank ? null : pred.rank; }}
          class="group flex items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors {selectedRank === pred.rank ? 'bg-zinc-800/80' : pred.rank === 1 ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/50'}"
        >
          <!-- Rank badge -->
          <span
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold {pred.rank === 1 ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-500'}"
          >
            {pred.rank}
          </span>

          <!-- Token text -->
          <span class="w-28 shrink-0 truncate font-mono text-xs text-zinc-200">
            {displayToken(pred.token)}
          </span>

          <!-- Probability bar: width is the probability itself on a 0-100% track -->
          <div class="flex-1">
            <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                class="h-full rounded-full transition-all {pred.rank <= 3 ? 'bg-indigo-500' : 'bg-zinc-600'}"
                style:width={barWidthPct(pred.probability)}
              ></div>
            </div>
          </div>

          <!-- Probability with its natural frequency -->
          <span class="w-36 shrink-0 text-right font-mono text-xs text-zinc-400">
            {probabilityWithFrequency(pred.probability)}
          </span>
        </button>
      {/each}

      <!-- Everything outside the top ten -->
      <div
        data-tour="everything-else-row"
        class="flex items-center gap-3 rounded-md border-t border-zinc-800 px-3 py-1.5"
      >
        <span class="w-5 shrink-0"></span>
        <span class="w-28 shrink-0 truncate text-xs text-zinc-400">Everything else</span>
        <div class="flex-1">
          <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div class="h-full rounded-full bg-zinc-700" style:width={barWidthPct(rest)}></div>
          </div>
        </div>
        <span class="w-36 shrink-0 text-right font-mono text-xs text-zinc-400">
          {probabilityWithFrequency(rest)}
        </span>
      </div>
    </div>

    {#if selected && logitLine}
      <p class="text-[11px] text-zinc-400" role="status">
        {logitLine}
      </p>
    {:else}
      <p class="text-[10px] text-zinc-600">Click a bar to see its <Term key="logit">logit</Term>.</p>
    {/if}
  {/if}

  <WatchItWrite {response} />
</section>
