<script lang="ts">
  // Lab notebook (T27): save the current run with a note, browse saved runs,
  // edit notes, delete, and save a self-contained web-page report.
  // State and storage live in $lib/notebook.svelte.ts; this only renders.
  import { untrack } from 'svelte';
  import { BookOpen, ExternalLink, FileDown } from 'lucide-svelte';
  import type { NotebookStore } from '$lib/notebook.svelte';
  import type { NotebookEntry } from '$lib/notebook';
  import { defaultTitle } from '$lib/notebook';
  import { neuronpediaUrl } from '$lib/preset-display';
  import { isNamedFeature } from '$lib/feature-label';
  import { pct, quoteToken } from '$lib/readouts';

  interface Props {
    open: boolean;
    store: NotebookStore;
    /** Show the "save this run" form (opened from the Save button). */
    saving: boolean;
    /** The prompt of the run that would be saved (null = nothing to save). */
    currentPrompt: string | null;
    onSaveCurrent: (title: string, note: string) => Promise<NotebookEntry | null>;
    onUsePrompt: (prompt: string) => void;
    onClose: () => void;
  }

  let { open, store, saving, currentPrompt, onSaveCurrent, onUsePrompt, onClose }: Props = $props();
  const ns = $derived(store.state);

  let newTitle = $state('');
  let newNote = $state('');
  let savedMessage = $state<string | null>(null);
  let selectedId = $state<string | null>(null);
  let editTitle = $state('');
  let editNote = $state('');
  let confirmDelete = $state(false);

  const selected = $derived(ns.entries.find((e) => e.id === selectedId) ?? null);
  const edited = $derived(!!selected && (editTitle !== selected.title || editNote !== selected.note));

  // Opening the dialog loads the notebook and resets the save form.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      void store.load();
      savedMessage = null;
      if (saving) {
        select(null);
        newTitle = currentPrompt !== null ? defaultTitle(currentPrompt) : '';
        newNote = '';
      }
    });
  });

  function select(e: NotebookEntry | null) {
    selectedId = e?.id ?? null;
    editTitle = e?.title ?? '';
    editNote = e?.note ?? '';
    confirmDelete = false;
  }

  async function saveCurrent() {
    const entry = await onSaveCurrent(newTitle, newNote);
    if (entry) {
      savedMessage = `Saved "${entry.title}" to your notebook.`;
      newNote = '';
    }
  }

  async function saveEdits() {
    if (!selected) return;
    const ok = await store.update(selected.id, { title: editTitle, note: editNote });
    if (ok) {
      const fresh = ns.entries.find((e) => e.id === selectedId);
      if (fresh) editTitle = fresh.title;
    }
  }

  async function remove() {
    if (!selected) return;
    if (await store.remove(selected.id)) select(null);
  }

  function lastFeatures(e: NotebookEntry) {
    const r = e.run.response;
    const last = r.tokens[r.tokens.length - 1];
    const feats = r.sae_features.find((f) => f.token_index === last?.index);
    return feats ? [...feats.top_k].sort((a, b) => b.activation - a.activation).slice(0, 8) : [];
  }

  function featureUrl(e: NotebookEntry, id: number): string | null {
    return neuronpediaUrl(
      { neuronpedia_model_id: e.model.neuronpediaModelId, neuronpedia_release_suffix: e.model.neuronpediaReleaseSuffix },
      e.run.saeLayer ?? e.run.response.sae_layer_used,
      id,
    );
  }

  async function openExternal(url: string) {
    try {
      const { open: shellOpen } = await import('@tauri-apps/plugin-shell');
      await shellOpen(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function onKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notebook-title"
      class="w-full max-w-4xl rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
    >
      <div class="mb-1 flex items-center justify-between gap-3">
        <h2 id="notebook-title" class="flex items-center gap-2 text-base font-semibold text-zinc-100">
          <BookOpen class="h-4 w-4 text-indigo-400" />
          Lab notebook
        </h2>
        <button
          onclick={onClose}
          aria-label="Close notebook"
          class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
        >Close</button>
      </div>
      <p class="mb-4 text-sm text-zinc-400">
        Saved runs and your notes. They stay on this computer. You can save any of them as a web
        page to share; the page works offline and loads nothing from the internet.
      </p>

      {#if ns.error}
        <p role="alert" class="mb-4 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-400">{ns.error}</p>
      {/if}

      {#if saving}
        <section class="mb-5 rounded-md border border-indigo-800/60 bg-zinc-950 p-4" aria-label="Save this run">
          {#if currentPrompt === null}
            <p class="text-sm text-zinc-400">Run a prompt first, then save it here.</p>
          {:else}
            <label class="mb-1 block text-xs text-zinc-500" for="nb-new-title">Title</label>
            <input
              id="nb-new-title"
              bind:value={newTitle}
              class="mb-3 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            />
            <label class="mb-1 block text-xs text-zinc-500" for="nb-new-note">Your note (optional)</label>
            <textarea
              id="nb-new-note"
              bind:value={newNote}
              rows="3"
              placeholder="What did you notice? What did you expect?"
              class="mb-3 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
            ></textarea>
            <div class="flex items-center gap-3">
              <button
                onclick={saveCurrent}
                disabled={ns.busy}
                class="rounded bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
              >Save this run</button>
              {#if savedMessage}
                <span role="status" class="text-xs text-emerald-400">{savedMessage}</span>
              {/if}
            </div>
            <p class="mt-2 text-xs text-zinc-500">
              Saves the prompt, the model, its guesses, the plain-language summaries, features, and
              any other experiments you ran on this prompt. The full attention grids are not saved.
            </p>
          {/if}
        </section>
      {/if}

      {#if selected}
        <section aria-label="Saved run">
          <button onclick={() => select(null)} class="mb-3 text-xs text-indigo-300 hover:underline">← All saved runs</button>
          <label class="mb-1 block text-xs text-zinc-500" for="nb-edit-title">Title</label>
          <input
            id="nb-edit-title"
            bind:value={editTitle}
            class="mb-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
          />
          <p class="mb-3 text-xs text-zinc-500">{when(selected.createdAt)} · {selected.model.name}</p>

          <h3 class="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-500">Prompt</h3>
          <p class="mb-3 whitespace-pre-wrap break-words rounded bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200">{selected.prompt}</p>

          <label class="mb-1 block text-xs font-medium uppercase tracking-widest text-zinc-500" for="nb-edit-note">Notes</label>
          <textarea
            id="nb-edit-note"
            bind:value={editNote}
            rows="3"
            class="mb-2 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
          ></textarea>
          <div class="mb-4 flex flex-wrap items-center gap-2">
            <button
              onclick={saveEdits}
              disabled={!edited || ns.busy}
              class="rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
            >Save changes</button>
            <button
              onclick={() => { onUsePrompt(selected.prompt); onClose(); }}
              class="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-indigo-600"
            >Put this prompt back in the box</button>
            <button
              onclick={() => store.exportReport([selected.id])}
              class="inline-flex items-center gap-1 rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-indigo-600"
            ><FileDown class="h-3.5 w-3.5" />Save as web page</button>
            {#if confirmDelete}
              <span class="text-xs text-red-400">Delete this run? This can't be undone.</span>
              <button onclick={remove} class="rounded bg-red-900 px-3 py-1 text-xs text-red-200 hover:bg-red-800">Delete</button>
              <button onclick={() => (confirmDelete = false)} class="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300">Keep</button>
            {:else}
              <button onclick={() => (confirmDelete = true)} class="rounded border border-zinc-700 px-3 py-1 text-xs text-red-400 hover:border-red-700">Delete…</button>
            {/if}
          </div>

          <div class="space-y-3 text-sm text-zinc-300">
            {#each [selected.readouts.predictions, selected.readouts.attention, selected.readouts.logitLens, selected.readouts.dla, selected.readouts.features].filter(Boolean) as line}
              <p>{line}</p>
            {/each}

            {#if selected.run.response.top_predictions?.length}
              <table class="w-full text-xs">
                <thead><tr class="text-left text-zinc-500"><th class="py-1">Next word</th><th>Chance</th></tr></thead>
                <tbody>
                  {#each [...selected.run.response.top_predictions].sort((a, b) => a.rank - b.rank).slice(0, 5) as p}
                    <tr class="border-t border-zinc-800"><td class="py-1 font-mono">{quoteToken(p.token)}</td><td>{pct(p.probability)}</td></tr>
                  {/each}
                </tbody>
              </table>
            {/if}

            {#if lastFeatures(selected).length}
              <ul class="space-y-1 text-xs">
                {#each lastFeatures(selected) as h (h.id)}
                  {@const url = featureUrl(selected, h.id)}
                  <li class="flex items-center gap-2">
                    <span class="font-mono text-zinc-400">#{h.id}</span>
                    <span class="min-w-0 flex-1 truncate">{isNamedFeature(h) && h.description?.trim() ? h.description : 'no label yet'}</span>
                    {#if url}
                      <button onclick={() => openExternal(url)} class="inline-flex items-center gap-1 text-indigo-300 hover:underline">
                        <ExternalLink class="h-3 w-3" />Neuronpedia
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}

            {#if selected.experiment}
              <div class="text-xs">
                <p class="text-zinc-500">From the experiment card "{selected.experiment.title}"</p>
                <ul class="mt-1 space-y-1">
                  {#each selected.experiment.citations as c (c.url)}
                    <li>
                      <button onclick={() => openExternal(c.url)} class="inline-flex items-start gap-1 text-left text-indigo-300 hover:underline">
                        <ExternalLink class="mt-0.5 h-3 w-3 flex-shrink-0" /><span>{c.label}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        </section>
      {:else}
        <section aria-label="Saved runs">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Saved runs{ns.loaded ? ` (${ns.entries.length})` : ''}
            </h3>
            <button
              onclick={() => store.exportReport()}
              disabled={ns.entries.length === 0}
              class="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-indigo-600 disabled:opacity-40"
            ><FileDown class="h-3.5 w-3.5" />Save whole notebook as web page</button>
          </div>
          {#if ns.loaded && ns.entries.length === 0}
            <p class="text-sm text-zinc-500">Nothing saved yet. Run a prompt, then use "Save to notebook".</p>
          {:else}
            <ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
              {#each ns.entries as e (e.id)}
                <li>
                  <button onclick={() => select(e)} class="w-full px-3 py-2 text-left hover:bg-zinc-800/60">
                    <span class="block truncate text-sm text-zinc-100">{e.title}</span>
                    <span class="block text-[11px] text-zinc-500">{when(e.createdAt)} · {e.model.name}</span>
                    {#if e.note.trim()}
                      <span class="mt-0.5 block truncate text-xs text-zinc-400">{e.note}</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>
  </div>
{/if}
