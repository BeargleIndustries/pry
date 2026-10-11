<script lang="ts">
  import Term from './Term.svelte';
  import type { PatchResponse, PatchComponent } from '$lib/types';
  import {
    patchLengthStatus,
    TOKENIZE_DEBOUNCE_MS,
    type TokenizeResponse,
  } from '$lib/analysis-core';

  interface Props {
    response: PatchResponse | null;
    loading?: boolean;
    onRun?: (cleanPrompt: string, corruptedPrompt: string, patchType: 'head' | 'mlp' | 'resid') => void;
    /** Token counter (`analysis.tokenize`). Without it the counters are hidden and Run isn't gated. */
    tokenize?: (text: string) => Promise<TokenizeResponse | null>;
    /** Pair to pre-fill (experiment cards). Applied on mount and whenever a new object is passed. */
    preset?: { clean: string; corrupted: string; patchType: 'head' | 'mlp' | 'resid' } | null;
  }

  let { response, loading = false, onRun, tokenize, preset = null }: Props = $props();

  // Default pair: indirect object identification (IOI). Same token length in GPT-2.
  const IOI_CLEAN = 'When Mary and John went to the store, John gave a drink to';
  const IOI_CHANGED = 'When Mary and John went to the store, Mary gave a drink to';

  let cleanPrompt = $state(IOI_CLEAN);
  let corruptedPrompt = $state(IOI_CHANGED);
  let patchType = $state<'head' | 'mlp' | 'resid'>('head');
  $effect(() => {
    if (!preset) return;
    cleanPrompt = preset.clean;
    corruptedPrompt = preset.corrupted;
    patchType = preset.patchType;
  });

  // Live token counts, debounced. A sequence number drops stale replies.
  let cleanCount = $state<number | null>(null);
  let corruptedCount = $state<number | null>(null);
  let countSeq = 0;
  $effect(() => {
    const clean = cleanPrompt;
    const changed = corruptedPrompt;
    const tk = tokenize;
    if (!tk) return;
    const seq = ++countSeq;
    const timer = setTimeout(async () => {
      const [a, b] = await Promise.all([tk(clean), tk(changed)]);
      if (seq !== countSeq) return;
      cleanCount = a?.count ?? null;
      corruptedCount = b?.count ?? null;
    }, TOKENIZE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });
  const lengthStatus = $derived(patchLengthStatus(cleanCount, corruptedCount));
  const lengthsDiffer = $derived(lengthStatus !== null && !lengthStatus.same);
  // Key the result view on what the server actually ran, not the live toggle.
  const shownPatchType = $derived(response?.patch_type ?? patchType);

  const components = $derived(response?.components ?? []);

  // For head patching, build a layer x head grid
  const nLayers = $derived.by(() => {
    if (components.length === 0) return 0;
    return Math.max(...components.map((c) => c.layer)) + 1;
  });
  const nHeads = $derived.by(() => {
    if (shownPatchType !== 'head' || components.length === 0) return 0;
    const heads = components.filter((c) => c.head !== null).map((c) => c.head!);
    return heads.length > 0 ? Math.max(...heads) + 1 : 0;
  });

  const maxAbsEffect = $derived.by(() => {
    if (components.length === 0) return 1;
    return Math.max(...components.map((c) => Math.abs(c.effect)), 0.001);
  });

  // Build grid lookup for heatmap
  const gridLookup = $derived.by(() => {
    const map = new Map<string, PatchComponent>();
    for (const c of components) {
      map.set(c.position != null ? `${c.layer}-p${c.position}` : `${c.layer}-${c.head ?? 'mlp'}`, c);
    }
    return map;
  });

  // Residual patching: layer (rows) x word position (columns).
  const residTokens = $derived(
    shownPatchType === 'resid' && components.some((c) => c.position != null) ? (response?.tokens ?? []) : [],
  );

  let selectedComponent = $state<PatchComponent | null>(null);

  function handleRun() {
    onRun?.(cleanPrompt, corruptedPrompt, patchType);
    selectedComponent = null;
  }

  function cellColor(effect: number): string {
    const norm = Math.abs(effect) / maxAbsEffect;
    const alpha = Math.min(norm, 1);
    if (effect >= 0) {
      return `rgba(99, 102, 241, ${alpha})`; // indigo for positive (restores clean)
    }
    return `rgba(239, 68, 68, ${alpha})`; // red for negative
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="patching-panel"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100"><Term key="activation-patching">Activation Patching</Term></h2>
    <span class="text-xs text-zinc-600">Causal importance</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Patching...
      </span>
    {/if}
  </div>

  <!-- Inputs -->
  <div class="flex flex-col gap-2">
    <div class="flex flex-col gap-1">
      <label class="text-[10px] font-medium uppercase tracking-wider text-zinc-500" for="patch-clean">Original prompt</label>
      <input
        id="patch-clean"
        type="text"
        bind:value={cleanPrompt}
        placeholder={IOI_CLEAN}
        class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
      />
      {#if tokenize && cleanCount !== null}
        <span class="text-[10px] text-zinc-600">{cleanCount} tokens</span>
      {/if}
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-[10px] font-medium uppercase tracking-wider text-zinc-500" for="patch-corrupted">Changed prompt</label>
      <input
        id="patch-corrupted"
        type="text"
        bind:value={corruptedPrompt}
        placeholder={IOI_CHANGED}
        class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
      />
      {#if tokenize && corruptedCount !== null}
        <span class="text-[10px] text-zinc-600">{corruptedCount} tokens</span>
      {/if}
    </div>
    {#if lengthStatus}
      <p
        class="text-[11px]"
        class:text-emerald-400={lengthStatus.same}
        class:text-amber-400={!lengthStatus.same}
        role="status"
      >
        {lengthStatus.label}{#if !lengthStatus.same}. Patching needs both prompts to be the same number of tokens.{/if}
      </p>
    {/if}
    <div class="flex items-center gap-3">
      <label class="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Patch type</label>
      <div class="flex gap-1">
        {#each ['head', 'mlp', 'resid'] as pt (pt)}
          <button
            type="button"
            onclick={() => { patchType = pt as 'head' | 'mlp' | 'resid'; }}
            class={[
              'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
              patchType === pt ? 'bg-indigo-950 text-indigo-300' : 'bg-zinc-800 text-zinc-500',
            ].join(' ')}
          >
            {pt === 'head' ? 'Heads' : pt === 'mlp' ? 'MLPs' : 'Residual'}
          </button>
        {/each}
      </div>
      <button
        type="button"
        onclick={handleRun}
        disabled={loading || lengthsDiffer || !cleanPrompt.trim() || !corruptedPrompt.trim()}
        class="ml-auto rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Running...' : 'Run Patching'}
      </button>
    </div>
  </div>

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Enter an original prompt and a changed one, then run to see which parts of the model cause the difference.</p>
    </div>
  {:else if response}
    <!-- Info bar -->
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
      <span class="text-zinc-500">Original predicts:</span>
      <span class="font-mono text-indigo-300">"{response.clean_predicted_token}"</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Changed predicts:</span>
      <span class="font-mono text-red-300">"{response.corrupted_predicted_token}"</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Type:</span>
      <span class="text-zinc-300">{response.patch_type}</span>
    </div>

    {#if shownPatchType === 'head' && nHeads > 0}
      <!-- Heatmap for head patching -->
      <div class="overflow-x-auto">
        <div class="text-[10px] text-zinc-600 mb-1">Layer (rows) x Head (columns). Brightness = patching effect magnitude.</div>
        <div class="inline-grid gap-px" style="grid-template-columns: auto repeat({nHeads}, 1fr);">
          <!-- Header row -->
          <div class="text-[9px] text-zinc-600 px-1"></div>
          {#each Array(nHeads) as _, h}
            <div class="text-center text-[9px] text-zinc-600 px-0.5">H{h}</div>
          {/each}

          <!-- Data rows -->
          {#each Array(nLayers) as _, l}
            <div class="text-[9px] text-zinc-500 px-1 flex items-center">L{l}</div>
            {#each Array(nHeads) as _, h}
              {@const comp = gridLookup.get(`${l}-${h}`)}
              {@const effect = comp?.effect ?? 0}
              <button
                type="button"
                onclick={() => { selectedComponent = comp ?? null; }}
                class="h-5 w-5 rounded-sm border border-zinc-800 transition-colors hover:border-zinc-600"
                style="background-color: {cellColor(effect)};"
                title="L{l}.H{h}: {effect.toFixed(4)}"
              ></button>
            {/each}
          {/each}
        </div>
      </div>
    {:else if residTokens.length > 0}
      <!-- Heatmap for residual patching: one square per (layer, word) -->
      <div class="overflow-x-auto">
        <div class="text-[10px] text-zinc-600 mb-1">
          Layer (rows) x word (columns). Each square swaps in the original prompt's information at one word, going into one layer.
        </div>
        <div class="inline-grid gap-px" style="grid-template-columns: auto repeat({residTokens.length}, 1fr);">
          <div class="text-[9px] text-zinc-600 px-1"></div>
          {#each residTokens as tok, p (p)}
            <div class="max-w-[3rem] truncate px-0.5 text-center font-mono text-[9px] text-zinc-500" title={tok}>{tok.replace(/^ /, '·')}</div>
          {/each}
          {#each Array(nLayers) as _, l}
            <div class="text-[9px] text-zinc-500 px-1 flex items-center">L{l}</div>
            {#each residTokens as tok, p (p)}
              {@const comp = gridLookup.get(`${l}-p${p}`)}
              {@const effect = comp?.effect ?? 0}
              <button
                type="button"
                onclick={() => { selectedComponent = comp ?? null; }}
                class="h-5 min-w-5 rounded-sm border border-zinc-800 transition-colors hover:border-zinc-600"
                style="background-color: {cellColor(effect)};"
                title="Layer {l}, {JSON.stringify(tok)}: {effect.toFixed(4)}"
                aria-label="Layer {l}, word {p + 1}: effect {effect.toFixed(3)}"
              ></button>
            {/each}
          {/each}
        </div>
      </div>
    {:else}
      <!-- Bar chart for MLP patching -->
      <div class="flex flex-col gap-0.5">
        {#each components.slice(0, 30) as comp, i (comp.name)}
          {@const isPositive = comp.effect >= 0}
          {@const width = (Math.abs(comp.effect) / maxAbsEffect) * 100}
          <button
            type="button"
            onclick={() => { selectedComponent = comp; }}
            class="group flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-zinc-900/60"
          >
            <span class="w-5 shrink-0 text-right font-mono text-[10px] text-zinc-700">{i + 1}</span>
            <span class="w-16 shrink-0 truncate font-mono text-xs text-zinc-300">{comp.name}</span>
            <div class="flex-1 flex items-center" style="height: 16px;">
              {#if isPositive}
                <div class="flex h-full w-1/2 justify-start"></div>
                <div class="h-full w-1/2 flex items-center">
                  <div class="h-full rounded-r bg-indigo-500/70 transition-all" style="width: {width / 2}%;"></div>
                </div>
              {:else}
                <div class="h-full w-1/2 flex items-center justify-end">
                  <div class="h-full rounded-l bg-red-500/70 transition-all" style="width: {width / 2}%;"></div>
                </div>
                <div class="flex h-full w-1/2 justify-start"></div>
              {/if}
            </div>
            <span
              class="w-16 shrink-0 text-right font-mono text-[10px]"
              class:text-indigo-400={isPositive}
              class:text-red-400={!isPositive}
            >
              {isPositive ? '+' : ''}{comp.effect.toFixed(4)}
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Selected component detail -->
    {#if selectedComponent}
      <div class="rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-xs">
        <div class="flex items-center gap-3 text-zinc-300">
          <span class="font-mono font-semibold">{selectedComponent.name}</span>
          <span class="text-zinc-600">|</span>
          <span>Effect: <span class="font-mono" class:text-indigo-400={selectedComponent.effect >= 0} class:text-red-400={selectedComponent.effect < 0}>{selectedComponent.effect.toFixed(4)}</span></span>
        </div>
        <div class="mt-1 flex gap-4 text-zinc-500">
          <span>Original score: <span class="text-zinc-300">{selectedComponent.clean_logit.toFixed(3)}</span></span>
          <span>Changed score: <span class="text-zinc-300">{selectedComponent.corrupted_logit.toFixed(3)}</span></span>
          <span>Swapped score: <span class="text-zinc-300">{selectedComponent.patched_logit.toFixed(3)}</span></span>
        </div>
      </div>
    {/if}

    <!-- Legend -->
    <div class="flex items-center gap-4 text-[10px] text-zinc-600">
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm bg-indigo-500/70"></span>
        Positive (brings back the original answer)
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm bg-red-500/70"></span>
        Negative (pushes further from the original)
      </span>
      {#if response?.timing_ms}
        <span class="ml-auto text-zinc-700">
          {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
        </span>
      {/if}
    </div>
  {/if}
</section>
