<script lang="ts">
  import Term from './Term.svelte';
  // Compare mode (T25): two prompts side by side. All diff logic is in
  // $lib/compare.ts; this component only lays it out.
  import type { CompareController } from '$lib/compare-run';
  import { COMPARE_TOP_K_FEATURES } from '$lib/compare-run';
  import {
    alignedPositions,
    compareSummary,
    diffAttention,
    diffFeatures,
    diffPredictions,
    featureName,
    featuresAt,
    changeLabel,
    type FeatureChange,
  } from '$lib/compare';
  import { pct, quoteToken } from '$lib/readouts';
  import { viridis } from '$lib/viridis';
  import Readout from './Readout.svelte';

  interface Props {
    compare: CompareController;
    runDisabled: boolean;
    runDisabledReason?: string;
  }

  let { compare, runDisabled, runDisabledReason = '' }: Props = $props();
  const s = $derived(compare.state);

  const ready = $derived(s.a && s.b ? { a: s.a, b: s.b } : null);
  const positions = $derived(ready ? alignedPositions(ready.a, ready.b) : []);
  const pos = $derived(positions[s.positionIndex] ?? positions[0] ?? null);
  const sameLayer = $derived(ready ? ready.a.sae_layer_used === ready.b.sae_layer_used : false);

  const preds = $derived(ready ? diffPredictions(ready.a.top_predictions, ready.b.top_predictions) : null);
  const feats = $derived(
    ready && pos && sameLayer ? diffFeatures(featuresAt(ready.a, pos.posA), featuresAt(ready.b, pos.posB)) : null,
  );
  const attn = $derived(ready && pos ? diffAttention(ready.a, ready.b, pos.posA, pos.posB) : null);
  const summary = $derived(preds ? compareSummary(preds, feats, attn) : null);
  const maxCell = $derived(attn?.ok ? Math.max(1e-9, ...attn.ranked.map((h) => h.distance)) : 1);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !runDisabled) compare.run();
  }

  function shown(t: string): string {
    return t.startsWith(' ') ? '·' + t.slice(1) : t;
  }

  function prob(p: number | null, cut: number): string {
    return p === null ? `<${pct(cut).replace(/^[<>]/, '')}` : pct(p);
  }
</script>

<section class="flex flex-col gap-4" data-tip="compare-panel">
  <!-- Inputs -->
  <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
    <div class="mb-3 flex items-baseline gap-2">
      <h2 class="text-sm font-semibold text-zinc-100">Compare two prompts</h2>
      <span class="text-xs text-zinc-500">Change one word and see what else changes.</span>
    </div>
    <div class="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
      <label class="flex items-center gap-2">
        <span class="w-4 text-xs font-semibold text-sky-400">A</span>
        <input type="text" bind:value={s.promptA} onkeydown={onKey} aria-label="Prompt A"
          class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none" />
      </label>
      <button type="button" onclick={() => compare.swap()} title="Swap A and B"
        class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">⇄</button>
      <label class="flex items-center gap-2">
        <span class="w-4 text-xs font-semibold text-amber-400">B</span>
        <input type="text" bind:value={s.promptB} onkeydown={onKey} aria-label="Prompt B"
          class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none" />
      </label>
      <button type="button" onclick={() => compare.run()} disabled={runDisabled || s.running} title={runDisabledReason}
        class="rounded bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">
        {s.running ? 'Comparing…' : 'Run both'}
      </button>
    </div>
    {#if compare.edited}
      <p role="status" class="mt-2 text-xs text-amber-400">Prompts edited — press Run both to analyze the new text</p>
    {/if}
    {#if s.error}
      <p role="alert" class="mt-2 text-xs text-red-400">{s.error}</p>
    {/if}
  </div>

  {#if !ready}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="max-w-md text-center text-sm text-zinc-500">
        Type two prompts that differ in one word, for example “doctor” vs “nurse”, and press Run both.
      </p>
    </div>
  {:else}
    <Readout text={summary} />

    <!-- Tokens + position picker -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
      <span><span class="font-semibold text-sky-400">A</span> {ready.a.tokens.length} tokens</span>
      <span><span class="font-semibold text-amber-400">B</span> {ready.b.tokens.length} tokens</span>
      {#if positions.length > 1}
        <label class="flex items-center gap-2">
          Features and attention for
          <select bind:value={s.positionIndex}
            class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
            {#each positions as p, i}
              <option value={i}>{p.label}</option>
            {/each}
          </select>
        </label>
      {:else if pos}
        <span>Features and attention for the {pos.label}</span>
      {/if}
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <!-- 1. Predictions -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 class="mb-1 text-sm font-semibold text-zinc-100">Next-word guesses</h3>
        <p class="mb-3 text-xs text-zinc-500">
          Change = B minus A, in percentage points. Pry only gets each prompt’s top 10 guesses, so a word missing from one
          list is shown as “under” that list’s lowest chance, and its change as “at least”.
        </p>
        {#if preds && preds.rows.length}
          <table class="w-full text-xs">
            <thead class="text-zinc-500">
              <tr>
                <th class="pb-1 text-left font-normal">Word</th>
                <th class="pb-1 text-right font-normal text-sky-400">A</th>
                <th class="pb-1 text-right font-normal text-amber-400">B</th>
                <th class="pb-1 text-right font-normal">Change</th>
              </tr>
            </thead>
            <tbody>
              {#each preds.rows as r (r.token)}
                <tr class="border-t border-zinc-900">
                  <td class="py-1 font-mono text-zinc-200">{shown(r.token)}</td>
                  <td class="py-1 text-right tabular-nums text-zinc-400">{prob(r.probA, preds.cutoffA)}</td>
                  <td class="py-1 text-right tabular-nums text-zinc-400">{prob(r.probB, preds.cutoffB)}</td>
                  <td class="py-1 text-right tabular-nums"
                    class:text-emerald-400={r.change > 0}
                    class:text-rose-400={r.change < 0}
                    class:text-zinc-500={r.change === 0}>
                    {changeLabel(r)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="text-xs text-zinc-500">No predictions came back for these prompts.</p>
        {/if}
      </div>

      <!-- 2. Features -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 class="mb-1 text-sm font-semibold text-zinc-100">Features on this word</h3>
        {#if !sameLayer}
          <p class="text-xs text-zinc-500">The two runs used different feature layers, so their features can’t be matched. Run Compare again.</p>
        {:else if feats}
          <p class="mb-3 text-xs text-zinc-500">
            Layer {ready.a.sae_layer_used}, top {COMPARE_TOP_K_FEATURES} features per prompt. “Only in A” means it isn’t in B’s top
            {COMPARE_TOP_K_FEATURES}, not that it is fully off. Labels are best guesses from Neuronpedia.
          </p>
          {#snippet list(title: string, color: string, items: FeatureChange[], value: (f: FeatureChange) => string)}
            <div class="mb-3">
              <p class="mb-1 text-xs font-medium {color}">{title}</p>
              {#if items.length === 0}
                <p class="text-xs text-zinc-600">None.</p>
              {:else}
                <ul class="space-y-0.5">
                  {#each items.slice(0, 6) as f (f.id)}
                    <li class="flex justify-between gap-3 text-xs">
                      <span class="min-w-0 truncate text-zinc-300" title={featureName(f.hit)}>{featureName(f.hit)}</span>
                      <span class="shrink-0 tabular-nums text-zinc-500">{value(f)}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/snippet}
          {@render list('Only in A', 'text-sky-400', feats.onlyA, (f) => (f.actA ?? 0).toFixed(1))}
          {@render list('Only in B', 'text-amber-400', feats.onlyB, (f) => (f.actB ?? 0).toFixed(1))}
          {@render list('In both, strength changed most', 'text-zinc-300', feats.both,
            (f) => `${(f.actA ?? 0).toFixed(1)} → ${(f.actB ?? 0).toFixed(1)}`)}
        {/if}
      </div>
    </div>

    <!-- 3. Attention delta -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <h3 class="mb-1 text-sm font-semibold text-zinc-100">How differently each head looks from this word</h3>
      {#if attn && !attn.ok}
        <p class="text-xs text-zinc-500">{attn.reason}</p>
      {:else if attn && attn.ok}
        <p class="mb-3 text-xs text-zinc-500">
          {#if attn.mode === 'positions'}
            Both prompts have the same number of <Term key="token">tokens</Term>, so each <Term key="head">head</Term>’s attention is compared position by position.
            0% = the head spreads its attention exactly the same way; 100% = no overlap at all.
          {:else}
            The prompts have different numbers of <Term key="token">tokens</Term>, so positions don’t line up. Each <Term key="head">head</Term>’s attention is split into
            three shares — the first token, the words in between, and the word itself — and those shares are compared.
            This is coarse: it can miss shifts between the words in between.
          {/if}
          Brighter = more different. Average over all heads: {pct(attn.mean)}.
        </p>
        <div class="overflow-x-auto">
          <table class="border-separate border-spacing-0.5 text-[10px] text-zinc-500">
            <thead>
              <tr>
                <th class="pr-1 text-right font-normal">layer \ head</th>
                {#each Array(attn.nHeads) as _, h}
                  <th class="w-6 text-center font-normal">{h}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each attn.grid as row, l}
                <tr>
                  <th class="pr-1 text-right font-normal">{l}</th>
                  {#each row as d, h}
                    <td class="h-5 w-6 rounded-sm" style="background-color: {viridis(d / maxCell)}"
                      title="Layer {l}, head {h}: {pct(d)} different"></td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-zinc-400">
          Most different:
          {attn.ranked.slice(0, 3).map((h) => `layer ${h.layer} head ${h.head} (${pct(h.distance)})`).join(', ')}.
        </p>
      {/if}
    </div>

    <p class="text-xs text-zinc-500">
      Compared: <span class="text-sky-400">A</span> {quoteToken(ready.a.prompt)} vs
      <span class="text-amber-400">B</span> {quoteToken(ready.b.prompt)}.
    </p>
  {/if}
</section>
