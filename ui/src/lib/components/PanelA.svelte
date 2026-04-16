<script lang="ts">
  import { viridis } from '$lib/viridis';
  import type { GenerateResponse, AblateResponse } from '$lib/types';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  type Aggregation = 'max' | 'mean' | 'entropy';

  interface Props {
    response: GenerateResponse | null;
    focusTokenIndex?: number | undefined;
    onTokenFocus?: (index: number) => void;
    aggregation?: Aggregation;
    showTokenStrip?: boolean;
    ablationMode?: boolean;
    ablations?: { layer: number; head: number }[];
    ablateResponse?: AblateResponse | null;
    ablateLoading?: boolean;
    onToggleAblation?: (layer: number, head: number) => void;
    onRunAblation?: () => void;
    onToggleAblationMode?: (active: boolean) => void;
  }

  let {
    response,
    focusTokenIndex: externalFocus,
    onTokenFocus,
    aggregation = $bindable('max'),
    showTokenStrip = true,
    ablationMode = false,
    ablations = [],
    ablateResponse = null,
    ablateLoading = false,
    onToggleAblation,
    onRunAblation,
    onToggleAblationMode,
  }: Props = $props();

  function isAblated(l: number, h: number): boolean {
    return ablations.some((a) => a.layer === l && a.head === h);
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const tokens = $derived(response?.tokens ?? []);
  const attention = $derived(response?.attention ?? []);
  const nLayers = $derived(attention.length);
  const nHeads = $derived(attention[0]?.heads?.length ?? 0);

  // ---------------------------------------------------------------------------
  // Focus token state
  // ---------------------------------------------------------------------------

  let internalFocus = $state<number | undefined>(undefined);
  let focusMode = $state<'from' | 'to'>('from');

  // When response changes, reset internal focus (M1 fix: both branches were identical)
  $effect(() => {
    void tokens.length; // track dependency
    internalFocus = undefined;
  });

  // focusIdx holds a token.index value (not an array position)
  const focusIdx = $derived.by((): number | null => {
    if (externalFocus !== undefined) return externalFocus;
    if (internalFocus !== undefined) return internalFocus;
    if (!response || tokens.length === 0) return null;
    return tokens[tokens.length - 1].index;
  });

  // effectiveFocusIdx is also a token.index value
  const effectiveFocusIdx = $derived.by((): number => {
    if (focusIdx !== null && tokens.some((t) => t.index === focusIdx)) return focusIdx;
    return tokens.length > 0 ? tokens[tokens.length - 1].index : 0;
  });

  // Array position of the focused token in the attention matrix
  const effectiveFocusArrayPos = $derived(
    tokens.findIndex((t) => t.index === effectiveFocusIdx),
  );

  function handleTokenClick(idx: number) {
    internalFocus = idx;
    onTokenFocus?.(idx);
  }

  // ---------------------------------------------------------------------------
  // Expanded view state
  // ---------------------------------------------------------------------------

  let expandedLayer = $state<number | null>(null);
  let expandedHead = $state<number | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);

  // ---------------------------------------------------------------------------
  // Aggregation helpers
  // ---------------------------------------------------------------------------

  function aggregate(values: number[], method: Aggregation): number {
    if (values.length === 0) return 0;
    if (method === 'max') {
      let m = -Infinity;
      for (const v of values) if (v > m) m = v;
      return m;
    }
    if (method === 'mean') {
      return values.reduce((a, b) => a + b, 0) / values.length;
    }
    // entropy: -sum(p log p), normalized to [0, 1] by dividing by log(n)
    const maxEntropy = Math.log(values.length);
    if (maxEntropy === 0) return 0;
    let ent = 0;
    for (const p of values) {
      if (p > 1e-9) ent -= p * Math.log(p);
    }
    return ent / maxEntropy;
  }

  // Returns a nLayers × nHeads grid of aggregated values (raw, before normalizing)
  const rawGrid = $derived.by<number[][]>(() => {
    if (!response || nLayers === 0 || nHeads === 0) return [];
    const fi = effectiveFocusArrayPos;
    const grid: number[][] = [];
    for (let l = 0; l < nLayers; l++) {
      const row: number[] = [];
      for (let h = 0; h < nHeads; h++) {
        const headMatrix = attention[l]?.heads?.[h];
        if (!headMatrix) { row.push(0); continue; }
        let vals: number[];
        if (focusMode === 'from') {
          // Row fi: how much fi attends to each key
          vals = headMatrix[fi] ?? [];
        } else {
          // Column fi: how much each query attends to fi
          vals = headMatrix.map((row) => row[fi] ?? 0);
        }
        row.push(aggregate(vals, aggregation));
      }
      grid.push(row);
    }
    return grid;
  });

  // Normalize raw grid to [0, 1]
  const normalizedGrid = $derived.by<number[][]>(() => {
    const g = rawGrid;
    if (g.length === 0) return [];
    let min = Infinity;
    let max = -Infinity;
    for (const row of g) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = max - min;
    if (range === 0) return g.map((row) => row.map(() => 0.5));
    return g.map((row) => row.map((v) => (v - min) / range));
  });

  // ---------------------------------------------------------------------------
  // Tooltip state
  // ---------------------------------------------------------------------------

  let tooltipLayer = $state<number | null>(null);
  let tooltipHead = $state<number | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  function onCellMouseEnter(l: number, h: number, e: MouseEvent) {
    tooltipLayer = l;
    tooltipHead = h;
    tooltipX = (e.target as SVGElement).getBoundingClientRect().x;
    tooltipY = (e.target as SVGElement).getBoundingClientRect().y;
  }

  function onCellMouseLeave() {
    tooltipLayer = null;
    tooltipHead = null;
  }

  // Clear tooltip if the window loses focus or user scrolls (coords go stale).
  $effect(() => {
    function clearTooltip() {
      tooltipLayer = null;
      tooltipHead = null;
    }
    window.addEventListener('blur', clearTooltip);
    window.addEventListener('scroll', clearTooltip, { capture: true });
    return () => {
      window.removeEventListener('blur', clearTooltip);
      window.removeEventListener('scroll', clearTooltip, { capture: true });
    };
  });

  function onCellClick(l: number, h: number) {
    expandedLayer = l;
    expandedHead = h;
  }

  function closeExpanded() {
    expandedLayer = null;
    expandedHead = null;
  }

  // ---------------------------------------------------------------------------
  // Canvas2D expanded view
  // ---------------------------------------------------------------------------

  const CELL_MIN = 6;
  const CELL_MAX = 36;
  const CANVAS_MAX = 640;
  const LABEL_OFFSET = 48; // px reserved for axis labels

  function renderCanvas(
    canvas: HTMLCanvasElement,
    matrix: number[][],
    rowLabels: string[],
    colLabels: string[],
  ) {
    const seq = matrix.length;
    if (seq === 0) return;
    const cellSize = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor((CANVAS_MAX - LABEL_OFFSET) / seq)));
    const canvasSize = cellSize * seq + LABEL_OFFSET;

    canvas.width = canvasSize;
    canvas.height = canvasSize;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Find min/max for normalization
    let min = Infinity;
    let max = -Infinity;
    for (const row of matrix) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = max - min || 1;

    // Draw cells
    for (let r = 0; r < seq; r++) {
      for (let c = 0; c < seq; c++) {
        const v = matrix[r]?.[c] ?? 0;
        const t = (v - min) / range;
        ctx.fillStyle = viridis(t);
        ctx.fillRect(LABEL_OFFSET + c * cellSize, LABEL_OFFSET + r * cellSize, cellSize, cellSize);
      }
    }

    // Axis labels — only if cellSize >= 10 and seq <= 64
    if (cellSize >= 10 && seq <= 64) {
      ctx.fillStyle = '#a1a1aa'; // zinc-400
      const fontSize = Math.max(8, Math.min(11, cellSize - 2));
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < seq; r++) {
        const label = rowLabels[r] ?? String(r);
        const truncated = label.length > 6 ? label.slice(0, 5) + '…' : label;
        ctx.fillText(truncated, LABEL_OFFSET - 3, LABEL_OFFSET + r * cellSize + cellSize / 2);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (let c = 0; c < seq; c++) {
        const label = colLabels[c] ?? String(c);
        const truncated = label.length > 6 ? label.slice(0, 5) + '…' : label;
        ctx.save();
        ctx.translate(LABEL_OFFSET + c * cellSize + cellSize / 2, LABEL_OFFSET - 3);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(truncated, 0, 0);
        ctx.restore();
      }
    }
  }

  // Trigger canvas render when expanded view data is available
  $effect(() => {
    if (expandedLayer === null || expandedHead === null || !canvasEl) return;
    const layer = expandedLayer;
    const head = expandedHead;
    const headMatrix = attention[layer]?.heads?.[head];
    if (!headMatrix) return;
    const tokenTexts = tokens.map((t) => t.text);
    renderCanvas(canvasEl, headMatrix, tokenTexts, tokenTexts);
  });

  // ---------------------------------------------------------------------------
  // SVG grid constants
  // ---------------------------------------------------------------------------
  const CELL = 32;
  const LABEL_W = 28;
  const LABEL_H = 28;
  const GAP = 1;

  const svgWidth = $derived(LABEL_W + nHeads * (CELL + GAP));
  const svgHeight = $derived(LABEL_H + nLayers * (CELL + GAP));

  // ---------------------------------------------------------------------------
  // Token display helper
  // ---------------------------------------------------------------------------
  function displayToken(text: string): string {
    // Replace leading space with middle dot for clarity
    return text.startsWith(' ') ? '·' + text.slice(1) : text;
  }
</script>

<!-- =========================================================================
     Panel A — Attention Visualization
     ========================================================================= -->
<div class="rounded-xl border border-zinc-700/60 bg-zinc-900 p-5 shadow-xl">
  <!-- Panel header -->
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-sm font-semibold uppercase tracking-widest text-zinc-400">
      Panel A — Attention
    </h2>
    {#if response}
      <span class="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500">
        {nLayers}L · {nHeads}H · {tokens.length} tokens
      </span>
    {/if}
  </div>

  <!-- Empty states -->
  {#if !response}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="mb-3 h-10 w-10 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center">
        <svg class="h-5 w-5 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <p class="text-sm text-zinc-500">Run a prompt to see attention patterns.</p>
    </div>
  {:else if tokens.length < 2}
    <div class="flex items-center justify-center py-12">
      <p class="text-sm text-zinc-500">Attention visualization requires at least 2 tokens.</p>
    </div>
  {:else}
    <!-- -----------------------------------------------------------------------
         Token strip
         ----------------------------------------------------------------------- -->
    {#if showTokenStrip}
    <div class="mb-4" data-tip="panel-a-token-strip">
      <p class="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-zinc-600">Tokens</p>
      <div class="flex flex-wrap gap-1.5">
        {#each tokens as token}
          <button
            onclick={() => { handleTokenClick(token.index); }}
            class={[
              'rounded px-2 py-1 font-mono text-xs transition-all',
              token.index === effectiveFocusIdx
                ? 'border border-indigo-500 bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/50'
                : 'border border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100',
            ].join(' ')}
          >
            {displayToken(token.text)}
          </button>
        {/each}
      </div>
    </div>
    {/if}

    <!-- -----------------------------------------------------------------------
         Controls row: focus mode + aggregation
         ----------------------------------------------------------------------- -->
    <div class="mb-4 flex flex-wrap items-center gap-4">
      <!-- Focus mode toggle -->
      <div class="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 p-0.5">
        <button
          onclick={() => { focusMode = 'from'; }}
          data-tip="panel-a-from-selector"
          class={[
            'rounded px-3 py-1 text-xs transition-all',
            focusMode === 'from'
              ? 'bg-indigo-500 text-white'
              : 'text-zinc-400 hover:text-zinc-200',
          ].join(' ')}
        >
          FROM <span class="font-mono opacity-80">{displayToken(tokens[effectiveFocusArrayPos]?.text ?? '')}</span>
        </button>
        <button
          onclick={() => { focusMode = 'to'; }}
          data-tip="panel-a-to-selector"
          class={[
            'rounded px-3 py-1 text-xs transition-all',
            focusMode === 'to'
              ? 'bg-indigo-500 text-white'
              : 'text-zinc-400 hover:text-zinc-200',
          ].join(' ')}
        >
          TO <span class="font-mono opacity-80">{displayToken(tokens[effectiveFocusArrayPos]?.text ?? '')}</span>
        </button>
      </div>

      <!-- Aggregation -->
      <div class="flex items-center gap-2" data-tour="panel-a-agg-selector" data-tip="panel-a-agg-selector">
        <span class="text-[10px] uppercase tracking-widest text-zinc-600">Agg</span>
        <select
          bind:value={aggregation}
          class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-indigo-500 focus:outline-none"
        >
          <option value="max">Max</option>
          <option value="mean">Mean</option>
          <option value="entropy">Entropy</option>
        </select>
      </div>

      <!-- Ablation mode toggle -->
      <div class="flex items-center gap-2 ml-auto" data-tip="ablation-head-toggle">
        <button
          onclick={() => onToggleAblationMode?.(!ablationMode)}
          class={[
            'rounded px-3 py-1 text-xs font-medium transition-colors',
            ablationMode
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
          ].join(' ')}
        >
          {ablationMode ? 'Ablation ON' : 'Ablation'}
        </button>
        {#if ablationMode && ablations.length > 0}
          <button
            onclick={() => onRunAblation?.()}
            disabled={ablateLoading}
            class="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {#if ablateLoading}
              Running...
            {:else}
              Run Ablated ({ablations.length})
            {/if}
          </button>
        {/if}
      </div>
    </div>

    <!-- Ablation results -->
    {#if ablateResponse && ablationMode}
      <div class="mb-4 rounded-lg border border-red-800/50 bg-red-950/20 p-3">
        <h4 class="mb-2 text-xs font-semibold text-red-400">Ablation results</h4>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <p class="mb-1 text-[10px] font-medium text-zinc-500">Original top-5</p>
            {#each ablateResponse.original_predictions.slice(0, 5) as pred (pred.rank)}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="w-5 text-right text-zinc-600">{pred.rank}</span>
                <span class="flex-1 font-mono text-zinc-300">{pred.token}</span>
                <span class="tabular-nums text-zinc-500">{(pred.probability * 100).toFixed(1)}%</span>
              </div>
            {/each}
          </div>
          <div>
            <p class="mb-1 text-[10px] font-medium text-zinc-500">Ablated top-5</p>
            {#each ablateResponse.ablated_predictions.slice(0, 5) as pred (pred.rank)}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="w-5 text-right text-zinc-600">{pred.rank}</span>
                <span class="flex-1 font-mono text-zinc-300">{pred.token}</span>
                <span class="tabular-nums text-zinc-500">{(pred.probability * 100).toFixed(1)}%</span>
              </div>
            {/each}
          </div>
        </div>
        {#if ablateResponse.prediction_delta.length > 0}
          <div class="mt-2 border-t border-red-900/30 pt-2">
            <p class="mb-1 text-[10px] font-medium text-zinc-500">Biggest changes</p>
            {#each ablateResponse.prediction_delta.slice(0, 5) as d}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="flex-1 font-mono text-zinc-300">{d.token}</span>
                <span class="tabular-nums" class:text-red-400={d.delta < 0} class:text-emerald-400={d.delta > 0}>
                  {d.delta > 0 ? '+' : ''}{(d.delta * 100).toFixed(1)}%
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- -----------------------------------------------------------------------
         Overview grid (SVG) or Expanded view (Canvas2D)
         ----------------------------------------------------------------------- -->
    {#if expandedLayer !== null && expandedHead !== null}
      <!-- Expanded Canvas view -->
      <div class="rounded-lg border border-zinc-700 bg-zinc-950 p-4" data-tip="panel-a-head-detail">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <span class="text-sm font-semibold text-zinc-200">
              Layer {expandedLayer} · Head {expandedHead}
            </span>
            <span class="ml-2 text-xs text-zinc-500">
              {tokens.length}×{tokens.length} attention matrix
            </span>
          </div>
          <button
            onclick={closeExpanded}
            class="flex h-6 w-6 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            aria-label="Close expanded view"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 1l12 12M13 1L1 13" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="overflow-auto">
          <canvas bind:this={canvasEl}></canvas>
        </div>
        <div class="mt-3 flex items-center gap-3">
          <span class="text-[10px] text-zinc-600">Rows = query tokens · Cols = key tokens</span>
          <!-- Viridis legend -->
          <div class="ml-auto flex items-center gap-1.5">
            <span class="text-[10px] text-zinc-600">0</span>
            <div class="h-2 w-24 rounded-sm" style="background: linear-gradient(to right, rgb(68,1,84), rgb(49,104,142), rgb(53,183,121), rgb(253,231,37))"></div>
            <span class="text-[10px] text-zinc-600">1</span>
          </div>
        </div>
      </div>
    {:else}
      <!-- SVG Overview grid -->
      <div class="relative" data-tour="panel-a-heatmap" data-tip="panel-a-heatmap">
        <p class="mb-2 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
          Layers × Heads — click a cell to expand
        </p>
        <div class="overflow-x-auto">
          <svg
            width={svgWidth}
            height={svgHeight}
            class="block"
            role="grid"
            aria-label="Attention overview grid"
          >
            <!-- Head labels (top) -->
            {#each { length: nHeads } as _, h}
              <text
                x={LABEL_W + h * (CELL + GAP) + CELL / 2}
                y={LABEL_H - 6}
                text-anchor="middle"
                fill="#71717a"
                style="font-size: 9px; font-family: monospace;"
              >{h}</text>
            {/each}
            <!-- Layer labels (left) -->
            {#each { length: nLayers } as _, l}
              <text
                x={LABEL_W - 6}
                y={LABEL_H + l * (CELL + GAP) + CELL / 2}
                text-anchor="end"
                dominant-baseline="middle"
                fill="#71717a"
                style="font-size: 9px; font-family: monospace;"
              >{l}</text>
            {/each}

            <!-- Cells -->
            {#each { length: nLayers } as _, l}
              {#each { length: nHeads } as _, h}
                {@const val = normalizedGrid[l]?.[h] ?? 0}
                {@const rawVal = rawGrid[l]?.[h] ?? 0}
                {@const cx = LABEL_W + h * (CELL + GAP)}
                {@const cy = LABEL_H + l * (CELL + GAP)}
                {@const isHovered = tooltipLayer === l && tooltipHead === h}
                {@const isAbl = ablationMode && isAblated(l, h)}
                <rect
                  x={cx}
                  y={cy}
                  width={CELL}
                  height={CELL}
                  fill={isAbl ? '#991b1b' : viridis(val)}
                  stroke={isAbl ? '#f87171' : isHovered ? '#6366f1' : 'transparent'}
                  stroke-width={isAbl ? 2 : isHovered ? 2 : 0}
                  rx="2"
                  style="cursor: pointer;"
                  role="gridcell"
                  aria-label={`Layer ${l} Head ${h} value ${rawVal.toFixed(3)}`}
                  onmouseenter={(e) => onCellMouseEnter(l, h, e)}
                  onmouseleave={onCellMouseLeave}
                  onclick={() => { if (ablationMode) { onToggleAblation?.(l, h); } else { onCellClick(l, h); } }}
                />
              {/each}
            {/each}
          </svg>
        </div>

        <!-- Axis labels -->
        <div class="mt-1 flex items-center gap-3">
          <span class="text-[10px] text-zinc-600">← Layers (rows) · Heads (cols) →</span>
          <!-- Viridis legend -->
          <div class="ml-auto flex items-center gap-1.5">
            <span class="text-[10px] text-zinc-600">low</span>
            <div class="h-2 w-20 rounded-sm" style="background: linear-gradient(to right, rgb(68,1,84), rgb(49,104,142), rgb(53,183,121), rgb(253,231,37))"></div>
            <span class="text-[10px] text-zinc-600">high</span>
          </div>
        </div>

        <!-- Tooltip -->
        {#if tooltipLayer !== null && tooltipHead !== null}
          <div
            class="pointer-events-none fixed z-50 rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs shadow-lg"
            style="left: {tooltipX + 40}px; top: {tooltipY - 8}px;"
          >
            <span class="text-zinc-300">L{tooltipLayer} H{tooltipHead}</span>
            <span class="mx-1.5 text-zinc-600">·</span>
            <span class="font-mono text-indigo-300">{(rawGrid[tooltipLayer]?.[tooltipHead] ?? 0).toFixed(4)}</span>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
