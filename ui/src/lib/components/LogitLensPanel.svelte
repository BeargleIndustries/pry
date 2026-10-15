<script lang="ts">
  import Term from './Term.svelte';
  import type { LogitLensResponse } from '$lib/types';
  import { logitLensReadout } from '$lib/readouts';
  import Readout from './Readout.svelte';
  import { clampCell, handleGridKey, type GridCell } from '$lib/grid-nav';
  import { untrack } from 'svelte';
  import { placePopup, type Placement, type RectLike } from '$lib/popup/place';
  import { placementAttrs, viewportSize } from '$lib/popup/measure';
  import { occupied } from '$lib/popup/occupied.svelte';

  interface Props {
    response: LogitLensResponse | null;
    loading?: boolean;
  }

  let { response, loading = false }: Props = $props();

  const tokens = $derived(response?.tokens ?? []);
  const grid = $derived(response?.grid ?? []);
  const nLayers = $derived(response?.n_layers ?? 0);

  // Tooltip state: anchored to the hovered (or focused) cell via placePopup.
  let tipLayer = $state<number | null>(null);
  let tipPos = $state<number | null>(null);
  let tipCell = $state<RectLike | null>(null);
  let tipEl: HTMLDivElement | null = $state(null);
  let tipPlaced = $state<Placement | null>(null);

  function onCellEnter(layer: number, pos: number, e: MouseEvent) {
    tipLayer = layer;
    tipPos = pos;
    tipCell = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }

  function onCellLeave() {
    tipLayer = null;
    tipPos = null;
    tipCell = null;
  }

  $effect(() => {
    if (!tipEl || !tipCell) {
      tipPlaced = null;
      return;
    }
    const el = tipEl;
    const target = tipCell;
    untrack(() => {
      const p = placePopup({
        target,
        size: { w: el.offsetWidth, h: el.offsetHeight },
        viewport: viewportSize(),
        preferred: 'top',
        previousSide: tipPlaced?.side,
        previousMode: tipPlaced?.mode,
        gap: 6,
        edgePad: 8,
        avoid: occupied.rects(),
      });
      tipPlaced = p.mode === 'fallback' ? null : p;
    });
  });

  // Keyboard model (T29): roving tabindex, rows top to bottom as drawn (last
  // layer first), columns are word positions. Focus shows the hover tooltip.
  const uid = $props.id();
  const readoutId = `lens-readout-${uid}`;
  const legendId = `lens-legend-${uid}`;
  let gridEl: HTMLElement | undefined = $state();
  let gridCurrent = $state<GridCell>({ row: 0, col: 0 });
  const gridShape = $derived({ rows: nLayers, cols: tokens.length });
  const tabStop = $derived(clampCell(gridCurrent, gridShape));

  function onGridKey(e: KeyboardEvent) {
    if (!tabStop) return;
    const next = handleGridKey(e, tabStop, gridShape, gridEl);
    if (next) gridCurrent = next;
  }

  function onCellFocus(row: number, layer: number, pos: number, e: FocusEvent) {
    gridCurrent = { row, col: pos };
    tipLayer = layer;
    tipPos = pos;
    tipCell = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }

  function cellLabel(layer: number, pos: number): string {
    const word = `word ${pos + 1} ${JSON.stringify(tokens[pos]?.text ?? '')}`;
    const cell = grid[layer]?.[pos];
    if (!cell) return `Layer ${layer}, ${word}: no data`;
    const match = cell.matches_final ? 'matches the final prediction' : 'differs from the final prediction';
    return `Layer ${layer}, ${word}: guesses ${JSON.stringify(cell.predicted_token)} at ${(cell.probability * 100).toFixed(1)}%, ${match}`;
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

  // The readout above describes the last word's column: a new result opens
  // scrolled to it, so a long prompt doesn't hide the column the text is about.
  let scrollEl: HTMLElement | undefined = $state();
  $effect(() => {
    const r = response;
    const el = scrollEl;
    if (r && el) el.scrollLeft = el.scrollWidth;
  });

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
    <h2 class="text-sm font-semibold text-zinc-100"><Term key="logit-lens">Logit Lens</Term></h2>
    <span class="text-xs text-zinc-600">Each layer's best guess, word by word</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Computing...
      </span>
    {/if}
  </div>

  <p class="text-xs text-zinc-400">
    The model turns each word into numbers (its <Term key="embedding">embedding</Term>), then every layer adds its own work.
    Each square asks one layer: what's your guess if you had to answer right now? Pry reads the answer with the model's
    <Term key="unembedding">last step</Term>. Early layers are a rough read, so treat their guesses as a hint, not proof.
  </p>

  <Readout id={readoutId} text={logitLensReadout(response)} />

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt and this tab fills in on its own.</p>
    </div>
  {:else if response && nLayers > 0 && tokens.length > 0}
    <div class="overflow-x-auto" bind:this={scrollEl}>
      <div
        bind:this={gridEl}
        role="grid"
        tabindex="-1"
        aria-label="Logit lens: each layer's guess at each word"
        aria-describedby="{readoutId} {legendId}"
        onkeydown={onGridKey}
      >
        <!-- Column headers (tokens) -->
        <div role="row" class="flex">
          <div role="columnheader" class="shrink-0" style="width: {LABEL_W}px;"><span class="sr-only">Layer</span></div>
          {#each tokens as token, pos}
            <div
              role="columnheader"
              class="shrink-0 truncate px-0.5 text-center font-mono text-[10px] text-zinc-500"
              style="width: {CELL_W}px;"
              title={token.text}
              aria-label="Word {pos + 1} {JSON.stringify(token.text)}"
            >
              {displayToken(token.text)}
            </div>
          {/each}
        </div>

        <!-- Grid rows (layers, bottom = layer 0, top = layer n-1) -->
        {#each { length: nLayers } as _, layerFromTop}
          {@const layer = nLayers - 1 - layerFromTop}
          <div role="row" class="flex items-center">
            <!-- Layer label -->
            <div
              role="rowheader"
              class="shrink-0 text-right pr-1.5 font-mono text-[10px] text-zinc-500"
              style="width: {LABEL_W}px;"
              aria-label="Layer {layer}"
            >
              L{layer}
            </div>
            <!-- Cells -->
            {#each tokens as _, pos}
              {@const cell = grid[layer]?.[pos]}
              <div
                role="gridcell"
                data-row={layerFromTop}
                data-col={pos}
                tabindex={tabStop?.row === layerFromTop && tabStop?.col === pos ? 0 : -1}
                aria-label={cellLabel(layer, pos)}
                class={[
                  'shrink-0 flex items-center justify-center border border-zinc-800/50 font-mono text-[9px] cursor-default select-none overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white',
                  cell ? '' : 'bg-zinc-900',
                ].join(' ')}
                style="width: {CELL_W}px; height: {CELL_H}px;{cell ? ` background: ${cellColor(cell.probability, cell.matches_final)};` : ''}"
                style:color={cell?.matches_final ? '#c7d2fe' : '#a1a1aa'}
                onmouseenter={(e) => onCellEnter(layer, pos, e)}
                onmouseleave={onCellLeave}
                onfocus={(e) => onCellFocus(layerFromTop, layer, pos, e)}
                onblur={onCellLeave}
              >
                {#if cell}
                  <span class="truncate px-0.5" aria-hidden="true">{displayToken(cell.predicted_token)}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>

    <!-- Legend -->
    <div id={legendId} class="flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
      <span>Rows are layers (bottom: early, top: late). Columns are your words.</span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm" style="background: rgba(129, 140, 248, 0.8);"></span>
        Matches the final answer
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm" style="background: rgba(161, 161, 170, 0.3);"></span>
        A different guess
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
          bind:this={tipEl}
          class="pointer-events-none fixed z-50 rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs shadow-lg"
          style:left="{tipPlaced?.left ?? 0}px"
          style:top="{tipPlaced?.top ?? 0}px"
          style:visibility={tipPlaced ? 'visible' : 'hidden'}
          data-popup="hover"
          {...placementAttrs(tipPlaced, null)}
        >
          <div class="text-zinc-300">
            Layer {tipLayer}, word {tipPos + 1}
            <span class="text-zinc-500">"{displayToken(tokens[tipPos]?.text ?? '')}"</span>
          </div>
          <div class="mt-0.5">
            <span class="font-mono text-indigo-300">{displayToken(cell.predicted_token)}</span>
            <span class="mx-1 text-zinc-600">at</span>
            <span class="font-mono text-zinc-300">{(cell.probability * 100).toFixed(1)}%</span>
            {#if cell.matches_final}
              <span class="ml-1 text-emerald-400">matches the final answer</span>
            {:else}
              <span class="ml-1 text-zinc-500">not the final answer</span>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</section>
