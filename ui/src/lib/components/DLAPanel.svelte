<script lang="ts">
  import Term from './Term.svelte';
  import type { DLAResponse, DLAComponent } from '$lib/types';
  import { dlaReadout } from '$lib/readouts';
  import Readout from './Readout.svelte';
  import { NEGATIVE_HEX, POSITIVE_HEX, signedHex, signedNumber, signOf } from '$lib/signed-color';

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

  const uid = $props.id();
  const readoutId = `dla-readout-${uid}`;
  const legendId = `dla-legend-${uid}`;

  function rowLabel(c: DLAComponent): string {
    const what = c.type === 'attention' ? `Attention layer ${c.layer} head ${c.head}` : `MLP layer ${c.layer}`;
    const s = signOf(c.contribution);
    const dir = s === 'positive' ? 'pushed toward the prediction' : s === 'negative' ? 'pushed against it' : 'no push';
    return `${what}: ${signedNumber(c.contribution, 3)}, ${dir}`;
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
    <h2 class="text-sm font-semibold text-zinc-100"><Term key="dla">Direct Logit Attribution</Term></h2>
    <span class="text-xs text-zinc-600">Per-component credit</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Computing...
      </span>
    {/if}
  </div>

  <Readout id={readoutId} text={dlaReadout(response)} />

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt and this tab fills in on its own, showing which parts pushed toward or against the predicted word.</p>
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
      <!-- Waterfall chart. A list, so screen readers can step through it; the
           readout above is its summary. -->
      <ul
        class="flex flex-col gap-0.5"
        aria-label="Direct logit attribution, largest first"
        aria-describedby="{readoutId} {legendId}"
      >
        {#each visibleComponents as comp, i (comp.name)}
          {@const isPositive = comp.contribution >= 0}
          {@const width = barWidth(comp)}
          <li class="group flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-900/60">
            <span class="sr-only">{i + 1}. {rowLabel(comp)}</span>
            <!-- Rank -->
            <span aria-hidden="true" class="w-5 shrink-0 text-right font-mono text-[10px] text-zinc-700">
              {i + 1}
            </span>
            <!-- Component label -->
            <span
              aria-hidden="true"
              class="w-16 shrink-0 truncate font-mono text-xs"
              class:text-zinc-300={comp.type === 'attention'}
              class:text-fuchsia-300={comp.type === 'mlp'}
              title="{comp.type === 'attention' ? `Attention Layer ${comp.layer} Head ${comp.head}` : `MLP Layer ${comp.layer}`}"
            >
              {comp.name}
            </span>
            <!-- Type badge -->
            <span
              aria-hidden="true"
              class={[
                'w-8 shrink-0 rounded text-center text-[9px] font-medium',
                comp.type === 'attention' ? 'bg-indigo-900/40 text-indigo-400' : 'bg-fuchsia-900/40 text-fuchsia-300',
              ].join(' ')}
            >
              {comp.type === 'attention' ? 'Attn' : 'MLP'}
            </span>
            <!-- Bar -->
            <div aria-hidden="true" class="flex-1 flex items-center" style="height: 16px;">
              {#if isPositive}
                <div class="flex h-full w-1/2 justify-start">
                  <!-- spacer for negative side -->
                </div>
                <div class="h-full w-1/2 flex items-center">
                  <div
                    class="h-full rounded-r transition-all"
                    style="width: {width / 2}%; background-color: {POSITIVE_HEX}; opacity: 0.75;"
                  ></div>
                </div>
              {:else}
                <div class="h-full w-1/2 flex items-center justify-end">
                  <div
                    class="h-full rounded-l transition-all"
                    style="width: {width / 2}%; background-color: {NEGATIVE_HEX}; opacity: 0.75;"
                  ></div>
                </div>
                <div class="flex h-full w-1/2 justify-start">
                  <!-- spacer for positive side -->
                </div>
              {/if}
            </div>
            <!-- Value -->
            <span
              aria-hidden="true"
              class="w-16 shrink-0 text-right font-mono text-[10px]"
              style="color: {signedHex(comp.contribution)};"
            >
              {signedNumber(comp.contribution, 3)}
            </span>
          </li>
        {/each}
      </ul>

      <!-- Legend -->
      <div id={legendId} class="flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {POSITIVE_HEX};" aria-hidden="true"></span>
          <span aria-hidden="true" class="font-mono font-bold">+</span>
          Positive (blue, bar to the right: pushed toward prediction)
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {NEGATIVE_HEX};" aria-hidden="true"></span>
          <span aria-hidden="true" class="font-mono font-bold">−</span>
          Negative (orange, bar to the left: pushed against)
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm bg-indigo-900/40"></span>
          Attn
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm bg-fuchsia-900/40"></span>
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
