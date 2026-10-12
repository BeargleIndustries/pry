<script lang="ts">
  // Experiment cards (T22): a gallery of one-click guided experiments, plus a
  // small "what to look for" guide that stays on screen while the user explores.
  // Setup logic lives in $lib/experiments/experiments.ts; this only renders.
  import { FlaskConical, X, ChevronDown, ChevronUp, ExternalLink } from 'lucide-svelte';
  import type { Experiment } from '$lib/experiments/experiments';

  interface Props {
    open: boolean;
    experiments: Experiment[];
    /** Experiment whose guide is showing (null = no guide). */
    active: Experiment | null;
    /** True while the picked experiment is being set up (model load + run). */
    busy?: boolean;
    presetLabel?: (presetId: string) => string;
    onPick: (exp: Experiment) => void;
    onClose: () => void;
    onDismissGuide: () => void;
  }

  let {
    open,
    experiments,
    active,
    busy = false,
    presetLabel = (id) => id,
    onPick,
    onClose,
    onDismissGuide,
  }: Props = $props();

  let guideCollapsed = $state(false);
  let showFound = $state(false);
  // A new experiment opens its guide expanded, with the research summary folded.
  $effect(() => {
    void active?.id;
    guideCollapsed = false;
    showFound = false;
  });

  async function openExternal(url: string) {
    try {
      const { open: shellOpen } = await import('@tauri-apps/plugin-shell');
      await shellOpen(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function openDemo(link: string) {
    // Full reload so the page's ?demo= handling runs from the start.
    window.location.search = link;
  }

  function onKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- Backdrop: click outside closes; Escape is handled on window. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="experiments-title"
      class="w-full max-w-4xl rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
    >
      <div class="mb-1 flex items-center justify-between gap-3">
        <h2 id="experiments-title" class="flex items-center gap-2 text-base font-semibold text-zinc-100">
          <FlaskConical class="h-4 w-4 text-indigo-400" />
          Try an experiment
        </h2>
        <button
          onclick={onClose}
          aria-label="Close experiments"
          class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
        >Close</button>
      </div>
      <p class="mb-5 text-sm text-zinc-400">
        Each card sets up a small experiment that researchers have studied in GPT-2 small. Pick one,
        and Pry fills in the prompt, runs it and opens the right panel. A short guide stays on
        screen while you look around.
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        {#each experiments as exp (exp.id)}
          <button
            type="button"
            onclick={() => onPick(exp)}
            disabled={busy}
            class="flex flex-col items-start rounded-md border border-zinc-800 bg-zinc-950 p-4 text-left transition-colors hover:border-indigo-600 hover:bg-zinc-900 disabled:cursor-wait disabled:opacity-60"
          >
            <span class="text-sm font-medium text-zinc-100">{exp.title}</span>
            <span class="mt-1 text-xs text-zinc-400">{exp.hook}</span>
            <span class="mt-3 text-[10px] uppercase tracking-wider text-zinc-600">
              {presetLabel(exp.preset)}{exp.patching ? ' · Swap & Compare' : ''}{exp.ablateHeads ? ' · knockout' : ''}
            </span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if active}
  <aside
    aria-label="Experiment guide"
    class="fixed bottom-4 left-4 z-40 w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border border-indigo-800/60 bg-zinc-900/95 shadow-2xl backdrop-blur"
  >
    <div class="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
      <FlaskConical class="h-3.5 w-3.5 flex-shrink-0 text-indigo-400" />
      <span class="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">{active.title}</span>
      {#if busy}
        <span class="text-[10px] text-zinc-500">Setting up…</span>
      {/if}
      <button
        onclick={() => (guideCollapsed = !guideCollapsed)}
        aria-label={guideCollapsed ? 'Expand guide' : 'Collapse guide'}
        aria-expanded={!guideCollapsed}
        class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        {#if guideCollapsed}<ChevronUp class="h-3.5 w-3.5" />{:else}<ChevronDown class="h-3.5 w-3.5" />{/if}
      </button>
      <button
        onclick={onDismissGuide}
        aria-label="Close guide"
        class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    {#if !guideCollapsed}
      <div class="max-h-[55vh] overflow-y-auto px-3 py-3 text-xs text-zinc-300">
        <p class="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500">What to look for</p>
        <ul class="mb-3 list-disc space-y-1.5 pl-4">
          {#each active.lookFor as tip}
            <li>{tip}</li>
          {/each}
        </ul>

        {#if active.demoLink}
          <button
            onclick={() => openDemo(active.demoLink!)}
            class="mb-3 rounded border border-zinc-700 px-2 py-1 text-[11px] text-indigo-300 hover:border-indigo-600"
          >Open the guided walkthrough for this one</button>
        {/if}

        <button
          onclick={() => (showFound = !showFound)}
          aria-expanded={showFound}
          class="flex w-full items-center justify-between text-[10px] font-medium uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
        >
          What researchers found
          {#if showFound}<ChevronUp class="h-3 w-3" />{:else}<ChevronDown class="h-3 w-3" />{/if}
        </button>
        {#if showFound}
          <p class="mt-1.5 text-zinc-400">{active.found.summary}</p>
          <ul class="mt-2 space-y-1">
            {#each active.found.citations as c (c.url)}
              <li>
                <button
                  onclick={() => openExternal(c.url)}
                  class="inline-flex items-start gap-1 text-left text-[11px] text-indigo-300 hover:underline"
                >
                  <ExternalLink class="mt-0.5 h-3 w-3 flex-shrink-0" />
                  <span>{c.label}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </aside>
{/if}
