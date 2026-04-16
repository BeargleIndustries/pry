<script lang="ts">
  import type { DLAResponse, DLAComponent } from '$lib/types';

  interface Props {
    response: DLAResponse | null;
    loading?: boolean;
  }

  let { response, loading = false }: Props = $props();

  const components = $derived(response?.components ?? []);

  // Show top 30 components max
  const visibleComponents = $derived(components.slice(0, 30));

  const maxAbsContribution = $derived.by(() => {
    if (visibleComponents.length === 0) return 1;
    return Math.max(...visibleComponents.map((c) => Math.abs(c.contribution)), 0.001);
  });

  function barWidth(c: DLAComponent): number {
    return (Math.abs(c.contribution) / maxAbsContribution) * 100;
  }

  function displayToken(t: string): string {
    return t.startsWith(' ') ? '\u00b7' + t.slice(1) : t;
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="dla-waterfall"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Direct Logit Attribution</h2>
    <span class="text-xs text-zinc-600">Per-component credit</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Computing...
      </span>
    {/if}
  </div>

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt, then click "DLA" to see per-component logit contributions.</p>
    </div>
  {:else if response}
    <!-- Target info -->
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
      <span class="text-zinc-500">Target token:</span>
      <span class="font-mono text-zinc-200">"{displayToken(response.target_token)}"</span>
      <span class="text-zinc-600">(pos {response.target_token_index})</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Predicted:</span>
      <span class="font-mono text-indigo-300">"{displayToken(response.predicted_token)}"</span>
    </div>

    {#if visibleComponents.length === 0}
      <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
        <p class="text-sm text-zinc-600">No component attributions available.</p>
      </div>
    {:else}
      <!-- Waterfall chart -->
      <div class="flex flex-col gap-0.5">
        {#each visibleComponents as comp, i (comp.name)}
          {@const isPositive = comp.contribution >= 0}
          {@const width = barWidth(comp)}
          <div class="group flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-900/60">
            <!-- Rank -->
            <span class="w-5 shrink-0 text-right font-mono text-[10px] text-zinc-700">
              {i + 1}
            </span>
            <!-- Component label -->
            <span
              class="w-16 shrink-0 truncate font-mono text-xs"
              class:text-zinc-300={comp.type === 'attention'}
              class:text-amber-400={comp.type === 'mlp'}
              title="{comp.type === 'attention' ? `Attention Layer ${comp.layer} Head ${comp.head}` : `MLP Layer ${comp.layer}`}"
            >
              {comp.name}
            </span>
            <!-- Type badge -->
            <span
              class={[
                'w-8 shrink-0 rounded text-center text-[9px] font-medium',
                comp.type === 'attention' ? 'bg-indigo-900/40 text-indigo-400' : 'bg-amber-900/40 text-amber-400',
              ].join(' ')}
            >
              {comp.type === 'attention' ? 'Attn' : 'MLP'}
            </span>
            <!-- Bar -->
            <div class="flex-1 flex items-center" style="height: 16px;">
              {#if isPositive}
                <div class="flex h-full w-1/2 justify-start">
                  <!-- spacer for negative side -->
                </div>
                <div class="h-full w-1/2 flex items-center">
                  <div
                    class="h-full rounded-r bg-blue-500/70 transition-all"
                    style="width: {width / 2}%;"
                  ></div>
                </div>
              {:else}
                <div class="h-full w-1/2 flex items-center justify-end">
                  <div
                    class="h-full rounded-l bg-red-500/70 transition-all"
                    style="width: {width / 2}%;"
                  ></div>
                </div>
                <div class="flex h-full w-1/2 justify-start">
                  <!-- spacer for positive side -->
                </div>
              {/if}
            </div>
            <!-- Value -->
            <span
              class="w-16 shrink-0 text-right font-mono text-[10px]"
              class:text-blue-400={isPositive}
              class:text-red-400={!isPositive}
            >
              {isPositive ? '+' : ''}{comp.contribution.toFixed(3)}
            </span>
          </div>
        {/each}
      </div>

      <!-- Legend -->
      <div class="flex items-center gap-4 text-[10px] text-zinc-600">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm bg-blue-500/70"></span>
          Positive (pushed toward prediction)
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm bg-red-500/70"></span>
          Negative (pushed against)
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm bg-indigo-900/40"></span>
          Attn
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm bg-amber-900/40"></span>
          MLP
        </span>
        {#if components.length > 30}
          <span class="ml-auto text-zinc-700">
            Showing top 30 of {components.length}
          </span>
        {/if}
        {#if response?.timing_ms}
          <span class="ml-auto text-zinc-700">
            {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</section>
