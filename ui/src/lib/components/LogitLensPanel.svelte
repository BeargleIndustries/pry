<script lang="ts">
  import type { LogitLensResponse } from '$lib/types';

  interface Props {
    response: LogitLensResponse | null;
    loading?: boolean;
  }

  let { response, loading = false }: Props = $props();

  const tokens = $derived(response?.tokens ?? []);
  const grid = $derived(response?.grid ?? []);
  const nLayers = $derived(response?.n_layers ?? 0);

  // Tooltip state
  let tipLayer = $state<number | null>(null);
  let tipPos = $state<number | null>(null);
  let tipX = $state(0);
  let tipY = $state(0);

  function onCellEnter(layer: number, pos: number, e: MouseEvent) {
    tipLayer = layer;
    tipPos = pos;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    tipX = rect.right + 8;
    tipY = rect.top;
  }

  function onCellLeave() {
    tipLayer = null;
    tipPos = null;
  }

  function cellColor(prob: number, matches: boolean): string {
    if (matches) {
      // Bright indigo scale based on probability
      const alpha = 0.25 + prob * 0.75;
      return `rgba(129, 140, 248, ${alpha})`;
    }
    // Dim zinc for non-matching
    const alpha = 0.1 + prob * 0.3;
    return `rgba(161, 161, 170, ${alpha})`;
  }

  function displayToken(t: string): string {
    return t.startsWith(' ') ? '\u00b7' + t.slice(1) : t;
  }

  // Cell sizing
  const CELL_W = 56;
  const CELL_H = 24;
  const LABEL_W = 36;
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="logit-lens-heatmap"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Logit Lens</h2>
    <span class="text-xs text-zinc-600">Per-layer predictions</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Computing...
      </span>
    {/if}
  </div>

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt, then click "Logit Lens" to see per-layer predictions.</p>
    </div>
  {:else if response && nLayers > 0 && tokens.length > 0}
    <div class="overflow-x-auto">
      <!-- Column headers (tokens) -->
      <div class="flex" style="padding-left: {LABEL_W}px;">
        {#each tokens as token}
          <div
            class="shrink-0 truncate px-0.5 text-center font-mono text-[10px] text-zinc-500"
            style="width: {CELL_W}px;"
            title={token.text}
          >
            {displayToken(token.text)}
          </div>
        {/each}
      </div>

      <!-- Grid rows (layers, bottom = layer 0, top = layer n-1) -->
      {#each { length: nLayers } as _, layerFromTop}
        {@const layer = nLayers - 1 - layerFromTop}
        <div class="flex items-center">
          <!-- Layer label -->
          <div
            class="shrink-0 text-right pr-1.5 font-mono text-[10px] text-zinc-600"
            style="width: {LABEL_W}px;"
          >
            L{layer}
          </div>
          <!-- Cells -->
          {#each tokens as _, pos}
            {@const cell = grid[layer]?.[pos]}
            {#if cell}
              <div
                class="shrink-0 flex items-center justify-center border border-zinc-800/50 font-mono text-[9px] cursor-default select-none overflow-hidden"
                style="width: {CELL_W}px; height: {CELL_H}px; background: {cellColor(cell.probability, cell.matches_final)};"
                style:color={cell.matches_final ? '#c7d2fe' : '#a1a1aa'}
                onmouseenter={(e) => onCellEnter(layer, pos, e)}
                onmouseleave={onCellLeave}
              >
                <span class="truncate px-0.5">{displayToken(cell.predicted_token)}</span>
              </div>
            {:else}
              <div
                class="shrink-0 border border-zinc-800/50 bg-zinc-900"
                style="width: {CELL_W}px; height: {CELL_H}px;"
              ></div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>

    <!-- Legend -->
    <div class="flex items-center gap-4 text-[10px] text-zinc-600">
      <span>Rows = layers (bottom: early, top: late)</span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm" style="background: rgba(129, 140, 248, 0.8);"></span>
        Matches final prediction
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm" style="background: rgba(161, 161, 170, 0.3);"></span>
        Different prediction
      </span>
      {#if response?.timing_ms}
        <span class="ml-auto text-zinc-700">
          {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
        </span>
      {/if}
    </div>

    <!-- Tooltip -->
    {#if tipLayer !== null && tipPos !== null}
      {@const cell = grid[tipLayer]?.[tipPos]}
      {#if cell}
        <div
          class="pointer-events-none fixed z-50 rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs shadow-lg"
          style="left: {tipX}px; top: {tipY}px;"
        >
          <div class="text-zinc-300">
            Layer {tipLayer} / Token {tipPos}
            <span class="text-zinc-500">"{displayToken(tokens[tipPos]?.text ?? '')}"</span>
          </div>
          <div class="mt-0.5">
            <span class="font-mono text-indigo-300">{displayToken(cell.predicted_token)}</span>
            <span class="mx-1 text-zinc-600">at</span>
            <span class="font-mono text-zinc-300">{(cell.probability * 100).toFixed(1)}%</span>
            {#if cell.matches_final}
              <span class="ml-1 text-emerald-400">= final</span>
            {:else}
              <span class="ml-1 text-zinc-500">!= final</span>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</section>
