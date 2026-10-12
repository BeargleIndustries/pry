<script lang="ts">
  import Term from './Term.svelte';
  import Readout from './Readout.svelte';
  import type { PatchResponse, PatchComponent } from '$lib/types';
  import { patchingReadout, quoteToken } from '$lib/readouts';
  import {
    patchLengthStatus,
    TOKENIZE_DEBOUNCE_MS,
    type TokenizeResponse,
  } from '$lib/analysis-core';
  import { clampCell, handleGridKey, type GridCell } from '$lib/grid-nav';
  import {
    NEGATIVE_HEX,
    POSITIVE_HEX,
    signGlyph,
    signOf,
    signedColor,
    signedHex,
    signedIntensity,
    signedNumber,
  } from '$lib/signed-color';

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

  // Blue = positive (brings back the original answer), orange = negative.
  // Colorblind-safe pair from $lib/signed-color; the sign is also in every label.
  function cellColor(effect: number): string {
    return signedColor(effect, maxAbsEffect);
  }

  function effectWords(effect: number): string {
    const s = signOf(effect);
    return s === 'positive'
      ? 'brings back the original answer'
      : s === 'negative'
        ? 'pushes further from the original'
        : 'no change';
  }

  function cellLabel(where: string, effect: number): string {
    return `${where}: score change ${signedNumber(effect, 3)}, ${effectWords(effect)}`;
  }

  /** The detail line for a clicked part, in plain words. */
  function detailSentence(c: PatchComponent, answer: string): string {
    const by = Math.abs(c.effect).toFixed(2);
    const numbers = `(from ${c.corrupted_logit.toFixed(2)} to ${c.patched_logit.toFixed(2)}; the original prompt scores ${c.clean_logit.toFixed(2)}).`;
    if (c.effect > 0) return `Swapping this in raised the score for ${answer} by ${by} ${numbers}`;
    if (c.effect < 0) return `Swapping this in lowered the score for ${answer} by ${by} ${numbers}`;
    return `Swapping this in left the score for ${answer} where it was ${numbers}`;
  }

  // Keyboard model (T29): roving tabindex over whichever grid is showing.
  // The cells are buttons, so Enter/Space click them natively.
  const uid = $props.id();
  const gridDescId = `patch-grid-desc-${uid}`;
  const legendId = `patch-legend-${uid}`;
  const patchTypeLabelId = `patch-type-${uid}`;
  let gridEl: HTMLElement | undefined = $state();
  let gridCurrent = $state<GridCell>({ row: 0, col: 0 });
  const gridShape = $derived(
    shownPatchType === 'head' && nHeads > 0
      ? { rows: nLayers, cols: nHeads }
      : residTokens.length > 0
        ? { rows: nLayers, cols: residTokens.length }
        : { rows: 0, cols: 0 },
  );
  const tabStop = $derived(clampCell(gridCurrent, gridShape));

  function onGridKey(e: KeyboardEvent) {
    if (!tabStop) return;
    const next = handleGridKey(e, tabStop, gridShape, gridEl, { nativeActivate: true });
    if (next) gridCurrent = next;
  }

  /** Small glyph drawn in strong cells so sign never depends on colour alone. */
  function cellGlyph(effect: number): string {
    return signedIntensity(effect, maxAbsEffect) >= 0.2 ? signGlyph(effect) : '';
  }

  // Dark glyph on bright cells, light glyph on dim ones. The switch sits at
  // 0.75 so both keep >= 4.5:1 contrast on the dark panel.
  function glyphColor(effect: number): string {
    return signedIntensity(effect, maxAbsEffect) >= 0.75 ? '#09090b' : '#f4f4f5';
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="patching-panel"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Swap test</h2>
    <span class="text-xs text-zinc-600">Which parts carry the difference between two prompts</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Swapping...
      </span>
    {/if}
  </div>

  <p class="text-xs text-zinc-400">
    Here's the idea: Pry runs the changed prompt, copies one part's work over from the original prompt, and checks how
    much the original answer comes back. Researchers call this <Term key="patching">patching</Term>. Every number here is a raw
    change in the answer's <Term key="logit">score</Term>. It's not a percentage.
  </p>

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
        <span class="text-[10px] text-zinc-600">{cleanCount} tokens (word pieces)</span>
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
        <span class="text-[10px] text-zinc-600">{corruptedCount} tokens (word pieces)</span>
      {/if}
    </div>
    {#if lengthStatus}
      <p
        class="text-[11px]"
        class:text-emerald-400={lengthStatus.same}
        class:text-amber-400={!lengthStatus.same}
        role="status"
      >
        {lengthStatus.label}{#if !lengthStatus.same}. The swap test can't run unless both prompts are the same number of tokens.{/if}
      </p>
    {/if}
    <div class="flex items-center gap-3">
      <span id={patchTypeLabelId} class="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Swap</span>
      <div class="flex gap-1" role="group" aria-labelledby={patchTypeLabelId}>
        {#each ['head', 'mlp', 'resid'] as pt (pt)}
          <button
            type="button"
            aria-pressed={patchType === pt}
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
        {loading ? 'Running...' : 'Run swap test'}
      </button>
    </div>
    <p class="text-[10px] text-zinc-500">
      Heads swaps one attention head at a time. <Term key="mlp">MLPs</Term> swaps each layer's processing block.
      <Term key="residual-stream">Residual</Term> swaps the running notes at one word, going into one layer.
    </p>
  </div>

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Type an original prompt and a changed one, then press Run swap test to see which parts carry the difference.</p>
    </div>
  {:else if response}
    <Readout text={patchingReadout(response)} />

    <!-- Info bar -->
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
      <span class="text-zinc-500">Original prompt guesses:</span>
      <span class="font-mono text-indigo-300">{quoteToken(response.clean_predicted_token)}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Changed prompt guesses:</span>
      <span class="font-mono text-zinc-300">{quoteToken(response.corrupted_predicted_token)}</span>
      <span class="mx-1 text-zinc-700">|</span>
      <span class="text-zinc-500">Swapped:</span>
      <span class="text-zinc-300">{response.patch_type === 'head' ? 'heads' : response.patch_type === 'mlp' ? 'MLPs' : 'residual'}</span>
    </div>

    {#if shownPatchType === 'head' && nHeads > 0}
      <!-- Heatmap for head patching -->
      <div class="overflow-x-auto">
        <div id={gridDescId} class="text-[10px] text-zinc-600 mb-1">
          Rows are layers, columns are heads. Blue squares bring the original answer back, orange push it further away. Brighter means a bigger change. Look for <Term key="name-mover">name mover</Term> heads in the late layers. Click a square for its numbers; arrow keys move between squares.
        </div>
        <div
          bind:this={gridEl}
          role="grid"
          aria-label="Head patching effects, layer by head"
          aria-describedby="{gridDescId} {legendId}"
          tabindex="-1"
          onkeydown={onGridKey}
          class="inline-grid gap-px"
          style="grid-template-columns: auto repeat({nHeads}, 1fr);"
        >
          <!-- Header row -->
          <div role="row" class="contents">
            <div role="columnheader" class="text-[9px] text-zinc-600 px-1"><span class="sr-only">Layer</span></div>
            {#each Array(nHeads) as _, h}
              <div role="columnheader" class="text-center text-[9px] text-zinc-600 px-0.5" aria-label="Head {h}">H{h}</div>
            {/each}
          </div>

          <!-- Data rows -->
          {#each Array(nLayers) as _, l}
            <div role="row" class="contents">
              <div role="rowheader" class="text-[9px] text-zinc-500 px-1 flex items-center" aria-label="Layer {l}">L{l}</div>
              {#each Array(nHeads) as _, h}
                {@const comp = gridLookup.get(`${l}-${h}`)}
                {@const effect = comp?.effect ?? 0}
                <button
                  type="button"
                  role="gridcell"
                  data-row={l}
                  data-col={h}
                  tabindex={tabStop?.row === l && tabStop?.col === h ? 0 : -1}
                  aria-selected={comp !== undefined && selectedComponent?.name === comp.name}
                  onfocus={() => { gridCurrent = { row: l, col: h }; }}
                  onclick={() => { selectedComponent = comp ?? null; }}
                  class="flex h-5 w-5 items-center justify-center rounded-sm border border-zinc-800 text-[10px] font-bold leading-none transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  style="background-color: {cellColor(effect)}; color: {glyphColor(effect)};"
                  title="L{l} H{h}: {signedNumber(effect, 2)} score change"
                  aria-label={cellLabel(`Layer ${l}, head ${h}`, effect)}
                ><span aria-hidden="true">{cellGlyph(effect)}</span></button>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {:else if residTokens.length > 0}
      <!-- Heatmap for residual patching: one square per (layer, word) -->
      <div class="overflow-x-auto">
        <div id={gridDescId} class="text-[10px] text-zinc-600 mb-1">
          Rows are layers, columns are words. Each square swaps in the original prompt's information at one word, going into one layer. Blue squares bring the original answer back, orange push it further away. Click a square for its numbers; arrow keys move between squares.
        </div>
        <div
          bind:this={gridEl}
          role="grid"
          aria-label="Residual patching effects, layer by word"
          aria-describedby="{gridDescId} {legendId}"
          tabindex="-1"
          onkeydown={onGridKey}
          class="inline-grid gap-px"
          style="grid-template-columns: auto repeat({residTokens.length}, 1fr);"
        >
          <div role="row" class="contents">
            <div role="columnheader" class="text-[9px] text-zinc-600 px-1"><span class="sr-only">Layer</span></div>
            {#each residTokens as tok, p (p)}
              <div role="columnheader" class="max-w-[3rem] truncate px-0.5 text-center font-mono text-[9px] text-zinc-500" title={tok}>{tok.replace(/^ /, '·')}</div>
            {/each}
          </div>
          {#each Array(nLayers) as _, l}
            <div role="row" class="contents">
              <div role="rowheader" class="text-[9px] text-zinc-500 px-1 flex items-center" aria-label="Layer {l}">L{l}</div>
              {#each residTokens as tok, p (p)}
                {@const comp = gridLookup.get(`${l}-p${p}`)}
                {@const effect = comp?.effect ?? 0}
                <button
                  type="button"
                  role="gridcell"
                  data-row={l}
                  data-col={p}
                  tabindex={tabStop?.row === l && tabStop?.col === p ? 0 : -1}
                  aria-selected={comp !== undefined && selectedComponent?.name === comp.name}
                  onfocus={() => { gridCurrent = { row: l, col: p }; }}
                  onclick={() => { selectedComponent = comp ?? null; }}
                  class="flex h-5 min-w-5 items-center justify-center rounded-sm border border-zinc-800 text-[10px] font-bold leading-none transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  style="background-color: {cellColor(effect)}; color: {glyphColor(effect)};"
                  title="Layer {l}, {JSON.stringify(tok)}: {signedNumber(effect, 2)} score change"
                  aria-label={cellLabel(`Layer ${l}, word ${p + 1} ${JSON.stringify(tok)}`, effect)}
                ><span aria-hidden="true">{cellGlyph(effect)}</span></button>
              {/each}
            </div>
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
                  <div class="h-full rounded-r transition-all" style="width: {width / 2}%; background-color: {POSITIVE_HEX}; opacity: 0.75;"></div>
                </div>
              {:else}
                <div class="h-full w-1/2 flex items-center justify-end">
                  <div class="h-full rounded-l transition-all" style="width: {width / 2}%; background-color: {NEGATIVE_HEX}; opacity: 0.75;"></div>
                </div>
                <div class="flex h-full w-1/2 justify-start"></div>
              {/if}
            </div>
            <span
              class="w-16 shrink-0 text-right font-mono text-[10px]"
              style="color: {signedHex(comp.effect)};"
            >
              {signedNumber(comp.effect, 2)}
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Selected component detail -->
    {#if selectedComponent}
      <div class="rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-xs" role="status">
        <div class="flex items-center gap-3 text-zinc-300">
          <span class="font-mono font-semibold">{selectedComponent.name}</span>
          <span class="text-zinc-600">|</span>
          <span>Score change: <span class="font-mono" style="color: {signedHex(selectedComponent.effect)};">{signedNumber(selectedComponent.effect, 2)}</span> <span class="text-zinc-500">({effectWords(selectedComponent.effect)})</span></span>
        </div>
        <p class="mt-1 text-zinc-400">{detailSentence(selectedComponent, quoteToken(response.clean_predicted_token))}</p>
      </div>
    {/if}

    <!-- Legend -->
    <div id={legendId} class="flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {POSITIVE_HEX};" aria-hidden="true"></span>
        <span aria-hidden="true" class="font-mono font-bold">+</span>
        Positive (blue: brings the original answer back)
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {NEGATIVE_HEX};" aria-hidden="true"></span>
        <span aria-hidden="true" class="font-mono font-bold">−</span>
        Negative (orange: pushes further from the original)
      </span>
      {#if response?.timing_ms}
        <span class="ml-auto text-zinc-700">
          {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
        </span>
      {/if}
    </div>
  {/if}
</section>
