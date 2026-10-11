<script lang="ts">
  import { viridis } from '$lib/viridis';
  import type { GenerateResponse, AblateResponse, HeadScoresResponse } from '$lib/types';
  import {
    HEAD_KIND_LABEL,
    RING_MIN_SCORE,
    headKey,
    ringedHeads,
    ringedList,
    scoreGrid,
    scorePercent,
    splitRepeat,
    type HeadKind,
  } from '$lib/head-scores';
  import {
    FROM_OPTIONS,
    TO_OPTIONS,
    DEFAULT_AGG,
    isValidAgg,
    aggregateHead,
    type Aggregation,
  } from '$lib/attention-agg';
  import { attentionReadout, isStartMarker } from '$lib/readouts';
  import Readout from './Readout.svelte';
  import Term from './Term.svelte';
  import { clampCell, focusGridCell, handleGridKey, type GridCell } from '$lib/grid-nav';
  import { signedHex, signedNumber } from '$lib/signed-color';
  import {
    DEFAULT_GEOMETRY,
    LINE_THRESHOLD,
    buildArcs,
    hiddenCount,
    isFocusArc,
    linesHeight,
  } from '$lib/attention-lines';
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import { tick } from 'svelte';

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

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
    /** Copying-heads (induction) view, T20. */
    headScoresMode?: boolean;
    headScoresResponse?: HeadScoresResponse | null;
    headScoresLoading?: boolean;
    /** The ?demo=induction-heads link is waiting for the model to load before scoring. */
    headScoresWaiting?: boolean;
    onShowHeadScores?: () => void;
    onHideHeadScores?: () => void;
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
    headScoresMode = false,
    headScoresResponse = null,
    headScoresLoading = false,
    headScoresWaiting = false,
    onShowHeadScores,
    onHideHeadScores,
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

  const NOT_DEFINED_MSG = 'Not defined for the first word: it can only look at itself.';

  // The sidecar only keeps attention for the first 64 words of long prompts.
  const ATTENTION_LIMIT = 64;
  const truncated = $derived(response?.attention_truncated === true);
  const focusPastLimit = $derived(truncated && effectiveFocusArrayPos >= ATTENTION_LIMIT);
  const nullCellMsg = $derived(
    focusPastLimit ? `No attention data past the first ${ATTENTION_LIMIT} words.` : NOT_DEFINED_MSG,
  );

  const aggOptions = $derived(focusMode === 'from' ? FROM_OPTIONS : TO_OPTIONS);

  // If the current aggregation isn't valid for this mode, fall back to the default.
  $effect(() => {
    if (!isValidAgg(focusMode, aggregation)) aggregation = DEFAULT_AGG;
  });

  // nLayers x nHeads grid of aggregated values (raw, before normalizing); null = undefined
  const rawGrid = $derived.by<(number | null)[][]>(() => {
    if (!response || nLayers === 0 || nHeads === 0) return [];
    const fi = effectiveFocusArrayPos;
    const grid: (number | null)[][] = [];
    if (focusPastLimit) {
      for (let l = 0; l < nLayers; l++) grid.push(new Array<number | null>(nHeads).fill(null));
      return grid;
    }
    for (let l = 0; l < nLayers; l++) {
      const row: (number | null)[] = [];
      for (let h = 0; h < nHeads; h++) {
        const headMatrix = attention[l]?.heads?.[h];
        row.push(headMatrix ? aggregateHead(headMatrix, fi, focusMode, aggregation) : null);
      }
      grid.push(row);
    }
    return grid;
  });

  // Normalize raw grid to [0, 1] over non-null values only
  const normalizedGrid = $derived.by<number[][]>(() => {
    const g = rawGrid;
    if (g.length === 0) return [];
    let min = Infinity;
    let max = -Infinity;
    for (const row of g) {
      for (const v of row) {
        if (v === null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = max - min;
    return g.map((row) =>
      row.map((v) => (v === null ? 0 : range > 0 ? (v - min) / range : 0.5)),
    );
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

  async function onCellClick(l: number, h: number) {
    gridCurrent = { row: l, col: h };
    expandedLayer = l;
    expandedHead = h;
    // Remember the pick so the lines view shows the same head if the user switches.
    linesPick = { layer: l, head: h };
    // The grid unmounts; move focus into the detail view so keyboard users aren't stranded.
    await tick();
    closeBtn?.focus();
  }

  async function closeExpanded() {
    expandedLayer = null;
    expandedHead = null;
    // Back to the cell that was opened.
    await tick();
    focusGridCell(gridSvg, gridCurrent);
  }

  // ---------------------------------------------------------------------------
  // Keyboard model for the layer x head grid (T29): roving tabindex. One Tab
  // stop; arrows move, Home/End, Ctrl+Home/End; Enter/Space opens the head (or
  // toggles it in ablation mode). Focus shows the same tooltip as hovering.
  // ---------------------------------------------------------------------------

  const uid = $props.id();
  const readoutId = `attn-readout-${uid}`;
  const gridDescId = `attn-grid-desc-${uid}`;
  let gridSvg = $state<SVGSVGElement | null>(null);
  let closeBtn = $state<HTMLButtonElement | null>(null);
  let gridCurrent = $state<GridCell>({ row: 0, col: 0 });
  let gridFocused = $state(false);
  const gridShape = $derived({ rows: nLayers, cols: nHeads });
  const gridTabStop = $derived(clampCell(gridCurrent, gridShape));

  function activateCell(l: number, h: number) {
    if (ablationMode) onToggleAblation?.(l, h);
    else void onCellClick(l, h);
  }

  function onGridKey(e: KeyboardEvent) {
    if (!gridTabStop) return;
    const next = handleGridKey(e, gridTabStop, gridShape, gridSvg, {
      activate: (c) => activateCell(c.row, c.col),
    });
    if (next) gridCurrent = next;
  }

  function onCellFocus(l: number, h: number, e: FocusEvent) {
    gridCurrent = { row: l, col: h };
    gridFocused = true;
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    tooltipLayer = l;
    tooltipHead = h;
    tooltipX = r.x;
    tooltipY = r.y;
  }

  function onCellBlur() {
    gridFocused = false;
    onCellMouseLeave();
  }

  function cellLabel(l: number, h: number, rawVal: number | null): string {
    const base = rawVal === null ? `Layer ${l}, head ${h}: ${nullCellMsg}` : `Layer ${l}, head ${h}: score ${rawVal.toFixed(3)}`;
    if (!ablationMode) return base;
    return `${base}. ${isAblated(l, h) ? 'Knocked out' : 'Not knocked out'}`;
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

  // ---------------------------------------------------------------------------
  // Copying heads (induction) view
  // ---------------------------------------------------------------------------

  const RING_COLOR: Record<HeadKind, string> = { induction: '#f59e0b', previous: '#38bdf8' };

  let headColorBy = $state<HeadKind>('induction');
  const hsRings = $derived(ringedHeads(headScoresResponse));
  const hsGrid = $derived(headScoresResponse ? scoreGrid(headScoresResponse, headColorBy) : []);
  const hsSequence = $derived(headScoresResponse ? splitRepeat(headScoresResponse) : null);
  const hsCopying = $derived(ringedList(headScoresResponse, 'induction'));
  const hsPrevious = $derived(ringedList(headScoresResponse, 'previous'));
  const hsWidth = $derived(LABEL_W + (headScoresResponse?.n_heads ?? 0) * (CELL + GAP));
  const hsHeight = $derived(LABEL_H + (headScoresResponse?.n_layers ?? 0) * (CELL + GAP));

  function seqToken(text: string): string {
    return displayToken(text.replace(/\n/g, '↵'));
  }

  // ---------------------------------------------------------------------------
  // Lines view (T28): the default. The layer x head grid is the "Expert view".
  // ---------------------------------------------------------------------------

  let view = $state<'lines' | 'expert'>('lines');
  // Ablation picks heads on the grid, and the guided tour talks about the grid,
  // so both show the Expert view while they are on.
  const forcedExpert = $derived(ablationMode || tutorialState.open);
  const showExpert = $derived(view === 'expert' || forcedExpert);
  // If forcing the Expert view removed the focused control (the Lines button or
  // a lines-view word), keep keyboard users in place on the Expert view button.
  let expertBtn: HTMLButtonElement | undefined = $state();
  $effect(() => {
    if (!forcedExpert) return;
    queueMicrotask(() => {
      const a = document.activeElement;
      if (!a || a === document.body || (a as HTMLButtonElement).disabled) expertBtn?.focus();
    });
  });

  type HeadPick = { layer: number; head: number };
  /** Head the user picked for the lines view; null = pick automatically. */
  let linesPick = $state<HeadPick | null>(null);

  const validPick = $derived(
    linesPick && linesPick.layer < nLayers && linesPick.head < nHeads ? linesPick : null,
  );

  // Auto: the head the current aggregation scores highest for the focused word,
  // i.e. the brightest cell in the Expert grid. Ties go to the earliest head.
  const autoHead = $derived.by((): HeadPick | null => {
    let best: HeadPick | null = null;
    let bestV = -Infinity;
    for (let l = 0; l < rawGrid.length; l++) {
      for (let h = 0; h < rawGrid[l].length; h++) {
        const v = rawGrid[l][h];
        if (v !== null && v > bestV) {
          bestV = v;
          best = { layer: l, head: h };
        }
      }
    }
    return best;
  });

  const linesHead = $derived<HeadPick>(validPick ?? autoHead ?? { layer: 0, head: 0 });
  const aggLabel = $derived(aggOptions.find((o) => o.id === aggregation)?.label ?? aggregation);

  const LINES_GEOM = DEFAULT_GEOMETRY;
  const linesMatrix = $derived(attention[linesHead.layer]?.heads?.[linesHead.head] ?? []);
  const linesN = $derived(Math.min(tokens.length, linesMatrix.length));
  const linesArcs = $derived(buildArcs(linesMatrix, linesN, LINES_GEOM));
  const linesHidden = $derived(hiddenCount(linesMatrix, linesN));
  const linesFocus = $derived(effectiveFocusArrayPos < linesN ? effectiveFocusArrayPos : -1);
  const focusArcs = $derived(linesArcs.filter((a) => isFocusArc(a, linesFocus, focusMode)));
  const otherArcs = $derived(linesArcs.filter((a) => !isFocusArc(a, linesFocus, focusMode)));
  const linesSvgW = LINES_GEOM.rightX - LINES_GEOM.leftX;
  const linesSvgH = $derived(linesHeight(linesN, LINES_GEOM));
  const linesHeadDesc = $derived(`layer ${linesHead.layer}, head ${linesHead.head}`);

  // Readout follows whatever head is on screen.
  const readoutHead = $derived<HeadPick | null>(
    showExpert
      ? expandedLayer !== null && expandedHead !== null
        ? { layer: expandedLayer, head: expandedHead }
        : null
      : linesHead,
  );

  function setPickLayer(value: string) {
    if (value === 'auto') {
      linesPick = null;
      return;
    }
    linesPick = { layer: Number(value), head: validPick?.head ?? linesHead.head };
  }

  function setPickHead(value: string) {
    if (value === 'auto') {
      linesPick = null;
      return;
    }
    linesPick = { layer: validPick?.layer ?? linesHead.layer, head: Number(value) };
  }

  function weightPct(w: number): string {
    return `${Math.round(w * 100)}%`;
  }

  // Word lists: click or arrow keys move the focus. Left = the word doing the
  // looking (FROM), right = the word being looked at (TO).
  let leftBtns = $state<(HTMLButtonElement | null)[]>([]);
  let rightBtns = $state<(HTMLButtonElement | null)[]>([]);

  function pickLineWord(pos: number, side: 'from' | 'to') {
    const tok = tokens[pos];
    if (!tok) return;
    focusMode = side;
    handleTokenClick(tok.index);
  }

  async function onLineWordKey(e: KeyboardEvent, pos: number, side: 'from' | 'to') {
    let next = pos;
    if (e.key === 'ArrowDown') next = Math.min(linesN - 1, pos + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, pos - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = linesN - 1;
    else return;
    e.preventDefault();
    pickLineWord(next, side);
    await tick();
    (side === 'from' ? leftBtns : rightBtns)[next]?.focus();
  }
</script>

<!-- =========================================================================
     Attention Visualization
     ========================================================================= -->
<div class="rounded-xl border border-zinc-700/60 bg-zinc-900 p-5 shadow-xl">
  <!-- Panel header -->
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-sm font-semibold uppercase tracking-widest text-zinc-400">
      <Term key="attention">Attention</Term>
    </h2>
    <div class="flex items-center gap-2">
      {#if response && !headScoresMode}
        <span class="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500">
          {nLayers}L · {nHeads}H · {tokens.length} tokens
        </span>
      {/if}
      {#if headScoresMode}
        <button
          onclick={() => onHideHeadScores?.()}
          class="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Back to your prompt
        </button>
      {:else}
        <button
          onclick={() => onShowHeadScores?.()}
          data-tip="panel-a-copying-heads"
          title="Find the heads that copy: when a word repeats, they look at what came after it last time."
          class="rounded border border-amber-700/60 px-3 py-1 text-xs text-amber-300 hover:bg-amber-950/40"
        >
          Find copying heads
        </button>
      {/if}
    </div>
  </div>

  {#if headScoresMode}
    <!-- -----------------------------------------------------------------------
         Copying heads (induction heads), T20
         ----------------------------------------------------------------------- -->
    <div>
      <h3 class="mb-2 text-sm font-semibold text-zinc-200"><Term key="induction-head">Copying heads</Term></h3>
      <p class="mb-3 text-xs leading-relaxed text-zinc-400">
        A model can't guess random words. But if the same random words come round a second time, it
        can guess each one, as long as it remembers what came next last time. Some <Term key="attention-head">attention heads</Term> do
        exactly that. To find them, Pry gives the model a test: {headScoresResponse?.repeat_len ?? 25}
        random word-pieces (the chunks the model reads text in), then the same ones again in the same
        order. Then it checks where every head looks during the second time through.
      </p>

      {#if headScoresWaiting && !headScoresResponse}
        <p class="py-8 text-center text-sm text-zinc-500">Waiting for the model to load…</p>
      {:else if headScoresLoading}
        <p class="py-8 text-center text-sm text-zinc-500">Scoring every head…</p>
      {:else if !headScoresResponse}
        <div class="flex flex-col items-center gap-3 py-8">
          <p class="text-sm text-zinc-500">No scores yet.</p>
          <button
            onclick={() => onShowHeadScores?.()}
            class="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
          >
            Score the heads
          </button>
        </div>
      {:else}
        <!-- The test sequence -->
        {#if hsSequence}
          <div class="mb-4 space-y-1.5" data-tip="panel-a-copying-sequence">
            {#each [{ label: 'First time', toks: hsSequence.first }, { label: 'Second time', toks: hsSequence.second }] as row (row.label)}
              <div class="flex items-start gap-2">
                <span class="w-20 flex-shrink-0 pt-0.5 text-[10px] uppercase tracking-widest text-zinc-600">{row.label}</span>
                <div class="flex flex-wrap gap-1">
                  {#each row.toks as t, i (i)}
                    <span class="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">{seqToken(t)}</span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Color-by toggle -->
        <div class="mb-3 flex items-center gap-1 self-start rounded-md border border-zinc-700 bg-zinc-800/60 p-0.5 w-fit">
          {#each [{ id: 'induction', label: 'Copying score' }, { id: 'previous', label: 'Previous-word score' }] as opt (opt.id)}
            <button
              onclick={() => { headColorBy = opt.id as HeadKind; }}
              class={[
                'rounded px-3 py-1 text-xs transition-all',
                headColorBy === opt.id ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              {opt.label}
            </button>
          {/each}
        </div>

        <!-- Head grid with rings -->
        <div class="overflow-x-auto">
          <svg width={hsWidth} height={hsHeight} class="block" role="img" aria-label="Head scores grid">
            {#each { length: headScoresResponse.n_heads } as _, h}
              <text
                x={LABEL_W + h * (CELL + GAP) + CELL / 2}
                y={LABEL_H - 6}
                text-anchor="middle"
                fill="#71717a"
                style="font-size: 9px; font-family: monospace;"
              >{h}</text>
            {/each}
            {#each { length: headScoresResponse.n_layers } as _, l}
              <text
                x={LABEL_W - 6}
                y={LABEL_H + l * (CELL + GAP) + CELL / 2}
                text-anchor="end"
                dominant-baseline="middle"
                fill="#71717a"
                style="font-size: 9px; font-family: monospace;"
              >{l}</text>
            {/each}
            {#each hsGrid as row, l (l)}
              {#each row as v, h (h)}
                {@const ring = hsRings.get(headKey(l, h))}
                {@const s = headScoresResponse.scores.find((x) => x.layer === l && x.head === h)}
                {@const x = LABEL_W + h * (CELL + GAP)}
                {@const y = LABEL_H + l * (CELL + GAP)}
                <!-- Ringed cells are inset so a dark gap separates the ring from bright cells. -->
                <rect
                  x={x + (ring ? 5 : 0)}
                  y={y + (ring ? 5 : 0)}
                  width={ring ? CELL - 10 : CELL}
                  height={ring ? CELL - 10 : CELL}
                  fill={viridis(Math.max(0, Math.min(1, v)))}
                  rx="2"
                >
                  <title>Layer {l} · Head {h}{ring ? ` (${HEAD_KIND_LABEL[ring]})` : ''}: copying {scorePercent(s?.induction ?? 0)}, previous word {scorePercent(s?.previous_token ?? 0)}</title>
                </rect>
                {#if ring}
                  <rect
                    x={x + 1.5}
                    y={y + 1.5}
                    width={CELL - 3}
                    height={CELL - 3}
                    fill="none"
                    stroke={RING_COLOR[ring]}
                    stroke-width="3"
                    rx="4"
                    pointer-events="none"
                  />
                {/if}
              {/each}
            {/each}
          </svg>
        </div>
        <div class="mt-1 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span class="text-[10px] text-zinc-600">← Layers (rows) · Heads (cols) →</span>
          <span class="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <span class="inline-block h-3 w-3 rounded-sm border-[3px]" style="border-color: {RING_COLOR.induction}"></span>
            {HEAD_KIND_LABEL.induction}
          </span>
          <span class="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <span class="inline-block h-3 w-3 rounded-sm border-[3px]" style="border-color: {RING_COLOR.previous}"></span>
            {HEAD_KIND_LABEL.previous}
          </span>
          <div class="ml-auto flex items-center gap-1.5">
            <span class="text-[10px] text-zinc-600">0%</span>
            <div class="h-2 w-20 rounded-sm" style="background: linear-gradient(to right, rgb(68,1,84), rgb(49,104,142), rgb(53,183,121), rgb(253,231,37))"></div>
            <span class="text-[10px] text-zinc-600">100%</span>
          </div>
        </div>

        <!-- Ringed heads, in words -->
        <div class="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p class="mb-1 text-xs font-semibold" style="color: {RING_COLOR.induction}">Copying heads</p>
            <p class="mb-2 text-[11px] leading-snug text-zinc-500">
              The second time through, how much of the head's attention went to the word that came right
              after this word last time.
            </p>
            {#each hsCopying as s (headKey(s.layer, s.head))}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="flex-1 text-zinc-300">Layer {s.layer} · Head {s.head}</span>
                <span class="tabular-nums text-zinc-400">{scorePercent(s.induction)}</span>
              </div>
            {:else}
              <p class="text-[11px] text-zinc-500">No head in this model scored {scorePercent(RING_MIN_SCORE)} or more.</p>
            {/each}
          </div>
          <div>
            <p class="mb-1 text-xs font-semibold" style="color: {RING_COLOR.previous}">Previous-word heads</p>
            <p class="mb-2 text-[11px] leading-snug text-zinc-500">
              How much of the head's attention went to the word just before the current one.
            </p>
            {#each hsPrevious as s (headKey(s.layer, s.head))}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="flex-1 text-zinc-300">Layer {s.layer} · Head {s.head}</span>
                <span class="tabular-nums text-zinc-400">{scorePercent(s.previous_token)}</span>
              </div>
            {:else}
              <p class="text-[11px] text-zinc-500">No head in this model scored {scorePercent(RING_MIN_SCORE)} or more.</p>
            {/each}
          </div>
        </div>

        <p class="text-[11px] leading-relaxed text-zinc-500">
          Heads are ringed when, on average, at least {scorePercent(RING_MIN_SCORE)} of their attention goes
          to that word. Researchers call copying heads "induction heads". They often team up with a
          previous-word head in an earlier layer: that head notes which word came before each word, and
          the copying head uses the note to find where the current word showed up last time, then looks
          one step past it. This is one made-up test, so treat the rings as strong hints, not proof of
          what a head does on ordinary text.
        </p>
      {/if}
    </div>
  {:else if !response}
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
    <!-- Plain-language readout (T21) -->
    <div class="mb-3">
      <Readout
        id={readoutId}
        text={attentionReadout(
          response,
          effectiveFocusArrayPos,
          readoutHead,
          focusMode,
        )}
      />
      {#if isStartMarker(tokens[0]?.text ?? '')}
        <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">
          The first token, {displayToken(tokens[0].text)}, is the model's
          <Term key="attention-sink">start-of-text marker</Term>, not a word you typed. It is often bright.
        </p>
      {/if}
    </div>
    {#if truncated}
      <p class="mb-3 rounded border border-amber-800/60 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-300">
        Showing the first {ATTENTION_LIMIT} words. Pry only keeps attention for the start of long prompts{focusPastLimit ? ', so the word you picked is past the cutoff' : ''}.
      </p>
    {/if}
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
              truncated && tokens.indexOf(token) >= ATTENTION_LIMIT ? 'opacity-40' : '',
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
      <!-- View toggle (T28): Lines (default) or the layer x head grid -->
      <div
        class="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 p-0.5"
        role="group"
        aria-label="Attention view"
      >
        <button
          onclick={() => { view = 'lines'; }}
          disabled={forcedExpert}
          aria-pressed={!showExpert}
          title={forcedExpert
            ? ablationMode
              ? 'Turn ablation off to see the lines view. Ablation picks heads on the grid.'
              : 'The tour uses the Expert view.'
            : 'Lines from each word to the earlier words it looks at.'}
          class={[
            'rounded px-3 py-1 text-xs transition-all disabled:cursor-not-allowed disabled:opacity-50',
            !showExpert ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-200',
          ].join(' ')}
        >
          Lines
        </button>
        <button
          bind:this={expertBtn}
          onclick={() => { view = 'expert'; }}
          aria-pressed={showExpert}
          title="Every layer and head at once, one cell each."
          class={[
            'rounded px-3 py-1 text-xs transition-all',
            showExpert ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-200',
          ].join(' ')}
        >
          Expert view
        </button>
      </div>

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
          {#each aggOptions as opt (opt.id)}
            <option value={opt.id}>{opt.label}</option>
          {/each}
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
                <span class="tabular-nums" style="color: {d.delta === 0 ? '#a1a1aa' : signedHex(d.delta)};">
                  {signedNumber(d.delta * 100, 1)}%
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
    {#if !showExpert}
      <!-- Lines view (T28), the default -->
      {@const focusWord = linesFocus >= 0 ? `"${displayToken(tokens[linesFocus]?.text ?? '')}"` : 'this word'}
      <div data-tip="panel-a-lines">
        <!-- Head picker -->
        <div class="mb-2 flex flex-wrap items-center gap-3 text-xs">
          <label class="flex items-center gap-1.5 text-zinc-500">
            <span class="text-[10px] uppercase tracking-widest text-zinc-600">Layer</span>
            <select
              value={validPick ? String(validPick.layer) : 'auto'}
              onchange={(e) => setPickLayer(e.currentTarget.value)}
              class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-indigo-500 focus:outline-none"
            >
              <option value="auto">Auto</option>
              {#each { length: nLayers } as _, l (l)}
                <option value={String(l)}>{l}</option>
              {/each}
            </select>
          </label>
          <label class="flex items-center gap-1.5 text-zinc-500">
            <span class="text-[10px] uppercase tracking-widest text-zinc-600">Head</span>
            <select
              value={validPick ? String(validPick.head) : 'auto'}
              onchange={(e) => setPickHead(e.currentTarget.value)}
              class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-indigo-500 focus:outline-none"
            >
              <option value="auto">Auto</option>
              {#each { length: nHeads } as _, h (h)}
                <option value={String(h)}>{h}</option>
              {/each}
            </select>
          </label>
        </div>
        <p class="mb-3 text-[11px] leading-relaxed text-zinc-500">
          {#if validPick}
            Showing layer {linesHead.layer}, head {linesHead.head}. Set Layer or Head to Auto to let Pry pick.
          {:else if autoHead}
            Showing layer {linesHead.layer}, head {linesHead.head}: the head with the highest "{aggLabel}"
            score for {focusWord} (the brightest cell in the Expert view). Change the Agg question or pick a head.
          {:else}
            No head has a "{aggLabel}" score for {focusWord}, so this shows layer 0, head 0. Pick a head above.
          {/if}
        </p>

        <div class="overflow-x-auto">
          <div class="w-fit">
            <!-- Column headings -->
            <div class="mb-1 flex items-end gap-2 text-[10px] uppercase tracking-widest text-zinc-600">
              <span class="w-28 text-right">This word…</span>
              <span style="width: {linesSvgW}px"></span>
              <span class="w-28">…looks at these</span>
            </div>
            <div class="flex items-start gap-2">
              <!-- Left: the word doing the looking -->
              <div class="flex w-28 flex-col items-end" role="group" aria-label="Words doing the looking. Use the up and down arrow keys to move.">
                {#each { length: linesN } as _, i (i)}
                  {@const word = displayToken(tokens[i]?.text ?? '')}
                  {@const on = i === linesFocus && focusMode === 'from'}
                  <button
                    bind:this={leftBtns[i]}
                    onclick={() => pickLineWord(i, 'from')}
                    onkeydown={(e) => onLineWordKey(e, i, 'from')}
                    tabindex={i === Math.max(0, linesFocus) ? 0 : -1}
                    aria-pressed={on}
                    aria-label={`"${word}", word ${i + 1}. Show the words it looks at.`}
                    title={word}
                    style="height: {LINES_GEOM.rowHeight}px"
                    class={[
                      'max-w-full truncate rounded px-1.5 font-mono text-[11px] leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                      on
                        ? 'bg-indigo-500/25 text-indigo-200'
                        : i === linesFocus
                          ? 'text-zinc-200'
                          : 'text-zinc-400 hover:text-zinc-100',
                    ].join(' ')}
                  >
                    {word}
                  </button>
                {/each}
              </div>

              <svg
                width={linesSvgW}
                height={linesSvgH}
                viewBox="0 0 {linesSvgW} {linesSvgH}"
                class="block flex-shrink-0"
                role="img"
                aria-describedby={readoutId}
                aria-label={`Attention lines for ${linesHeadDesc}. Each word on the left is joined to the earlier words it looks at on the right; darker lines mean more attention. ${linesArcs.length} lines shown, ${linesHidden} under ${weightPct(LINE_THRESHOLD)} hidden.`}
              >
                {#each otherArcs as a (`${a.from}-${a.to}`)}
                  <line
                    x1={a.x1}
                    y1={a.y1}
                    x2={a.x2}
                    y2={a.y2}
                    stroke="#a1a1aa"
                    stroke-opacity={a.opacity * 0.3}
                    stroke-width="1.5"
                    pointer-events="none"
                  />
                {/each}
                {#each focusArcs as a (`${a.from}-${a.to}`)}
                  <line
                    x1={a.x1}
                    y1={a.y1}
                    x2={a.x2}
                    y2={a.y2}
                    stroke="#818cf8"
                    stroke-opacity={a.opacity}
                    stroke-width="2.5"
                    stroke-linecap="round"
                  >
                    <title>"{displayToken(tokens[a.from]?.text ?? '')}" looks at "{displayToken(tokens[a.to]?.text ?? '')}": {weightPct(a.weight)}</title>
                  </line>
                {/each}
              </svg>

              <!-- Right: the word being looked at -->
              <div class="flex w-28 flex-col items-start" role="group" aria-label="Words being looked at. Use the up and down arrow keys to move.">
                {#each { length: linesN } as _, i (i)}
                  {@const word = displayToken(tokens[i]?.text ?? '')}
                  {@const on = i === linesFocus && focusMode === 'to'}
                  <button
                    bind:this={rightBtns[i]}
                    onclick={() => pickLineWord(i, 'to')}
                    onkeydown={(e) => onLineWordKey(e, i, 'to')}
                    tabindex={i === Math.max(0, linesFocus) ? 0 : -1}
                    aria-pressed={on}
                    aria-label={`"${word}", word ${i + 1}. Show the words that look at it.`}
                    title={word}
                    style="height: {LINES_GEOM.rowHeight}px"
                    class={[
                      'max-w-full truncate rounded px-1.5 font-mono text-[11px] leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
                      on
                        ? 'bg-indigo-500/25 text-indigo-200'
                        : i === linesFocus
                          ? 'text-zinc-200'
                          : 'text-zinc-400 hover:text-zinc-100',
                    ].join(' ')}
                  >
                    {word}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>

        <!-- Legend -->
        <div class="mt-3 space-y-1 text-[11px] leading-relaxed text-zinc-500">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span class="flex items-center gap-1.5">
              <svg width="28" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="28" y2="4" stroke="#818cf8" stroke-opacity="0.15" stroke-width="2.5" />
              </svg>
              little attention
            </span>
            <span class="flex items-center gap-1.5">
              <svg width="28" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="28" y2="4" stroke="#818cf8" stroke-opacity="0.9" stroke-width="2.5" />
              </svg>
              the most attention in this head
            </span>
          </div>
          <p>
            Highlighted: the lines {focusMode === 'from' ? `from ${focusWord} to the words it looks at` : `into ${focusWord} from the words that look at it`}.
            Click a word, or use the arrow keys, to move. A word can only look at itself and words before it.
            Lines under {weightPct(LINE_THRESHOLD)} of a word's attention are hidden ({linesHidden} hidden).
          </p>
        </div>
      </div>
    {:else if expandedLayer !== null && expandedHead !== null}
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
            bind:this={closeBtn}
            onclick={closeExpanded}
            class="flex h-6 w-6 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            aria-label="Close expanded view"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 1l12 12M13 1L1 13" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div
          class="overflow-auto"
          role="img"
          aria-label={`Attention matrix for layer ${expandedLayer}, head ${expandedHead}: ${tokens.length} rows of words doing the looking by ${tokens.length} columns of words being looked at. Brighter means more attention.`}
          aria-describedby={readoutId}
        >
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
        <p id={gridDescId} class="mb-2 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
          Layers × Heads — click a cell to expand<span class="sr-only">. Arrow keys move between cells; Enter {ablationMode ? 'knocks the head out or puts it back' : 'opens the head'}.</span>
        </p>
        <div class="overflow-x-auto">
          <svg
            bind:this={gridSvg}
            width={svgWidth}
            height={svgHeight}
            class="block"
            role="grid"
            tabindex="-1"
            aria-multiselectable={ablationMode}
            aria-label="Attention overview grid, layer by head"
            aria-describedby="{readoutId} {gridDescId}"
          >
            <!-- Head labels (top); each cell's label already names its layer and head -->
            {#each { length: nHeads } as _, h}
              <text
                aria-hidden="true"
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
                aria-hidden="true"
                x={LABEL_W - 6}
                y={LABEL_H + l * (CELL + GAP) + CELL / 2}
                text-anchor="end"
                dominant-baseline="middle"
                fill="#71717a"
                style="font-size: 9px; font-family: monospace;"
              >{l}</text>
            {/each}

            <!-- Cells: one grid row per layer -->
            {#each { length: nLayers } as _, l}
              <g role="row">
              {#each { length: nHeads } as _, h}
                {@const val = normalizedGrid[l]?.[h] ?? 0}
                {@const rawVal = rawGrid[l]?.[h] ?? null}
                {@const cx = LABEL_W + h * (CELL + GAP)}
                {@const cy = LABEL_H + l * (CELL + GAP)}
                {@const isHovered = tooltipLayer === l && tooltipHead === h}
                {@const isAbl = ablationMode && isAblated(l, h)}
                {@const isTabStop = gridTabStop?.row === l && gridTabStop?.col === h}
                {@const isFocused = gridFocused && isTabStop}
                <rect
                  x={cx}
                  y={cy}
                  width={CELL}
                  height={CELL}
                  fill={isAbl ? '#991b1b' : rawVal === null ? '#3f3f46' : viridis(val)}
                  stroke={isFocused ? '#ffffff' : isAbl ? '#f87171' : isHovered ? '#6366f1' : 'transparent'}
                  stroke-width={isFocused || isAbl || isHovered ? 2 : 0}
                  rx="2"
                  style="cursor: pointer; outline: none;"
                  role="gridcell"
                  tabindex={isTabStop ? 0 : -1}
                  data-row={l}
                  data-col={h}
                  aria-selected={ablationMode ? isAbl : expandedLayer === l && expandedHead === h}
                  aria-label={cellLabel(l, h, rawVal)}
                  onmouseenter={(e) => onCellMouseEnter(l, h, e)}
                  onmouseleave={onCellMouseLeave}
                  onfocus={(e) => onCellFocus(l, h, e)}
                  onblur={onCellBlur}
                  onkeydown={onGridKey}
                  onclick={() => activateCell(l, h)}
                />
                {#if isAbl}
                  <!-- Non-colour cue for knocked-out heads -->
                  <text
                    aria-hidden="true"
                    x={cx + CELL / 2}
                    y={cy + CELL / 2}
                    text-anchor="middle"
                    dominant-baseline="central"
                    fill="#fecaca"
                    pointer-events="none"
                    style="font-size: 12px; font-weight: 700;"
                  >×</text>
                {/if}
              {/each}
              </g>
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
          {@const tv = rawGrid[tooltipLayer]?.[tooltipHead] ?? null}
          <div
            class="pointer-events-none fixed z-50 rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs shadow-lg"
            style="left: {tooltipX + 40}px; top: {tooltipY - 8}px;"
          >
            <span class="text-zinc-300">L{tooltipLayer} H{tooltipHead}</span>
            <span class="mx-1.5 text-zinc-600">·</span>
            <span class="font-mono text-indigo-300">{tv === null ? nullCellMsg : tv.toFixed(4)}</span>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
