<!--
  InstallSheet (plan T3, Settled 8, D6): asked once when a user lesson is
  added or its permissions change. Title, author, the "preview" label, each
  permission in plain words; Allow all / Allow some / Don't allow. Only the
  entries still to OK are listed (grants.ts re-asks only new ones).
-->
<script lang="ts">
  import { lessonsCopy } from './copy';
  import type { GatedEffect, Permissions } from './grants';

  interface Props {
    title: string;
    authors?: string[];
    ask: Permissions;
    /** Network scope -> the service's host (the tool's `services`). */
    services?: Record<string, { host: string; doc: string }>;
    onAllow: (approved: Permissions) => void;
    onDeny: () => void;
  }

  let { title, authors = [], ask, services = {}, onAllow, onDeny }: Props = $props();

  type Row = { effect: GatedEffect; scope: string; text: string };
  const rows = $derived.by(() => {
    const out: Row[] = [];
    for (const scope of ask.download ?? []) out.push({ effect: 'download', scope, text: lessonsCopy.permDownload(scope) });
    for (const scope of ask.network ?? []) out.push({ effect: 'network', scope, text: lessonsCopy.permNetwork(services[scope]?.host ?? scope) });
    for (const scope of ask.external ?? []) out.push({ effect: 'external', scope, text: lessonsCopy.permExternal(scope) });
    for (const scope of ask.cost ?? []) out.push({ effect: 'cost', scope, text: lessonsCopy.permCost(scope) });
    return out;
  });

  let choosing = $state(false);
  let ticked = $state<Record<string, boolean>>({});
  const keyOf = (r: Row) => `${r.effect}:${r.scope}`;

  function approved(only?: Record<string, boolean>): Permissions {
    const out: Permissions = {};
    for (const r of rows) {
      if (only && !only[keyOf(r)]) continue;
      (out[r.effect] ??= []).push(r.scope);
    }
    return out;
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
  <div
    class="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="lesson-install-title"
    data-testid="lesson-install"
  >
    <div class="mb-1 flex items-center gap-2">
      <h2 id="lesson-install-title" class="text-base font-semibold text-zinc-100">{lessonsCopy.installTitle}</h2>
      <span class="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200" title={lessonsCopy.previewHint}>{lessonsCopy.preview}</span>
    </div>
    <p class="text-sm text-zinc-200">{title}</p>
    {#if authors.length}<p class="text-xs text-zinc-500">{lessonsCopy.installBy(authors.join(', '))}</p>{/if}
    <p class="mt-1 text-xs text-zinc-500">{lessonsCopy.previewHint}</p>
    <p class="mt-4 text-xs font-medium text-zinc-300">{lessonsCopy.installAsks}</p>
    <ul class="mt-2 flex flex-col gap-1.5">
      {#each rows as r (keyOf(r))}
        <li class="text-sm text-zinc-200">
          {#if choosing}
            <label class="flex items-center gap-2">
              <input type="checkbox" bind:checked={ticked[keyOf(r)]} class="accent-indigo-500" />
              {r.text}
            </label>
          {:else}
            <span class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-zinc-500" aria-hidden="true"></span>{r.text}</span>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="mt-5 flex flex-wrap items-center justify-end gap-2">
      <button type="button" onclick={onDeny} class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">{lessonsCopy.dontAllow}</button>
      {#if choosing}
        <button type="button" onclick={() => onAllow(approved(ticked))} class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">{lessonsCopy.allowChosen}</button>
      {:else}
        <button type="button" onclick={() => (choosing = true)} class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">{lessonsCopy.allowSome}</button>
      {/if}
      <button type="button" onclick={() => onAllow(approved())} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">{lessonsCopy.allowAll}</button>
    </div>
  </div>
</div>
