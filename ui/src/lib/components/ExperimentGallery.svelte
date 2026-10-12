<script lang="ts">
  // Experiment cards (T22): a gallery of one-click guided experiments, plus a
  // small "what to look for" guide that stays on screen while the user explores.
  // Setup logic lives in $lib/experiments/experiments.ts; this only renders.
  import { FlaskConical, X, ChevronDown, ChevronUp, ExternalLink } from 'lucide-svelte';
  import { tabLabel, type Experiment } from '$lib/experiments/experiments';
  import { tutorialState, guideOccupiedSource } from '$lib/tutorial/tutorial-store.svelte';
  import { occupied, OCCUPIED } from '$lib/popup/occupied.svelte';

  interface Props {
    open: boolean;
    experiments: Experiment[];
    /** Experiment whose guide is showing (null = no guide). */
    active: Experiment | null;
    /** True while the picked experiment is being set up (model load + run). */
    busy?: boolean;
    /** Set when the experiment's model couldn't be loaded (its preset id). */
    failedPreset?: string | null;
    presetLabel?: (presetId: string) => string;
    onPick: (exp: Experiment) => void;
    onClose: () => void;
    onDismissGuide: () => void;
    /** "Back to normal": undo what the experiment set up and close the guide. */
    onReset: () => void;
  }

  let {
    open,
    experiments,
    active,
    busy = false,
    failedPreset = null,
    presetLabel = (id) => id,
    onPick,
    onClose,
    onDismissGuide,
    onReset,
  }: Props = $props();

  let userCollapsed = $state(false);
  // A new experiment opens its guide expanded.
  $effect(() => {
    void active?.id;
    userCollapsed = false;
  });
  // While the tour is open the guide shrinks to its header (they never overlap).
  const tourOpen = $derived(tutorialState.guideCollapsed);
  const collapsed = $derived(userCollapsed || tourOpen);

  const tryNext = $derived(
    active?.next.tryId ? experiments.find((e) => e.id === active!.next.tryId) ?? null : null,
  );

  function rectOf(el: Element) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // The guide is a dock, not a placed popup: it registers its rect so popups avoid it.
  let guideEl = $state<HTMLElement | null>(null);
  let headerEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const g = guideEl;
    const h = headerEl;
    if (!g || !h) return;
    const isCollapsed = collapsed; // re-register on collapse so popups re-place
    return occupied.register(
      OCCUPIED.guide,
      guideOccupiedSource(() => isCollapsed, () => rectOf(g), () => rectOf(h)),
    );
  });

  async function openExternal(url: string) {
    try {
      const { open: shellOpen } = await import('@tauri-apps/plugin-shell');
      await shellOpen(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
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
              {presetLabel(exp.preset)} · {tabLabel(exp)}
            </span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if active}
  <aside
    bind:this={guideEl}
    aria-label="Experiment guide"
    class="fixed bottom-4 left-4 z-40 flex max-h-[calc(100vh-5rem)] w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-indigo-800/60 bg-zinc-900/95 shadow-2xl backdrop-blur"
  >
    <!-- Header: always visible, also while the tour has the guide collapsed. -->
    <div bind:this={headerEl} class="flex-shrink-0 border-b border-zinc-800 px-3 py-2">
      <div class="flex items-center gap-2">
        <FlaskConical class="h-3.5 w-3.5 flex-shrink-0 text-indigo-400" />
        <span class="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">{active.title}</span>
        {#if busy}
          <span class="text-[10px] text-zinc-500">Setting up…</span>
        {/if}
        {#if !tourOpen}
          <button
            onclick={() => (userCollapsed = !userCollapsed)}
            aria-label={collapsed ? 'Expand guide' : 'Collapse guide'}
            aria-expanded={!collapsed}
            class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {#if collapsed}<ChevronUp class="h-3.5 w-3.5" />{:else}<ChevronDown class="h-3.5 w-3.5" />{/if}
          </button>
        {/if}
        <button
          onclick={onDismissGuide}
          aria-label="Close guide"
          class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
      <p class="mt-1 text-xs text-zinc-300">{active.hook}</p>
      <p class="mt-1 text-[11px] text-zinc-400">
        <span class="text-zinc-500">Prompt:</span> "{active.prompt}"
      </p>
      {#if active.patching}
        <p class="mt-0.5 text-[11px] text-zinc-400">
          <span class="text-zinc-500">Changed prompt:</span> "{active.patching.corrupted}"
        </p>
      {/if}
    </div>

    {#if !collapsed}
      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-xs text-zinc-300">
        <p class="mb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">Why it matters</p>
        <p class="mb-3 text-zinc-300">{active.why}</p>

        {#if failedPreset}
          <div role="alert" class="mb-3 rounded border border-red-800/60 bg-red-950/30 px-2.5 py-2 text-red-200">
            <p>
              Couldn't load {presetLabel(failedPreset)}, so this experiment can't run. Check the model
              chip at the top, then press Try again.
            </p>
            <button
              onclick={() => active && onPick(active)}
              disabled={busy}
              class="mt-2 rounded border border-red-700/70 px-2 py-1 text-[11px] text-red-100 hover:bg-red-900/40 disabled:opacity-60"
            >Try again</button>
          </div>
        {:else}
          <p class="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500">What to look for</p>
          <ol class="mb-3 list-decimal space-y-1.5 pl-4">
            {#each active.lookFor as tip}
              <li>{tip}</li>
            {/each}
          </ol>
        {/if}

        <p class="mb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">What researchers found</p>
        <p class="text-zinc-400">{active.found.summary}</p>
        <ul class="mt-2 mb-3 space-y-1">
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

        {#if !failedPreset}
          <p class="mb-1 text-[10px] font-medium uppercase tracking-widest text-zinc-500">When you're done</p>
          <p class="text-zinc-300">{active.next.reset}</p>
          <p class="mt-1 text-zinc-300">{active.next.try}</p>
          {#if tryNext}
            <button
              onclick={() => tryNext && onPick(tryNext)}
              disabled={busy}
              class="mt-2 rounded border border-zinc-700 px-2 py-1 text-[11px] text-indigo-300 hover:border-indigo-600 disabled:opacity-60"
            >Start "{tryNext.title}"</button>
          {/if}
        {/if}
      </div>

      <div class="flex-shrink-0 border-t border-zinc-800 px-3 py-2">
        <button
          onclick={onReset}
          disabled={busy}
          class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
        >Back to normal</button>
      </div>
    {/if}
  </aside>
{/if}
