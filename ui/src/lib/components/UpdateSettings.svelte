<script lang="ts">
  // Settings drawer section: the startup-check toggle and a manual check.
  import { updates } from '$lib/update/update-store.svelte';
  import { UPDATE_COPY as C } from '$lib/update/update-copy';

  const result = $derived(updates.lastCheck);
</script>

<section class="mt-8 border-t border-zinc-800 pt-5" aria-labelledby="update-settings-title" data-testid="update-settings">
  <h3 id="update-settings-title" class="mb-3 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
    {C.settingsHeading}
  </h3>

  <div class="mb-4 flex items-center justify-between gap-3">
    <p id="update-autocheck-label" class="min-w-0 text-sm text-zinc-300">{C.autoCheckLabel}</p>
    <button
      type="button"
      role="switch"
      aria-checked={updates.autoCheck}
      aria-labelledby="update-autocheck-label"
      onclick={() => updates.setAutoCheck(!updates.autoCheck)}
      class="shrink-0 rounded-md border px-3 py-1.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 {updates.autoCheck
        ? 'border-indigo-600 bg-indigo-950/40 text-indigo-300'
        : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
    >{updates.autoCheck ? C.autoCheckOn : C.autoCheckOff}</button>
  </div>

  <div class="flex items-start justify-between gap-3">
    <p class="min-w-0 text-sm text-zinc-400" role="status" aria-live="polite" data-testid="update-check-result">
      {#if result.kind === 'checking'}
        {C.checking}
      {:else if result.kind === 'none'}
        {C.upToDate(result.version)}
      {:else if result.kind === 'available'}
        {C.available(result.version)}
        {#if result.skipped}
          <span class="text-zinc-500">{C.skippedNote(result.version)}</span>
        {/if}
      {:else if result.kind === 'error'}
        <span class="text-amber-300">{C.couldNotReach}</span>
      {/if}
    </p>
    <div class="flex shrink-0 items-center gap-2">
      {#if result.kind === 'available' && (result.skipped || !updates.visible)}
        <button
          type="button"
          onclick={() => updates.showSkipped()}
          class="rounded-md border border-indigo-600 bg-indigo-950/40 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
        >{C.showUpdate}</button>
      {/if}
      <button
        type="button"
        onclick={() => updates.checkNow()}
        aria-disabled={result.kind === 'checking' || updates.busy}
        class="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-indigo-600 hover:text-indigo-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        data-testid="update-check-now"
      >{C.checkNowButton}</button>
    </div>
  </div>

  <p class="mt-3 text-xs text-zinc-500">{C.privacyNote}</p>
</section>
