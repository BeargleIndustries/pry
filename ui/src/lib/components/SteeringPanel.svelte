<script lang="ts">
  import type { GenerateResponse, SteerResponse, FeatureHit } from '$lib/types';
  import { diffTokens } from '$lib/token-diff';
  import { searchConcepts, SidecarError } from '$lib/sidecar';
  import {
    NEURONPEDIA_NOTICE,
    isNeuronpediaUnavailable,
    queryProblem,
    showToken,
    similarityLabel,
    type ConceptHit,
    type ConceptSearchResult,
  } from '$lib/concept-search';

  interface Props {
    response: GenerateResponse | null;
    steerResponse: SteerResponse | null;
    loading: boolean;
    focusTokenIndex?: number;
    currentSaeLayer?: number;
    onSteer?: (featureId: number, saeLayer: number, alpha: number) => void;
    /** Changing this value clears the selected feature (e.g. after an SAE layer switch). */
    resetKey?: number;
  }

  let {
    response,
    steerResponse,
    loading = false,
    focusTokenIndex,
    currentSaeLayer,
    onSteer,
    resetKey = 0,
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

  // --- Concept search (T24): any feature of the loaded SAE, found by label ---
  let conceptQuery = $state('');
  let searching = $state(false);
  let conceptResult = $state<ConceptSearchResult | null>(null);
  let conceptError = $state<string | null>(null);
  /** Neuronpedia unreachable or no labels for this model: search is switched off. */
  let searchOff = $state<string | null>(null);
  /** A searched feature picked for steering; overrides the dropdown while set. */
  let concept = $state<ConceptHit | null>(null);

  const queryIssue = $derived(queryProblem(conceptQuery));

  async function runConceptSearch(e?: SubmitEvent) {
    e?.preventDefault();
    if (searching || searchOff || queryIssue) return;
    searching = true;
    conceptError = null;
    try {
      const res = await searchConcepts(conceptQuery, response?.preset_id);
      if (res.status === 'no_coverage') {
        searchOff = "This model's features have no Neuronpedia labels, so concept search isn't available for it.";
        conceptResult = null;
      } else {
        conceptResult = res;
      }
    } catch (err) {
      const se = err instanceof SidecarError ? err : null;
      if (isNeuronpediaUnavailable(se)) {
        searchOff = se!.message;
      } else {
        conceptError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      searching = false;
    }
  }

  function pickConcept(hit: ConceptHit) {
    concept = hit;
  }

  // Clear the selection whenever the parent bumps resetKey.
  $effect(() => {
    void resetKey;
    selectedFeatureId = null;
    concept = null;
    conceptResult = null;
  });

  // Auto-select first feature when available features change; drop a
  // selection that is no longer in the list (e.g. new prompt or SAE layer).
  $effect(() => {
    if (selectedFeatureId !== null && !availableFeatures.some((f) => f.id === selectedFeatureId)) {
      selectedFeatureId = null;
    }
    if (availableFeatures.length > 0 && selectedFeatureId === null) {
      selectedFeatureId = availableFeatures[0].id;
    }
  });

  const selectedFeature = $derived(
    availableFeatures.find((f) => f.id === selectedFeatureId) ?? null,
  );

  /** Searched results belong to the layer they were searched on. */
  const conceptUsable = $derived(
    concept !== null && conceptResult !== null && conceptResult.sae_layer === currentSaeLayer,
  );
  const steerFeatureId = $derived(conceptUsable ? concept!.feature_id : selectedFeatureId);

  function handleRun() {
    if (steerFeatureId === null || currentSaeLayer === undefined) return;
    onSteer?.(steerFeatureId, currentSaeLayer, alpha);
  }

  // Generations are continuation-only (the server strips the prompt); the
  // prompt is echoed dimmed in front of each and the diff covers only the
  // continuations.
  const diff = $derived(
    steerResponse
      ? diffTokens(steerResponse.original_generation, steerResponse.steered_generation)
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
    <!-- Concept search (T24) -->
    <div class="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <label for="concept-query" class="text-xs font-medium text-zinc-400">Find a concept</label>
      <p class="text-[11px] leading-snug text-amber-400/80">{NEURONPEDIA_NOTICE}</p>
      {#if searchOff}
        <div class="flex items-start gap-2 text-xs text-zinc-400">
          <p class="flex-1">{searchOff}</p>
          <button
            type="button"
            class="shrink-0 text-indigo-400 hover:text-indigo-300"
            onclick={() => { searchOff = null; }}
          >Try again</button>
        </div>
      {/if}
      <form class="flex gap-2" onsubmit={runConceptSearch}>
        <input
          id="concept-query"
          type="text"
          bind:value={conceptQuery}
          maxlength="200"
          placeholder="e.g. the ocean, anger, French"
          disabled={searchOff !== null}
          class="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={searching || searchOff !== null || queryIssue !== null}
          title={queryIssue ?? undefined}
          class="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >{searching ? 'Searching...' : 'Search Neuronpedia'}</button>
      </form>
      {#if conceptError}
        <p class="text-xs text-red-400">{conceptError}</p>
      {/if}
      {#if conceptResult}
        {#if conceptResult.results.length === 0}
          <p class="text-xs text-zinc-500">No labelled features matched "{conceptResult.query}".</p>
        {:else}
          <p class="text-[11px] text-zinc-500">
            Closest labels for "{conceptResult.query}". The search ranks by how similar the words of a
            label are to yours, so there is always a top result, even when nothing really fits. Labels
            were written by another AI and can be wrong.
          </p>
          <ul class="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {#each conceptResult.results as hit (hit.feature_id)}
              <li>
                <button
                  type="button"
                  onclick={() => pickConcept(hit)}
                  class="w-full rounded border px-2 py-1.5 text-left text-xs {concept?.feature_id === hit.feature_id ? 'border-indigo-500 bg-indigo-950/40' : 'border-zinc-800 hover:border-zinc-600'}"
                >
                  <span class="font-mono text-zinc-500">#{hit.feature_id}</span>
                  <span class="text-zinc-200">{hit.description}</span>
                  {#if similarityLabel(hit.similarity)}
                    <span class="text-zinc-500">· {similarityLabel(hit.similarity)}</span>
                  {/if}
                  {#if hit.top_boosted_tokens.length}
                    <span class="block text-[10px] text-zinc-500">
                      Pushes toward: {hit.top_boosted_tokens.map(showToken).join(', ')}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <!-- Feature picker -->
    <div class="flex flex-col gap-2">
      <label class="text-xs font-medium text-zinc-400">Feature</label>
      {#if conceptUsable && concept}
        <div class="flex items-start gap-2 rounded border border-indigo-500/60 bg-indigo-950/30 px-2 py-1.5 text-sm text-zinc-200">
          <span class="flex-1">
            #{concept.feature_id} - {concept.description}
            <span class="block text-[10px] text-zinc-500">
              From your search. This feature may not have fired on your prompt at all; steering adds it anyway.
              Searched features often need a strength of 15-20 before the text changes.
            </span>
          </span>
          <button
            type="button"
            class="shrink-0 text-xs text-zinc-400 hover:text-zinc-200"
            onclick={() => { concept = null; }}
          >Use a feature from my prompt instead</button>
        </div>
      {/if}
      <select
        bind:value={selectedFeatureId}
        onchange={() => { concept = null; }}
        class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none {conceptUsable ? 'opacity-50' : ''}"
      >
        {#each availableFeatures as feat (feat.id)}
          <option value={feat.id}>
            #{feat.id} {feat.description ? `- ${feat.description}` : ''} (act: {feat.activation.toFixed(2)})
          </option>
        {/each}
      </select>
      {#if !conceptUsable && selectedFeature?.description}
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
      disabled={loading || steerFeatureId === null}
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
          <div class="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-sm text-zinc-300 leading-relaxed"><span class="text-zinc-600">{steerResponse.prompt}</span>{#if diff}{#each diff.left as tok}<span class={tok.changed ? 'bg-red-900/40 text-red-300' : ''}>{tok.text}</span>{/each}{:else}{steerResponse.original_generation}{/if}</div>
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
          <div class="whitespace-pre-wrap rounded bg-zinc-950 p-2 text-sm text-zinc-300 leading-relaxed"><span class="text-zinc-600">{steerResponse.prompt}</span>{#if diff}{#each diff.right as tok}<span class={tok.changed ? 'bg-indigo-900/40 text-indigo-300' : ''}>{tok.text}</span>{/each}{:else}{steerResponse.steered_generation}{/if}</div>
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
