<script lang="ts">
  import type { CircuitResponse, CircuitNode, CircuitEdge } from '$lib/types';

  interface Props {
    response: CircuitResponse | null;
    loading?: boolean;
    onRun?: (source: 'dla' | 'patching', threshold?: number) => void;
  }

  let { response, loading = false, onRun }: Props = $props();

  let source = $state<'dla' | 'patching'>('dla');
  let thresholdInput = $state('');

  const nodes = $derived(response?.nodes ?? []);
  const edges = $derived(response?.edges ?? []);

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

  function handleRun() {
    const t = thresholdInput.trim() ? parseFloat(thresholdInput) : undefined;
    onRun?.(source, t);
    selectedNode = null;
  }

  function nodeColor(n: CircuitNode): string {
    if (n.type === 'mlp') return '#d97706'; // amber
    const norm = Math.abs(n.importance) / maxAbsImportance;
    const lightness = 40 + norm * 30;
    return n.importance >= 0
      ? `hsl(234, 89%, ${lightness}%)`  // indigo
      : `hsl(0, 72%, ${lightness}%)`;    // red
  }

  function nodeSize(n: CircuitNode): number {
    const norm = Math.abs(n.importance) / maxAbsImportance;
    return nodeR * 0.5 + nodeR * 0.5 * norm;
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="circuit-graph"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Circuit Graph</h2>
    <span class="text-xs text-zinc-600">Component wiring</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Building graph...
      </span>
    {/if}
  </div>

  <!-- Controls -->
  <div class="flex items-center gap-3 flex-wrap">
    <label class="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Source</label>
    <div class="flex gap-1">
      {#each ['dla', 'patching'] as s (s)}
        <button
          type="button"
          onclick={() => { source = s as 'dla' | 'patching'; }}
          class={[
            'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
            source === s ? 'bg-indigo-950 text-indigo-300' : 'bg-zinc-800 text-zinc-500',
          ].join(' ')}
        >
          {s === 'dla' ? 'DLA' : 'Patching'}
        </button>
      {/each}
    </div>
    <label class="text-[10px] font-medium uppercase tracking-wider text-zinc-500 ml-2">Threshold</label>
    <input
      type="text"
      bind:value={thresholdInput}
      placeholder="auto"
      class="w-16 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
    />
    <button
      type="button"
      onclick={handleRun}
      disabled={loading}
      class="ml-auto rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? 'Building...' : 'Build Circuit'}
    </button>
  </div>

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt first, then build a circuit to see the model's wiring diagram.</p>
    </div>
  {:else if response}
    <!-- Info -->
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
      <span class="text-zinc-500">Nodes:</span>
      <span class="text-zinc-300">{nodes.length}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Edges:</span>
      <span class="text-zinc-300">{edges.length}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Threshold:</span>
      <span class="text-zinc-300">{response.threshold.toFixed(4)}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Source:</span>
      <span class="text-zinc-300">{response.source}</span>
    </div>

    {#if nodes.length === 0}
      <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
        <p class="text-sm text-zinc-600">No components exceed the threshold. Try lowering it.</p>
      </div>
    {:else}
      <!-- SVG Graph -->
      <div class="overflow-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox="0 0 {svgWidth} {svgHeight}"
          class="mx-auto"
        >
          <!-- Edges -->
          {#each edges as edge (edge.source + '-' + edge.target)}
            {@const from = nodePositions.get(edge.source)}
            {@const to = nodePositions.get(edge.target)}
            {#if from && to}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="rgba(148, 163, 184, {Math.min(edge.weight * 2, 0.6)})"
                stroke-width={Math.max(1, edge.weight * 4)}
              />
            {/if}
          {/each}

          <!-- Layer labels -->
          {#each Array(maxLayer + 1) as _, layer}
            <text
              x={8}
              y={svgHeight - padding - layer * layerHeight - nodeR + 4}
              class="fill-zinc-600 text-[9px]"
            >
              L{layer}
            </text>
          {/each}

          <!-- Nodes -->
          {#each nodes as node (node.id)}
            {@const pos = nodePositions.get(node.id)}
            {#if pos}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <g
                class="cursor-pointer"
                onclick={() => { selectedNode = node; }}
                role="button"
                tabindex={0}
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={nodeSize(node)}
                  fill={nodeColor(node)}
                  stroke={selectedNode?.id === node.id ? '#fff' : 'rgba(63,63,70,0.5)'}
                  stroke-width={selectedNode?.id === node.id ? 2 : 1}
                />
                <text
                  x={pos.x}
                  y={pos.y + 3}
                  text-anchor="middle"
                  class="pointer-events-none fill-white text-[7px] font-mono"
                >
                  {node.type === 'mlp' ? 'M' : `${node.head}`}
                </text>
              </g>
            {/if}
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
              selectedNode.type === 'attention' ? 'bg-indigo-950 text-indigo-400' : 'bg-amber-950 text-amber-400',
            ].join(' ')}>
              {selectedNode.type === 'attention' ? 'Attention' : 'MLP'}
            </span>
            <span>Layer {selectedNode.layer}{selectedNode.head !== null ? `, Head ${selectedNode.head}` : ''}</span>
          </div>
          <div class="mt-1 text-zinc-500">
            Importance: <span class="font-mono" class:text-indigo-400={selectedNode.importance >= 0} class:text-red-400={selectedNode.importance < 0}>{selectedNode.importance.toFixed(4)}</span>
          </div>
        </div>
      {/if}

      <!-- Legend -->
      <div class="flex items-center gap-4 text-[10px] text-zinc-600">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full bg-indigo-500"></span>
          Attn head
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full bg-amber-500"></span>
          MLP
        </span>
        <span>Node size = importance magnitude</span>
        {#if response?.timing_ms}
          <span class="ml-auto text-zinc-700">
            {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</section>
