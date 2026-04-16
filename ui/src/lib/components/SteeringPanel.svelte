<script lang="ts">
  import type { GenerateResponse, SteerResponse, FeatureHit } from '$lib/types';

  interface Props {
    response: GenerateResponse | null;
    steerResponse: SteerResponse | null;
    loading: boolean;
    focusTokenIndex?: number;
    currentSaeLayer?: number;
    onSteer?: (featureId: number, saeLayer: number, alpha: number) => void;
  }

  let {
    response,
    steerResponse,
    loading = false,
    focusTokenIndex,
    currentSaeLayer,
    onSteer,
  }: Props = $props();

  // Collect unique features from current response for the picker
  const availableFeatures = $derived.by((): FeatureHit[] => {
    if (!response?.sae_features) return [];
    const seen = new Set<number>();
    const result: FeatureHit[] = [];
    for (const tf of response.sae_features) {
      for (const hit of tf.top_k) {
        if (!seen.has(hit.id)) {
          seen.add(hit.id);
          result.push(hit);
        }
      }
    }
    result.sort((a, b) => b.activation - a.activation);
    return result;
  });

  let selectedFeatureId = $state<number | null>(null);
  let alpha = $state(5.0);

  // Auto-select first feature when available features change
  $effect(() => {
    if (availableFeatures.length > 0 && selectedFeatureId === null) {
      selectedFeatureId = availableFeatures[0].id;
    }
  });

  const selectedFeature = $derived(
    availableFeatures.find((f) => f.id === selectedFeatureId) ?? null,
  );

  function handleRun() {
    if (selectedFeatureId === null || currentSaeLayer === undefined) return;
    onSteer?.(selectedFeatureId, currentSaeLayer, alpha);
  }

  // Diff highlighting helper: find tokens that differ between two strings
  function tokenizeDiff(
    orig: string,
    steered: string,
  ): { origTokens: { text: string; changed: boolean }[]; steeredTokens: { text: string; changed: boolean }[] } {
    const oWords = orig.split(/(\s+)/);
    const sWords = steered.split(/(\s+)/);
    const maxLen = Math.max(oWords.length, sWords.length);
    const origTokens: { text: string; changed: boolean }[] = [];
    const steeredTokens: { text: string; changed: boolean }[] = [];
    for (let i = 0; i < maxLen; i++) {
      const oW = oWords[i] ?? '';
      const sW = sWords[i] ?? '';
      const changed = oW !== sW;
      if (i < oWords.length) origTokens.push({ text: oW, changed });
      if (i < sWords.length) steeredTokens.push({ text: sW, changed });
    }
    return { origTokens, steeredTokens };
  }

  const diff = $derived(
    steerResponse
      ? tokenizeDiff(steerResponse.original_generation, steerResponse.steered_generation)
      : null,
  );

  const highAlphaWarning = $derived(Math.abs(alpha) > 15);
</script>

<div class="flex flex-col gap-4" data-tip="steering-panel">
  {#if !response}
    <div class="flex flex-col items-center justify-center py-12 text-zinc-500">
      <p class="text-sm">Run a prompt first to see available features for steering.</p>
    </div>
  {:else}
    <!-- Feature picker -->
    <div class="flex flex-col gap-2">
      <label class="text-xs font-medium text-zinc-400">Feature</label>
      <select
        bind:value={selectedFeatureId}
        class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
      >
        {#each availableFeatures as feat (feat.id)}
          <option value={feat.id}>
            #{feat.id} {feat.description ? `- ${feat.description}` : ''} (act: {feat.activation.toFixed(2)})
          </option>
        {/each}
      </select>
      {#if selectedFeature?.description}
        <p class="text-xs text-zinc-500">{selectedFeature.description}</p>
      {/if}
    </div>

    <!-- Alpha slider -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <label class="text-xs font-medium text-zinc-400">Steering strength</label>
        <span class="text-xs tabular-nums text-zinc-300">{alpha.toFixed(1)}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-zinc-600">Suppress</span>
        <input
          type="range"
          min="-30"
          max="30"
          step="0.5"
          bind:value={alpha}
          class="flex-1 accent-indigo-500"
        />
        <span class="text-[10px] text-zinc-600">Amplify</span>
      </div>
      {#if highAlphaWarning}
        <p class="text-[10px] text-amber-500">High steering values may produce degenerate text.</p>
      {/if}
    </div>

    <!-- Run button -->
    <button
      onclick={handleRun}
      disabled={loading || selectedFeatureId === null}
      class="rounded bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {#if loading}
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
          Steering...
        </span>
      {:else}
        Run Steered
      {/if}
    </button>

    <!-- Results: side-by-side comparison -->
    {#if steerResponse}
      <div class="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <!-- Original -->
        <div class="flex flex-col gap-1.5">
          <h4 class="text-xs font-semibold text-zinc-400">Original</h4>
          <div class="rounded bg-zinc-950 p-2 text-sm text-zinc-300 leading-relaxed">
            {#if diff}
              {#each diff.origTokens as tok}
                <span class={tok.changed ? 'bg-red-900/40 text-red-300' : ''}>{tok.text}</span>
              {/each}
            {:else}
              {steerResponse.original_generation}
            {/if}
          </div>
          <!-- Original top predictions -->
          <div class="mt-1">
            <p class="mb-1 text-[10px] font-medium text-zinc-500">Top predictions</p>
            {#each steerResponse.original_top_predictions.slice(0, 5) as pred (pred.rank)}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="w-5 text-right text-zinc-600">{pred.rank}</span>
                <span class="flex-1 font-mono text-zinc-300">{pred.token}</span>
                <span class="tabular-nums text-zinc-500">{(pred.probability * 100).toFixed(1)}%</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Steered -->
        <div class="flex flex-col gap-1.5">
          <h4 class="text-xs font-semibold text-indigo-400">
            Steered (alpha={steerResponse.alpha})
          </h4>
          <div class="rounded bg-zinc-950 p-2 text-sm text-zinc-300 leading-relaxed">
            {#if diff}
              {#each diff.steeredTokens as tok}
                <span class={tok.changed ? 'bg-indigo-900/40 text-indigo-300' : ''}>{tok.text}</span>
              {/each}
            {:else}
              {steerResponse.steered_generation}
            {/if}
          </div>
          <!-- Steered top predictions -->
          <div class="mt-1">
            <p class="mb-1 text-[10px] font-medium text-zinc-500">Top predictions</p>
            {#each steerResponse.steered_top_predictions.slice(0, 5) as pred (pred.rank)}
              <div class="flex items-center gap-2 text-[11px]">
                <span class="w-5 text-right text-zinc-600">{pred.rank}</span>
                <span class="flex-1 font-mono text-zinc-300">{pred.token}</span>
                <span class="tabular-nums text-zinc-500">{(pred.probability * 100).toFixed(1)}%</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
