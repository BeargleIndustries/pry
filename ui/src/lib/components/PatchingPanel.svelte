<script lang="ts">
  import type { PatchResponse, PatchComponent } from '$lib/types';

  interface Props {
    response: PatchResponse | null;
    loading?: boolean;
    onRun?: (cleanPrompt: string, corruptedPrompt: string, patchType: 'head' | 'mlp' | 'resid') => void;
  }

  let { response, loading = false, onRun }: Props = $props();

  let cleanPrompt = $state('The cat sat on the');
  let corruptedPrompt = $state('The dog sat on the');
  let patchType = $state<'head' | 'mlp' | 'resid'>('head');

  const components = $derived(response?.components ?? []);

  // For head patching, build a layer x head grid
  const nLayers = $derived.by(() => {
    if (components.length === 0) return 0;
    return Math.max(...components.map((c) => c.layer)) + 1;
  });
  const nHeads = $derived.by(() => {
    if (patchType !== 'head' || components.length === 0) return 0;
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
      map.set(`${c.layer}-${c.head ?? 'mlp'}`, c);
    }
    return map;
  });

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
    <h2 class="text-sm font-semibold text-zinc-100">Activation Patching</h2>
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
      <label class="text-[10px] font-medium uppercase tracking-wider text-zinc-500" for="patch-clean">Clean prompt</label>
      <input
        id="patch-clean"
        type="text"
        bind:value={cleanPrompt}
        placeholder="The cat sat on the"
        class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
      />
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-[10px] font-medium uppercase tracking-wider text-zinc-500" for="patch-corrupted">Corrupted prompt</label>
      <input
        id="patch-corrupted"
        type="text"
        bind:value={corruptedPrompt}
        placeholder="The dog sat on the"
        class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
      />
    </div>
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
        disabled={loading || !cleanPrompt.trim() || !corruptedPrompt.trim()}
        class="ml-auto rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Running...' : 'Run Patching'}
      </button>
    </div>
  </div>

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Enter two prompts and run patching to find causally important components.</p>
    </div>
  {:else if response}
    <!-- Info bar -->
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
      <span class="text-zinc-500">Clean predicts:</span>
      <span class="font-mono text-indigo-300">"{response.clean_predicted_token}"</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Corrupted predicts:</span>
      <span class="font-mono text-red-300">"{response.corrupted_predicted_token}"</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Type:</span>
      <span class="text-zinc-300">{response.patch_type}</span>
    </div>

    {#if patchType === 'head' && nHeads > 0}
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
    {:else}
      <!-- Bar chart for MLP/resid patching -->
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
          <span>Clean logit: <span class="text-zinc-300">{selectedComponent.clean_logit.toFixed(3)}</span></span>
          <span>Corrupted logit: <span class="text-zinc-300">{selectedComponent.corrupted_logit.toFixed(3)}</span></span>
          <span>Patched logit: <span class="text-zinc-300">{selectedComponent.patched_logit.toFixed(3)}</span></span>
        </div>
      </div>
    {/if}

    <!-- Legend -->
    <div class="flex items-center gap-4 text-[10px] text-zinc-600">
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm bg-indigo-500/70"></span>
        Positive (restores clean behavior)
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm bg-red-500/70"></span>
        Negative (pushes further from clean)
      </span>
      {#if response?.timing_ms}
        <span class="ml-auto text-zinc-700">
          {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
        </span>
      {/if}
    </div>
  {/if}
</section>
