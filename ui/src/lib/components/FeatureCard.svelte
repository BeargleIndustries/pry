<script module lang="ts">
  let hatchSeq = 0;
</script>

<script lang="ts">
  import type { FeatureHit, TokenFeatures, PresetDisplay } from '$lib/types';
  import { neuronpediaUrl as buildNeuronpediaUrl } from '$lib/preset-display';
  import { isNamedFeature, labelDetailOf } from '$lib/feature-label';

  interface Props {
    hit: FeatureHit;
    maxActivation: number;
    layer: number;
    /** Loaded preset's display block; no Neuronpedia coverage hides the links. */
    presetDisplay?: PresetDisplay | null;
    /** All token features from the response, used to compute the sparkline. */
    allTokenFeatures?: TokenFeatures[];
  }

  let { hit, maxActivation, layer, presetDisplay = null, allTokenFeatures = [] }: Props = $props();

  let expanded = $state(false);

  const barPct = $derived(maxActivation > 0 ? (hit.activation / maxActivation) * 100 : 0);

  const isNamed = $derived(isNamedFeature(hit));
  const labelDetail = $derived(labelDetailOf(hit));

  const barColor = $derived(
    isNamed ? 'bg-indigo-500' : 'bg-slate-500'
  );

  const snippets = $derived(hit.top_activating_snippets ?? []);
  const previewSnippets = $derived(snippets.slice(0, 5));
  // M4 fix: removed dead `snippets = $derived(snippets)` — use snippets directly.

  const neuronpediaUrl = $derived(buildNeuronpediaUrl(presetDisplay, layer, hit.id));

  // A2: sparkline data — activation of this feature across all token positions.
  // The response only carries each token's top-5 features, so a position
  // where this feature isn't in the top 5 is unknown (null), not zero. Those
  // render hatched.
  const sparklineData = $derived.by((): (number | null)[] => {
    if (allTokenFeatures.length === 0) return [];
    return allTokenFeatures.map((tf) => {
      const match = tf.top_k.find((f) => f.id === hit.id);
      return match ? match.activation : null;
    });
  });

  const sparklineMax = $derived(
    Math.max(...sparklineData.map((v) => v ?? 0), 0.01)
  );
  const hasNotInTopK = $derived(sparklineData.some((v) => v === null));
  const hatchId = `fc-hatch-${hatchSeq++}`;
  // Percent coordinates (no viewBox) keep the hatch pattern undistorted.
  const colPct = $derived(sparklineData.length > 0 ? 100 / sparklineData.length : 0);

  // A3: open external links via Tauri shell plugin, fallback to window.open
  async function openExternal(url: string) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function truncate(s: string, max = 80): string {
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
</script>

<div
  class="group rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-indigo-500/40 cursor-pointer"
  onclick={() => (expanded = !expanded)}
  role="button"
  tabindex="0"
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') expanded = !expanded; }}
>
  <!-- Activation bar + feature id + activation value -->
  <div class="mb-2 flex items-center gap-3">
    <div class="h-2 w-32 shrink-0 overflow-hidden rounded-full bg-zinc-800">
      <div
        class="h-full rounded-full transition-all {barColor}"
        style:width="{barPct}%"
      ></div>
    </div>
    <span class="text-xs font-mono text-zinc-500">feat #{hit.id}</span>
    {#if neuronpediaUrl}
      {@const url = neuronpediaUrl}
      <button
        type="button"
        class="text-xs text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
        data-tip="neuronpedia-link"
        onclick={(e) => { e.stopPropagation(); openExternal(url); }}
      >
        Neuronpedia
      </button>
    {/if}
    <span class="ml-auto text-xs font-mono text-zinc-400">act: {hit.activation.toFixed(1)}</span>
  </div>

  <!-- A2: Activation sparkline across tokens -->
  {#if sparklineData.length > 0}
    <div class="mb-2" data-tip="feature-histogram">
      <svg
        class="h-4 w-full"
        role="img"
        aria-label="Activation sparkline for feature {hit.id}"
      >
        <defs>
          <pattern id={hatchId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" class="fill-zinc-900" />
            <line x1="0" y1="0" x2="0" y2="4" class="stroke-zinc-600" stroke-width="1.5" />
          </pattern>
        </defs>
        {#each sparklineData as val, i}
          {#if val === null}
            <rect x="{i * colPct}%" y="0" width="{colPct * 0.8}%" height="100%" fill="url(#{hatchId})">
              <title>token {i}: not in top 5</title>
            </rect>
          {:else}
            {@const h = val / sparklineMax}
            <rect x="{i * colPct}%" y="{(1 - h) * 100}%" width="{colPct * 0.8}%" height="{h * 100}%" class="fill-indigo-500/70">
              <title>token {i}: {val.toFixed(2)}</title>
            </rect>
          {/if}
        {/each}
      </svg>
      {#if hasNotInTopK}
        <p class="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-600">
          <svg class="h-2 w-3" aria-hidden="true">
            <rect width="100%" height="100%" fill="url(#{hatchId})" />
          </svg>
          not in top 5 for that token
        </p>
      {/if}
    </div>
  {/if}

  <!-- Description subtitle -->
  {#if isNamed && hit.description}
    <p class="mb-2 text-xs text-zinc-300">
      "{hit.description}"
      {#if labelDetail !== 'none'}
        <span class="ml-1 text-zinc-600">· {labelDetail === 'detailed' ? 'detailed label' : 'short label'}</span>
      {/if}
    </p>
  {:else}
    <p class="mb-2 text-xs text-zinc-600 italic">
      unnamed feature #{hit.id}
      {#if snippets.length === 0}— click for activating examples{/if}
    </p>
  {/if}

  <!-- Preview snippets (always visible, up to 5) -->
  {#if previewSnippets.length > 0}
    <ul class="space-y-0.5">
      {#each previewSnippets as snippet}
        <li class="text-xs font-mono text-zinc-400 before:content-['▸_'] before:text-zinc-600">
          {truncate(snippet)}
        </li>
      {/each}
    </ul>
  {:else if !expanded}
    <p class="text-xs text-zinc-600 italic">no activating examples available</p>
  {/if}

  <!-- Expanded detail: full snippet list + links -->
  {#if expanded}
    <div class="mt-3 border-t border-zinc-800 pt-3">
      {#if snippets.length > 5}
        <p class="mb-2 text-xs text-zinc-500">All {snippets.length} activating examples:</p>
        <ul class="space-y-0.5 mb-3">
          {#each snippets as snippet}
            <li class="text-xs font-mono text-zinc-400 before:content-['▸_'] before:text-zinc-600">
              {truncate(snippet, 120)}
            </li>
          {/each}
        </ul>
      {/if}

      <div class="flex items-center gap-4 text-xs text-zinc-600">
        <span>layer {layer}</span>
        {#if neuronpediaUrl}
          {@const url = neuronpediaUrl}
          <span>·</span>
          <button
            type="button"
            class="text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
            onclick={(e) => { e.stopPropagation(); openExternal(url); }}
          >
            Neuronpedia →
          </button>
        {/if}
      </div>
    </div>
  {:else if snippets.length > 5}
    <p class="mt-2 text-xs text-zinc-600">
      see all {snippets.length} activating snippets →
    </p>
  {/if}
</div>
