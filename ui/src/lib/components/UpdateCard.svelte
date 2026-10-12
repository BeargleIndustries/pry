<script lang="ts">
  // App update notice. `card` sits inside the loading screen; `banner` is the
  // slim strip under the header used once the loading screen is gone. Both
  // read the shared `updates` store, so progress carries over between them.
  import { onMount, tick } from 'svelte';
  import { ArrowUpCircle, Loader2, X, AlertTriangle } from 'lucide-svelte';
  import { updates } from '$lib/update/update-store.svelte';
  import { UPDATE_COPY as C } from '$lib/update/update-copy';
  import { formatMb, notesExcerpt } from '$lib/update/update-core';

  let { variant = 'card' }: { variant?: 'card' | 'banner' } = $props();

  // The banner is mounted once for the app's lifetime (under the header), so
  // it owns the startup check and the aria-live announcement. The check runs
  // in the background and never blocks the model load.
  onMount(() => {
    if (variant === 'card') return updates.registerLoadingHost();
    void updates.startupCheck();
  });

  let root = $state<HTMLElement | null>(null);

  // The clicked button goes away while the update runs, so keep focus on the
  // notice itself; the status line below is announced as it changes.
  function startInstall() {
    void updates.install();
    void tick().then(() => root?.focus());
  }

  const shown = $derived(variant === 'card' ? updates.visible : updates.showBanner);
  const info = $derived(updates.info);
  const notes = $derived(notesExcerpt(info?.notes));
  const pct = $derived(
    updates.total ? Math.min(100, Math.round((updates.downloaded / updates.total) * 100)) : null,
  );
  const progressText = $derived(
    C.downloadProgress(formatMb(updates.downloaded), updates.total ? formatMb(updates.total) : null),
  );
  const statusLine = $derived(
    updates.phase === 'downloading'
      ? C.downloading
      : updates.phase === 'stopping'
        ? C.stoppingEngine
        : updates.phase === 'installing'
          ? C.installing
          : updates.phase === 'error'
            ? updates.errorKind === 'install'
              ? C.installFailed
              : C.downloadFailed
            : '',
  );
</script>

{#snippet progress()}
  {#if updates.busy}
    <div class="mt-3" data-testid="update-progress">
      <div class="flex items-baseline justify-between gap-3 text-xs">
        <span class="flex items-center gap-1.5 text-indigo-200" aria-live="polite">
          <Loader2 class="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
          {statusLine}
        </span>
        {#if updates.phase === 'downloading'}
          <span class="font-mono tabular-nums text-zinc-400">{progressText}</span>
        {/if}
      </div>
      <div
        class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-label={C.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={updates.phase === 'downloading' ? (pct ?? undefined) : 100}
        aria-valuetext={updates.phase === 'downloading' ? progressText : statusLine}
      >
        <div
          class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-300 motion-safe:transition-[width] motion-safe:duration-300"
          style="width: {updates.phase === 'downloading' ? (pct ?? 8) : 100}%"
        ></div>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet actions()}
  {#if updates.phase === 'available'}
    <button
      type="button"
      onclick={startInstall}
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
      data-testid="update-install"
    >{C.updateButton}</button>
    <button
      type="button"
      onclick={() => updates.later()}
      class="rounded-md px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
    >{C.laterButton}</button>
    <button
      type="button"
      onclick={() => updates.skip()}
      class="rounded-md px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
    >{C.skipButton}</button>
  {:else if updates.phase === 'error'}
    <button
      type="button"
      onclick={startInstall}
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
    >{C.tryAgain}</button>
    <button
      type="button"
      onclick={() => updates.later()}
      class="rounded-md px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
    >{C.dismiss}</button>
  {/if}
{/snippet}

{#if variant === 'banner'}
  <div class="sr-only" role="status" aria-live="polite">{updates.announcement}</div>
{/if}

{#if shown && info}
  {#if variant === 'card'}
    <section
      bind:this={root}
      tabindex="-1"
      class="mt-6 rounded-xl border border-indigo-800/70 bg-indigo-950/30 p-4 focus:outline-none"
      aria-labelledby="update-card-title"
      data-testid="update-card"
    >
      <div class="font-mono mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-indigo-300/80">
        <ArrowUpCircle class="h-3.5 w-3.5" aria-hidden="true" />
        <span>{C.eyebrow}</span>
      </div>
      <h3 id="update-card-title" class="font-medium text-zinc-100">{C.title(info.version)}</h3>
      <p class="mt-0.5 text-xs text-zinc-500">{C.currentVersion(info.currentVersion)}</p>

      {#if notes.lines.length}
        <div class="mt-3">
          <p class="text-xs font-medium text-zinc-400">{C.notesLabel}</p>
          <ul class="mt-1 list-disc space-y-0.5 pl-4 text-sm leading-relaxed text-zinc-300">
            {#each notes.lines as line, i (i)}
              <li>{line}{#if notes.more && i === notes.lines.length - 1}&nbsp;…{/if}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <p class="mt-3 text-xs leading-relaxed text-zinc-400">{C.keepsYourStuff}</p>

      {@render progress()}
      {#if updates.phase === 'error'}
        <p class="mt-3 flex items-center gap-1.5 text-sm text-red-300" role="alert">
          <AlertTriangle class="h-4 w-4 flex-none" aria-hidden="true" />
          {statusLine}
        </p>
      {/if}

      {#if !updates.busy}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          {@render actions()}
        </div>
      {/if}
    </section>
  {:else}
    <div
      bind:this={root}
      tabindex="-1"
      class="flex-shrink-0 border-b border-indigo-800 bg-indigo-950/60 px-4 py-2 text-sm text-indigo-100 focus:outline-none"
      data-testid="update-banner"
      role="region"
      aria-label={C.eyebrow}
    >
      <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
        <ArrowUpCircle class="h-4 w-4 flex-none text-indigo-300" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="font-medium">{C.bannerText(info.version)}</div>
          {#if updates.phase === 'error'}
            <div class="text-xs text-red-300" role="alert">{statusLine}</div>
          {:else if !updates.busy}
            <div class="text-xs text-indigo-300/70">{C.keepsYourStuff}</div>
          {/if}
          {@render progress()}
        </div>
        {#if !updates.busy}
          <div class="flex flex-none items-center gap-1.5">
            {@render actions()}
            <button
              type="button"
              onclick={() => updates.later()}
              aria-label={C.closeLabel}
              class="rounded-md p-1 text-indigo-300 hover:bg-indigo-900/60 hover:text-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
            >
              <X class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}
