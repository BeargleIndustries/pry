<script lang="ts">
  import type { GenerateResponse, TokenFeatures, AblateResponse } from '$lib/types';
  import FeatureCard from './FeatureCard.svelte';

  interface Props {
    response: GenerateResponse | null;
    focusTokenIndex?: number;
    onTokenFocus?: (index: number) => void;
    showTokenStrip?: boolean;
    availableSaeLayers?: number[];
    currentSaeLayer?: number;
    onLayerChange?: (layer: number) => void;
    layerSwitching?: boolean;
    ablationMode?: boolean;
    featureAblations?: { feature_index: number; layer: number }[];
    ablateResponse?: AblateResponse | null;
    ablateLoading?: boolean;
    onToggleFeatureAblation?: (featureIndex: number, layer: number) => void;
    onRunFeatureAblation?: () => void;
    onToggleAblationMode?: (active: boolean) => void;
  }

  let {
    response,
    focusTokenIndex,
    onTokenFocus,
    showTokenStrip = true,
    availableSaeLayers = [],
    currentSaeLayer,
    onLayerChange,
    layerSwitching = false,
    ablationMode = false,
    featureAblations = [],
    ablateResponse = null,
    ablateLoading = false,
    onToggleFeatureAblation,
    onRunFeatureAblation,
    onToggleAblationMode,
  }: Props = $props();

  function isFeatureAblated(featureIndex: number): boolean {
    return featureAblations.some((a) => a.feature_index === featureIndex);
  }

  // Default focus to last token when response arrives and no external focus set
  let internalFocusIndex = $state<number | null>(null);

  const resolvedFocusIndex = $derived.by((): number | null => {
    if (response === null) return null;
    // External prop takes precedence if provided
    if (focusTokenIndex !== undefined) return focusTokenIndex;
    // Internal selection
    if (internalFocusIndex !== null) return internalFocusIndex;
    // C1 fix: use token.index (not array position) so the default focus
    // stays correct when tokens[i].index !== i (BOS stripping, offset indexing).
    if (response.tokens.length === 0) return null;
    return response.tokens[response.tokens.length - 1].index;
  });

  const activeFeatures = $derived.by((): TokenFeatures | null => {
    if (!response || resolvedFocusIndex === null) return null;
    const idx = resolvedFocusIndex!;
    return (
      response.sae_features.find((tf) => tf.token_index === idx) ?? null
    );
  });

  const sortedHits = $derived.by(() => {
    if (!activeFeatures) return [];
    return [...activeFeatures.top_k].sort((a, b) => b.activation - a.activation);
  });

  const maxActivation = $derived.by(() => {
    if (sortedHits.length === 0) return 1;
    return sortedHits[0].activation;
  });

  const focusedToken = $derived.by(() => {
    if (!response || resolvedFocusIndex === null) return null;
    return response.tokens.find((t) => t.index === resolvedFocusIndex) ?? null;
  });

  // Per-preset SAE release suffix on Neuronpedia. `-res-jb` is GPT-2-small specific.
  const NEURONPEDIA_SUFFIX: Record<string, string> = {
    'gpt2-small': 'res-jb',
    'pythia-410m': 'res-sm',
    'pythia-1.4b': 'res-sm',
    'gemma-2-2b': 'res-gemma',
    'gemma-2-9b': 'res-gemma',
  };

  const neuronpediaUrlBase = $derived.by(() => {
    if (!response) return 'gpt2-small/8-res-jb';
    const suffix = NEURONPEDIA_SUFFIX[response.preset_id] ?? 'res';
    return `${response.preset_id}/${response.sae_layer_used}-${suffix}`;
  });

  function handleTokenClick(index: number) {
    internalFocusIndex = index;
    onTokenFocus?.(index);
  }

  function displayToken(text: string): string {
    return text.startsWith(' ') ? '·' + text.slice(1) : text;
  }
</script>

<section class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
  <!-- Panel header -->
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Panel B</h2>
    <span class="text-xs text-zinc-600">SAE Feature Explorer</span>
    {#if response}
      {#if availableSaeLayers.length > 1}
        <div class="ml-auto flex items-center gap-1.5" data-tip="panel-b-layer-selector" data-tour="panel-b-layer-selector">
          <span class="text-[10px] uppercase tracking-widest text-zinc-600">Layer</span>
          <select
            value={currentSaeLayer ?? response.sae_layer_used}
            onchange={(e) => {
              const val = parseInt((e.target as HTMLSelectElement).value, 10);
              onLayerChange?.(val);
            }}
            disabled={layerSwitching}
            class="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          >
            {#each availableSaeLayers as layer}
              <option value={layer}>{layer}</option>
            {/each}
          </select>
          {#if layerSwitching}
            <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"></span>
          {/if}
        </div>
      {:else}
        <span class="ml-auto text-xs text-zinc-600">
          layer {response.sae_layer_used}
        </span>
      {/if}

      <!-- Ablation mode toggle -->
      <div class="flex items-center gap-2" data-tip="ablation-feature-toggle">
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
        {#if ablationMode && featureAblations.length > 0}
          <button
            onclick={() => onRunFeatureAblation?.()}
            disabled={ablateLoading}
            class="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {#if ablateLoading}
              Running...
            {:else}
              Run Ablated ({featureAblations.length})
            {/if}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Ablation results -->
  {#if ablateResponse && ablationMode}
    <div class="rounded-lg border border-red-800/50 bg-red-950/20 p-3">
      <h4 class="mb-2 text-xs font-semibold text-red-400">Feature ablation results</h4>
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

  {#if !response}
    <!-- Empty: no response yet -->
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt to see SAE features.</p>
    </div>
  {:else if response.sae_features.length === 0}
    <!-- Empty: no SAE features in response -->
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">No SAE features captured for this run.</p>
    </div>
  {:else}
    <!-- Token strip -->
    {#if showTokenStrip}
    <div data-tour="panel-b-token-strip" data-tip="panel-b-token-strip">
      <p class="mb-2 text-xs text-zinc-600">Click a token to inspect its features:</p>
      <div class="flex flex-wrap gap-1">
        {#each response.tokens as token}
          {@const isActive = resolvedFocusIndex === token.index}
          <button
            class="rounded px-1.5 py-0.5 text-xs font-mono transition-colors
              {isActive
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}"
            onclick={() => handleTokenClick(token.index)}
          >
            {displayToken(token.text)}
          </button>
        {/each}
      </div>
    </div>
    {/if}

    <!-- Feature list for focused token -->
    {#if resolvedFocusIndex !== null}
      {@const label = focusedToken?.text ?? `token ${resolvedFocusIndex}`}
      <div class="flex items-baseline gap-2">
        <span class="text-xs text-zinc-500">
          Features active on
        </span>
        <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-200">
          {label}
        </span>
      </div>

      {#if sortedHits.length === 0}
        <div class="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-6 text-center">
          <p class="text-sm text-zinc-600">No strongly active features on this token.</p>
        </div>
      {:else}
        <div class="flex flex-col gap-3 transition-opacity {layerSwitching ? 'opacity-50 pointer-events-none' : ''}" data-tour="panel-b-features-list">
          {#each sortedHits as hit, i (hit.id)}
            <div data-tip={i === 0 ? 'panel-b-feature-row' : undefined} class="flex items-start gap-2">
              {#if ablationMode}
                <button
                  onclick={() => onToggleFeatureAblation?.(hit.id, response.sae_layer_used)}
                  class={[
                    'mt-2 flex-shrink-0 rounded-full p-1 text-xs transition-colors',
                    isFeatureAblated(hit.id)
                      ? 'bg-red-700 text-white'
                      : 'border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-600',
                  ].join(' ')}
                  title={isFeatureAblated(hit.id) ? 'Remove from ablation' : 'Add to ablation'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3">
                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM5.354 5.354a.5.5 0 0 1 .707 0L8 7.293l1.94-1.94a.5.5 0 0 1 .707.708L8.707 8l1.94 1.94a.5.5 0 0 1-.708.707L8 8.707l-1.94 1.94a.5.5 0 0 1-.707-.708L7.293 8 5.354 6.06a.5.5 0 0 1 0-.707Z"/>
                  </svg>
                </button>
              {/if}
              <div class="flex-1">
                <FeatureCard
                  {hit}
                  maxActivation={maxActivation}
                  layer={response.sae_layer_used}
                  {neuronpediaUrlBase}
                  allTokenFeatures={response.sae_features}
                />
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</section>
