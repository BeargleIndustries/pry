<script lang="ts">
  import Term from './Term.svelte';
  import type { DLAResponse, DLAComponent } from '$lib/types';
  import { dlaGapParts, dlaReadout, dlaTotalLine, explainingLabel } from '$lib/readouts';
  import { realWeightsVerified } from '$lib/sidecar';
  import Readout from './Readout.svelte';
  import { NEGATIVE_HEX, POSITIVE_HEX, signedHex, signedNumber, signOf } from '$lib/signed-color';
  import { hasPryHost, pryHost } from '$lib/lessons/registry/pry-state.svelte';

  interface Props {
    response: DLAResponse | null;
    loading?: boolean;
  }

  let { response, loading = false }: Props = $props();

  const components = $derived(response?.components ?? []);

  // Show top 30 components max
  const visibleComponents = $derived(components.slice(0, 30));

  const maxAbsContribution = $derived.by(() => {
    if (visibleComponents.length === 0) return 1;
    return Math.max(...visibleComponents.map((c) => Math.abs(c.contribution)), 0.001);
  });

  function barWidth(c: DLAComponent): number {
    return (Math.abs(c.contribution) / maxAbsContribution) * 100;
  }

  const uid = $props.id();
  const readoutId = `dla-readout-${uid}`;
  const legendId = `dla-legend-${uid}`;

  function rowLabel(c: DLAComponent): string {
    const what = c.type === 'attention' ? `Layer ${c.layer}, head ${c.head}` : `MLP in layer ${c.layer}`;
    const s = signOf(c.contribution);
    const dir = s === 'positive' ? 'pushed toward the guess' : s === 'negative' ? 'pushed against it' : 'no push';
    return `${what}: ${signedNumber(c.contribution, 3)}, ${dir}`;
  }

  function displayToken(t: string): string {
    return t.startsWith(' ') ? '\u00b7' + t.slice(1) : t;
  }

  // MF-2/MF-2b: what the bars explain (answer, optional contrast) and the
  // total / real / gap line under them.
  const answer = $derived(response ? (response.answer_token ?? response.predicted_token) : null);
  const contrast = $derived(response?.contrast_token ?? null);
  const totalLine = $derived(dlaTotalLine(response));
  const gapParts = $derived(dlaGapParts(response));

  // Picker choices: the top guess plus the run's top ten when DLA explains the
  // last token (the only position whose guesses the run carries).
  const targetChoices = $derived.by((): string[] => {
    if (!response || !hasPryHost()) return [];
    const run = pryHost().analysis.state.response;
    const last = run ? run.tokens.length - 1 : -1;
    const tops = response.target_token_index === last ? (run?.top_predictions ?? []).map((p) => p.token) : [];
    return [...new Set([response.predicted_token, ...(answer ? [answer] : []), ...(contrast ? [contrast] : []), ...tops])];
  });

  function setTarget(nextAnswer: string, nextContrast: string) {
    if (!hasPryHost() || !response) return;
    const a = pryHost().analysis;
    const ans = nextAnswer === response.predicted_token && !nextContrast ? null : nextAnswer;
    const con = nextContrast || null;
    a.state.dlaTarget = ans === null && con === null ? null : { answer: ans, contrast: con };
    void a.dla();
  }
</script>

<section
  class="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5"
  data-tip="dla-waterfall"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-sm font-semibold text-zinc-100">Why (<Term key="dla">DLA</Term>)</h2>
    <span class="text-xs text-zinc-600">Which parts pushed the guess directly. Help through other parts isn't counted.</span>
    {#if loading}
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent"></span>
        Computing...
      </span>
    {/if}
  </div>

  <Readout id={readoutId} text={dlaReadout(response)} />

  {#if !response && !loading}
    <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
      <p class="text-sm text-zinc-600">Run a prompt and this tab fills in on its own, showing which parts pushed toward or against the predicted word.</p>
    </div>
  {:else if response}
    <!-- Which word's guess this explains -->
    <div class="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
      <span class="text-zinc-500">{explainingLabel({ text: response.target_token, index: response.target_token_index })}:</span>
      <span class="font-mono text-indigo-300">{displayToken(answer ?? response.predicted_token)}</span>
      {#if contrast}
        <span class="text-zinc-500">minus</span>
        <span class="font-mono text-zinc-300">{displayToken(contrast)}</span>
      {/if}
    </div>
    {#if targetChoices.length > 1}
      <div class="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <label for="dla-answer-{uid}">Answer</label>
        <select
          id="dla-answer-{uid}"
          value={answer}
          disabled={loading}
          onchange={(e) => setTarget(e.currentTarget.value, contrast ?? '')}
          class="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-200"
        >
          {#each targetChoices as t (t)}
            <option value={t}>{displayToken(t)}</option>
          {/each}
        </select>
        <label for="dla-contrast-{uid}">Contrast (optional)</label>
        <select
          id="dla-contrast-{uid}"
          value={contrast ?? ''}
          disabled={loading}
          onchange={(e) => setTarget(answer ?? response.predicted_token, e.currentTarget.value)}
          class="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-200"
        >
          <option value="">none</option>
          {#each targetChoices.filter((t) => t !== answer) as t (t)}
            <option value={t}>{displayToken(t)}</option>
          {/each}
        </select>
        <span>With a contrast, the bars explain the answer's logit minus the contrast's.</span>
      </div>
    {/if}
    {#if !realWeightsVerified(response)}
      <p class="text-[11px] text-amber-400/80">On Gemma these numbers are still being checked against the real model.</p>
    {/if}

    {#if visibleComponents.length === 0}
      <div class="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 py-12">
        <p class="text-sm text-zinc-600">There's nothing to show for this run. Press Run again.</p>
      </div>
    {:else}
      <!-- Waterfall chart. A list, so screen readers can step through it; the
           readout above is its summary. -->
      <ul
        class="flex flex-col gap-0.5"
        aria-label="Direct pushes on the guess, biggest first"
        aria-describedby="{readoutId} {legendId}"
      >
        {#each visibleComponents as comp, i (comp.name)}
          {@const isPositive = comp.contribution >= 0}
          {@const width = barWidth(comp)}
          <li class="group flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-900/60" data-tour="dla-bar" data-part={comp.name}>
            <span class="sr-only">{i + 1}. {rowLabel(comp)}</span>
            <!-- Rank -->
            <span aria-hidden="true" class="w-5 shrink-0 text-right font-mono text-[10px] text-zinc-700">
              {i + 1}
            </span>
            <!-- Component label -->
            <span
              aria-hidden="true"
              class="w-16 shrink-0 truncate font-mono text-xs"
              class:text-zinc-300={comp.type === 'attention'}
              class:text-fuchsia-300={comp.type === 'mlp'}
              title="{comp.type === 'attention' ? `L${comp.layer} H${comp.head}` : `MLP in layer ${comp.layer}`}: direct push {signedNumber(comp.contribution, 3)}"
            >
              {comp.name}
            </span>
            <!-- Type badge -->
            <span
              aria-hidden="true"
              class={[
                'w-8 shrink-0 rounded text-center text-[9px] font-medium',
                comp.type === 'attention' ? 'bg-indigo-900/40 text-indigo-400' : 'bg-fuchsia-900/40 text-fuchsia-300',
              ].join(' ')}
            >
              {comp.type === 'attention' ? 'Attn' : 'MLP'}
            </span>
            <!-- Bar -->
            <div aria-hidden="true" class="flex-1 flex items-center" style="height: 16px;">
              {#if isPositive}
                <div class="flex h-full w-1/2 justify-start">
                  <!-- spacer for negative side -->
                </div>
                <div class="h-full w-1/2 flex items-center">
                  <div
                    class="h-full rounded-r transition-all"
                    style="width: {width / 2}%; background-color: {POSITIVE_HEX}; opacity: 0.75;"
                  ></div>
                </div>
              {:else}
                <div class="h-full w-1/2 flex items-center justify-end">
                  <div
                    class="h-full rounded-l transition-all"
                    style="width: {width / 2}%; background-color: {NEGATIVE_HEX}; opacity: 0.75;"
                  ></div>
                </div>
                <div class="flex h-full w-1/2 justify-start">
                  <!-- spacer for positive side -->
                </div>
              {/if}
            </div>
            <!-- Value -->
            <span
              aria-hidden="true"
              class="w-16 shrink-0 text-right font-mono text-[10px]"
              style="color: {signedHex(comp.contribution)};"
            >
              {signedNumber(comp.contribution, 3)}
            </span>
          </li>
        {/each}
      </ul>

      <p class="text-[10px] text-zinc-500">
        Each number is how much one part directly raised or lowered the guess's <Term key="logit">score</Term>.
      </p>

      {#if totalLine}
        <div data-tour="dla-total-line" class="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-300">
          <p>{totalLine}</p>
          {#if gapParts.length > 0}
            <details class="mt-1 text-zinc-400">
              <summary class="cursor-pointer text-zinc-500">What the gap is made of</summary>
              <ul class="mt-1 flex flex-col gap-0.5">
                {#each gapParts as part (part.name)}
                  <li class="flex gap-2"><span class="flex-1">{part.name}</span><span class="font-mono">{part.value}</span></li>
                {/each}
              </ul>
            </details>
          {/if}
        </div>
      {/if}

      <!-- Legend -->
      <div id={legendId} class="flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {POSITIVE_HEX};" aria-hidden="true"></span>
          <span aria-hidden="true" class="font-mono font-bold">+</span>
          Positive (blue, bar to the right: pushed toward the guess)
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-4 rounded-sm" style="background-color: {NEGATIVE_HEX};" aria-hidden="true"></span>
          <span aria-hidden="true" class="font-mono font-bold">−</span>
          Negative (orange, bar to the left: pushed against)
        </span>
        <span>Bar length: push in logits</span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm bg-indigo-900/40"></span>
          Attn: attention head
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-sm bg-fuchsia-900/40"></span>
          <Term key="mlp">MLP</Term>
        </span>
        {#if components.length > 30}
          <span class="ml-auto text-zinc-700">
            Showing the 30 biggest of {components.length}
          </span>
        {/if}
        {#if response?.timing_ms}
          <span class="ml-auto text-zinc-700">
            {response.timing_ms.total_ms?.toFixed(0) ?? '?'}ms
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</section>
