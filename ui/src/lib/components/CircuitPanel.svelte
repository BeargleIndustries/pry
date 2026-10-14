<script lang="ts">
  import { pryUi } from '$lib/lessons/registry/pry-state.svelte';
  import Term from './Term.svelte';
  import Readout from './Readout.svelte';
  import type { CircuitResponse, CircuitNode, CircuitEdge } from '$lib/types';
  import { circuitReadout, explainingLabel } from '$lib/readouts';
  import { realWeightsVerified } from '$lib/sidecar';
  import { clampCell, handleGridKey, type GridCell } from '$lib/grid-nav';
  import { NEGATIVE_HEX, POSITIVE_HEX, signedColor, signedHex, signedNumber, signGlyph, signOf } from '$lib/signed-color';
  import { edgeColor, edgeGlyph, edgeWidth, EDGE_POSITIVE_COLOR, EDGE_NEGATIVE_COLOR } from '$lib/edge-style';

  interface Props {
    response: CircuitResponse | null;
    loading?: boolean;
    onRun?: (threshold?: number) => void;
    /**
     * The word whose next-word guess these parts explain: the focused word,
     * the same one Why (DLA) explains (`index` is its token index). The
     * results refetch when the focus changes. Shown as "Explaining the guess
     * after ·she (word 3)".
     */
    targetLabel?: { text: string; index: number } | null;
  }

  let { response, loading = false, onRun, targetLabel = null }: Props = $props();

  // The threshold box lives in the Pry scene state (plan T2b state lift).
  const cs = pryUi.circuit;

  const nodes = $derived(response?.nodes ?? []);

  // Layout: layers as rows (bottom to top), components as columns
  const maxLayer = $derived.by(() => {
    if (nodes.length === 0) return 0;
    return Math.max(...nodes.map((n) => n.layer));
  });

  const maxAbsImportance = $derived.by(() => {
    if (nodes.length === 0) return 1;
    return Math.max(...nodes.map((n) => Math.abs(n.importance)), 0.001);
  });

  // Group nodes by layer
  const layerGroups = $derived.by(() => {
    const groups = new Map<number, CircuitNode[]>();
    for (const n of nodes) {
      const arr = groups.get(n.layer) ?? [];
      arr.push(n);
      groups.set(n.layer, arr);
    }
    return groups;
  });

  // SVG layout constants
  const nodeR = 14;
  const layerHeight = 60;
  const nodeSpacing = 40;
  const padding = 30;

  const maxGroupWidth = $derived.by(() => {
    let maxW = 0;
    for (const [, group] of layerGroups) {
      maxW = Math.max(maxW, group.length * nodeSpacing);
    }
    return maxW;
  });

  const svgWidth = $derived(maxGroupWidth + padding * 2);
  const svgHeight = $derived((maxLayer + 1) * layerHeight + padding * 2);

  // Compute node positions (must be after maxGroupWidth and svgHeight)
  const nodePositions = $derived.by(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (let layer = 0; layer <= maxLayer; layer++) {
      const group = layerGroups.get(layer) ?? [];
      const groupWidth = group.length * nodeSpacing;
      const startX = padding + (maxGroupWidth - groupWidth) / 2;
      group.forEach((n, i) => {
        positions.set(n.id, {
          x: startX + i * nodeSpacing + nodeSpacing / 2,
          y: svgHeight - padding - layer * layerHeight - nodeR,
        });
      });
    }
    return positions;
  });

  let selectedNode = $state<CircuitNode | null>(null);

  // Direct value path edges (T23): signed, in logits of the predicted word.
  const edges = $derived(
    response?.edges_method === 'direct_value_path' ? (response?.edges ?? []) : [],
  );
  const maxAbsEdge = $derived(Math.max(...edges.map((e) => Math.abs(e.weight)), 1e-9));
  const edgeKey = (e: CircuitEdge) => `${e.source}->${e.target}`;
  let activeEdge = $state<string | null>(null);
  // Edges touching the selected part, strongest first (listed in words in its detail box).
  const nodeEdges = $derived(
    selectedNode
      ? edges
          .filter((e) => e.source === selectedNode!.id || e.target === selectedNode!.id)
          .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      : [],
  );
  let selectedEdge = $state<CircuitEdge | null>(null);

  function edgeLabel(e: CircuitEdge): string {
    const dir = e.weight >= 0 ? 'toward' : 'away from';
    return `${e.source} to ${e.target}: ${edgeGlyph(e.weight)}${Math.abs(e.weight).toFixed(3)}, pushes ${dir} the predicted word`;
  }

  function handleRun() {
    const t = cs.thresholdInput.trim() ? parseFloat(cs.thresholdInput) : undefined;
    onRun?.(t);
    selectedNode = null;
    selectedEdge = null;
  }

  // Fill = sign (blue +, orange −, colorblind-safe), opacity and size = |importance|.
  // Shape = type: circles are attention heads, squares are MLPs.
  function nodeColor(n: CircuitNode): string {
    return signedColor(n.importance, maxAbsImportance, 0.35);
  }

  function nodeSize(n: CircuitNode): number {
    const norm = Math.abs(n.importance) / maxAbsImportance;
    return nodeR * 0.5 + nodeR * 0.5 * norm;
  }

  function nodeLabel(n: CircuitNode): string {
    const what = n.type === 'mlp' ? `MLP, layer ${n.layer}` : `Attention head, layer ${n.layer}, head ${n.head}`;
    const s = signOf(n.importance);
    const dir = s === 'positive' ? 'pushed toward the guess' : s === 'negative' ? 'pushed against it' : 'no push';
    return `${what}: direct push ${signedNumber(n.importance, 2)}, ${dir}`;
  }

  // Keyboard model (T29): a roving grid. Rows run top to bottom as drawn
  // (highest layer first); columns are the nodes in that layer, left to right.
  const uid = $props.id();
  const thresholdId = `circuit-threshold-${uid}`;
  const descId = `circuit-desc-${uid}`;
  const legendId = `circuit-legend-${uid}`;
  let svgEl: SVGSVGElement | undefined = $state();
  const gridRows = $derived(
    Array.from({ length: maxLayer + 1 }, (_, r) => layerGroups.get(maxLayer - r) ?? []),
  );
  const gridShape = $derived(gridRows.map((g) => g.length));
  let gridCurrent = $state<GridCell>({ row: 0, col: 0 });
  const tabStop = $derived(clampCell(gridCurrent, gridShape));

  function onNodeKey(e: KeyboardEvent) {
    if (!tabStop) return;
    const next = handleGridKey(e, tabStop, gridShape, svgEl, {
      activate: (c) => {
        selectedNode = gridRows[c.row]?.[c.col] ?? null;
      },
    });
    if (next) gridCurrent = next;
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="circuit-graph"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Key parts</h2>
    <span class="text-xs text-zinc-600">The parts that pushed the guess most, from Why (<Term key="dla">DLA</Term>)</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Finding key parts...
      </span>
    {/if}
  </div>

  <p class="text-xs text-zinc-400">
    These are the <Term key="head">heads</Term> and MLPs that pushed the guess most. Researchers call a set of parts
    like this a <Term key="circuit">circuit</Term>. Lines show only one kind of connection, the
    <Term key="direct-value-path">direct value path</Term>; other ways parts affect each other (like changing where a
    head looks) aren't drawn.
  </p>

  <!-- Controls -->
  <div class="flex items-center gap-3 flex-wrap">
    <label for={thresholdId} class="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Threshold</label>
    <input
      id={thresholdId}
      type="text"
      bind:value={cs.thresholdInput}
      placeholder="auto"
      class="w-16 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
    />
    <span class="text-[10px] text-zinc-500">The <Term key="threshold">cutoff</Term>: parts that push less than this don't show.</span>
    <button
      type="button"
      onclick={handleRun}
      disabled={loading}
      class="ml-auto rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? 'Finding...' : 'Find key parts'}
    </button>
  </div>

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt and this tab fills in on its own, showing which parts mattered most.</p>
    </div>
  {:else if response}
    <Readout text={circuitReadout(response)} />

    <!-- Info -->
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
      <span class="text-zinc-300">{explainingLabel(targetLabel)}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Parts:</span>
      <span class="text-zinc-300">{nodes.length}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Lines (direct value path):</span>
      <span class="text-zinc-300">{edges.length}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Showing parts that pushed at least {response.threshold.toFixed(2)}</span>
    </div>
    {#if !realWeightsVerified(response)}
      <p class="text-[11px] text-amber-400/80">On Gemma these numbers are still being checked against the real model.</p>
    {/if}

    {#if nodes.length === 0}
      <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
        <p class="text-sm text-zinc-600">No part is above the threshold. Lower it and press Find key parts.</p>
      </div>
    {:else}
      <!-- Key parts, one row per layer -->
      <p id={descId} class="text-[10px] text-zinc-500">
        Each row is a <Term key="layer">layer</Term>, highest at the top. Click a part for its numbers; arrow keys move between parts.
      </p>
      <div class="overflow-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
        <svg
          bind:this={svgEl}
          width={svgWidth}
          height={svgHeight}
          viewBox="0 0 {svgWidth} {svgHeight}"
          class="mx-auto"
          role="grid"
          tabindex="-1"
          aria-label="Key parts by layer"
          aria-describedby="{descId} {legendId}"
        >
          <!-- Layer labels (each cell's label already names its layer) -->
          {#each Array(maxLayer + 1) as _, layer}
            <text
              x={8}
              y={svgHeight - padding - layer * layerHeight - nodeR + 4}
              class="fill-zinc-500 text-[9px]"
              aria-hidden="true"
            >
              L{layer}
            </text>
          {/each}

          <!-- Edges: direct value path, colour = sign, width = |weight| -->
          {#each edges as edge (edgeKey(edge))}
            {@const a = nodePositions.get(edge.source)}
            {@const b = nodePositions.get(edge.target)}
            {#if a && b}
              {@const key = edgeKey(edge)}
              {@const shown = activeEdge === key || (selectedEdge !== null && edgeKey(selectedEdge) === key)}
              <!-- Mouse shortcut only: keyboard and screen-reader users get each
                   part's connections in words in its detail box. -->
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <g
                class="cursor-pointer"
                aria-hidden="true"
                onclick={() => { selectedEdge = edge; }}
                onmouseenter={() => { activeEdge = key; }}
                onmouseleave={() => { if (activeEdge === key) activeEdge = null; }}
              >
                <title>{edgeLabel(edge)}</title>
                <!-- wide transparent hit area -->
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" stroke-width={10} />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={edgeColor(edge.weight)}
                  stroke-width={edgeWidth(edge.weight, maxAbsEdge)}
                  stroke-linecap="round"
                  opacity={shown ? 1 : 0.55}
                />
                {#if shown}
                  <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={7} fill="#18181b" stroke={edgeColor(edge.weight)} />
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 + 3.5}
                    text-anchor="middle"
                    class="pointer-events-none text-[10px] font-bold"
                    fill={edgeColor(edge.weight)}
                  >{edgeGlyph(edge.weight)}</text>
                {/if}
              </g>
            {/if}
          {/each}

          <!-- Nodes, one grid row per layer -->
          {#each gridRows as group, r (r)}
            <g role="row" aria-label="Layer {maxLayer - r}">
              {#each group as node, c (node.id)}
                {@const pos = nodePositions.get(node.id)}
                {#if pos}
                  {@const size = nodeSize(node)}
                  {@const isSel = selectedNode?.id === node.id}
                  <g
                    class="group cursor-pointer outline-none"
                    role="gridcell"
                    data-row={r}
                    data-col={c}
                    tabindex={tabStop?.row === r && tabStop?.col === c ? 0 : -1}
                    aria-label={nodeLabel(node)}
                    aria-selected={isSel}
                    onfocus={() => { gridCurrent = { row: r, col: c }; }}
                    onclick={() => { gridCurrent = { row: r, col: c }; selectedNode = node; }}
                    onkeydown={onNodeKey}
                  >
                    {#if node.type === 'mlp'}
                      <rect
                        class="hidden group-focus-visible:inline"
                        x={pos.x - size - 4}
                        y={pos.y - size - 4}
                        width={(size + 4) * 2}
                        height={(size + 4) * 2}
                        rx="3"
                        fill="none"
                        stroke="#fff"
                        stroke-width="2"
                      />
                      <rect
                        x={pos.x - size}
                        y={pos.y - size}
                        width={size * 2}
                        height={size * 2}
                        rx="2"
                        fill={nodeColor(node)}
                        stroke={isSel ? '#fff' : signedHex(node.importance)}
                        stroke-width={isSel ? 2 : 1}
                      />
                    {:else}
                      <circle class="hidden group-focus-visible:inline" cx={pos.x} cy={pos.y} r={size + 4} fill="none" stroke="#fff" stroke-width="2" />
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={size}
                        fill={nodeColor(node)}
                        stroke={isSel ? '#fff' : signedHex(node.importance)}
                        stroke-width={isSel ? 2 : 1}
                      />
                    {/if}
                    <text
                      x={pos.x}
                      y={pos.y + 3}
                      text-anchor="middle"
                      class="pointer-events-none fill-white text-[7px] font-mono"
                      aria-hidden="true"
                    >
                      {node.type === 'mlp' ? 'M' : `${node.head}`}{signGlyph(node.importance)}
                    </text>
                  </g>
                {/if}
              {/each}
            </g>
          {/each}
        </svg>
      </div>

      <!-- Selected node detail -->
      {#if selectedNode}
        <div class="rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-xs">
          <div class="flex items-center gap-3 text-zinc-300">
            <span class="font-mono font-semibold">{selectedNode.id}</span>
            <span class="text-zinc-600">|</span>
            <span class={[
              'rounded px-1.5 py-0.5 text-[9px] font-medium',
              selectedNode.type === 'attention' ? 'bg-indigo-900/40 text-indigo-400' : 'bg-fuchsia-900/40 text-fuchsia-300',
            ].join(' ')}>
              {selectedNode.type === 'attention' ? 'Attention' : 'MLP'}
            </span>
            <span>Layer {selectedNode.layer}{selectedNode.head !== null ? `, head ${selectedNode.head}` : ''}</span>
          </div>
          <div class="mt-1 text-zinc-500">
            Direct push: <span class="font-mono" style="color: {signedHex(selectedNode.importance)};">{signedNumber(selectedNode.importance, 2)}</span> on the guess's score
          </div>
          {#if nodeEdges.length > 0}
            <ul class="mt-1 flex flex-col gap-0.5 text-zinc-400" aria-label="Connections of {selectedNode.id}">
              {#each nodeEdges as e (edgeKey(e))}
                <li>{edgeLabel(e)}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if selectedEdge}
        <div class="rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-xs">
          <div class="flex items-center gap-3 text-zinc-300">
            <span class="font-mono font-semibold">{selectedEdge.source} → {selectedEdge.target}</span>
            <span class="text-zinc-600">|</span>
            <span class="text-zinc-500">direct value path</span>
          </div>
          <div class="mt-1 text-zinc-500">
            Strength: <span class="font-mono" style="color: {edgeColor(selectedEdge.weight)}">{edgeGlyph(selectedEdge.weight)}{Math.abs(selectedEdge.weight).toFixed(2)}</span>
            {selectedEdge.weight >= 0 ? 'toward' : 'away from'} the guessed word
          </div>
        </div>
      {/if}

      <!-- Legend -->
      <div id={legendId} class="flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full border border-zinc-400" aria-hidden="true"></span>
          Circle = attention head
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm border border-zinc-400" aria-hidden="true"></span>
          Square = MLP
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {POSITIVE_HEX};" aria-hidden="true"></span>
          <span aria-hidden="true" class="font-mono font-bold">+</span>
          Blue: pushed toward the guess
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {NEGATIVE_HEX};" aria-hidden="true"></span>
          <span aria-hidden="true" class="font-mono font-bold">−</span>
          Orange: pushed against it
        </span>
        <span>Bigger shape, bigger push</span>
        {#if response?.timing_ms}
          <span class="ml-auto text-zinc-700">
            {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
          </span>
        {/if}
      </div>
      {#if response.edges_method === 'direct_value_path'}
        <div class="flex flex-col gap-1 text-[10px] text-zinc-500">
          <div class="flex flex-wrap items-center gap-4">
            <span class="font-medium text-zinc-400">Lines: direct value path</span>
            <span class="flex items-center gap-1">
              <span class="inline-block h-0.5 w-4" style="background: {EDGE_POSITIVE_COLOR}"></span>
              + toward the predicted word
            </span>
            <span class="flex items-center gap-1">
              <span class="inline-block h-0.5 w-4" style="background: {EDGE_NEGATIVE_COLOR}"></span>
              − away from it
            </span>
            <span>Thicker line, stronger link</span>
          </div>
          <p>Shows how much this part's output, passed straight through the later head's value path, pushes the predicted word. Effects that travel through other parts in between aren't included, and lines only connect the parts shown above the threshold, so big inputs from parts below it are missing.</p>
        </div>
      {/if}
    {/if}
  {/if}
</section>
