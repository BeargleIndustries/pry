<script lang="ts">
  import type { GenerateResponse, TopPrediction } from '$lib/types';

  interface Props {
    response: GenerateResponse | null;
    showTokenStrip?: boolean;
  }

  let { response, showTokenStrip = false }: Props = $props();

  const predictions = $derived<TopPrediction[]>(response?.top_predictions ?? []);

  const maxProb = $derived(predictions.length > 0 ? predictions[0].probability : 1);

  const isConfident = $derived(predictions.length > 0 && predictions[0].probability > 0.5);

  const isUncertain = $derived.by(() => {
    if (predictions.length < 3) return false;
    const top3 = predictions.slice(0, 3);
    const max = Math.max(...top3.map((p) => p.probability));
    const min = Math.min(...top3.map((p) => p.probability));
    return (max - min) < 0.05;
  });

  function pct(p: number): string {
    return (p * 100).toFixed(1);
  }

  function displayToken(t: string): string {
    return t.startsWith(' ') ? '\u00b7' + t.slice(1) : t;
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="predictions-panel"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Top-k Predictions</h2>
    <span class="text-xs text-zinc-600">Next token probabilities</span>
    {#if isConfident}
      <span class="ml-auto rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
        confident
      </span>
    {:else if isUncertain}
      <span class="ml-auto rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
        uncertain
      </span>
    {/if}
  </div>

  {#if !response}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt to see next-token predictions.</p>
    </div>
  {:else if predictions.length === 0}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">No predictions available for this run.</p>
    </div>
  {:else}
    <div class="flex flex-col gap-1.5">
      {#each predictions as pred (pred.rank)}
        {@const barWidth = maxProb > 0 ? (pred.probability / maxProb) * 100 : 0}
        <div
          class="group flex items-center gap-3 rounded-md px-3 py-1.5 transition-colors {pred.rank === 1 ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/50'}"
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

          <!-- Probability bar -->
          <div class="flex-1">
            <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                class="h-full rounded-full transition-all {pred.rank <= 3 ? 'bg-indigo-500' : 'bg-zinc-600'}"
                style:width="{barWidth}%"
              ></div>
            </div>
          </div>

          <!-- Probability value -->
          <span class="w-14 shrink-0 text-right font-mono text-xs text-zinc-400">
            {pct(pred.probability)}%
          </span>
        </div>
      {/each}
    </div>
  {/if}
</section>
