<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { isTauri } from '$lib/is-tauri';
  import { bootstrapRuntime, runtimeReadiness } from '$lib/tauri';
  import { friendlyError } from '$lib/errors';
  import '../app.css';

  let { children } = $props();
  let checked = $state(false);
  // P2-10: an app upgrade whose engine only needs its sidecar code synced.
  let updating = $state(false);
  let updateError = $state<string | null>(null);

  async function syncRuntime() {
    updating = true;
    updateError = null;
    try {
      await bootstrapRuntime();
      updating = false;
    } catch (e) {
      updateError = friendlyError(e).message;
    }
  }

  function continueAnyway() {
    updating = false;
    updateError = null;
  }

  onMount(async () => {
    if (!isTauri()) {
      // Dev mode (`npm run dev` outside Tauri) — skip onboarding gate entirely.
      checked = true;
      return;
    }

    try {
      const r = await runtimeReadiness();
      const ready = r.usable;
      const needsSync = r.needs_sidecar_sync;
      const path = $page.url.pathname;
      const inWelcome = path.startsWith('/welcome');
      const onboardingDone =
        typeof localStorage !== 'undefined' &&
        localStorage.getItem('pry:onboarding_done') === 'true';

      if (ready && needsSync && onboardingDone && !inWelcome) {
        // Don't send an upgraded user back through onboarding: update in place.
        checked = true;
        await syncRuntime();
        return;
      }
      if (!ready && !inWelcome) {
        await goto('/welcome', { replaceState: true });
        // After goto completes, URL has changed to /welcome. Unblock rendering
        // so the new route actually mounts. Setting this BEFORE goto would
        // flash the main app briefly; AFTER goto renders straight to /welcome.
        checked = true;
        return;
      }
      if (ready && !onboardingDone && !inWelcome) {
        await goto('/welcome?runtime=ready', { replaceState: true });
        checked = true;
        return;
      }
      // Staying on current route — unblock rendering now.
      checked = true;
    } catch (e) {
      console.error('[traffic-cop] runtime_readiness failed:', e);
      checked = true; // never block the app on a failed probe
    }
  });
</script>

<main class="min-h-screen bg-zinc-950 text-zinc-100">
  {#if checked && updating}
    <div class="flex min-h-screen items-center justify-center px-6">
      <div class="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 text-center">
        {#if updateError}
          <p class="mb-2 text-sm font-medium text-zinc-100">Pry couldn't finish updating.</p>
          <p class="mb-4 text-xs text-red-400">{updateError}</p>
          <div class="flex justify-center gap-2">
            <button
              type="button"
              onclick={syncRuntime}
              class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-500"
            >Try again</button>
            <button
              type="button"
              onclick={continueAnyway}
              class="rounded-md bg-zinc-800 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
            >Continue anyway</button>
          </div>
        {:else}
          <div class="mb-3 flex items-center justify-center gap-3 text-zinc-300">
            <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
            <span class="font-mono text-sm tracking-wide">Updating Pry…</span>
          </div>
          <p class="text-xs text-zinc-500">Finishing the upgrade. This takes a few seconds.</p>
        {/if}
      </div>
    </div>
  {:else if checked}
    {@render children()}
  {:else}
    <div class="flex min-h-screen items-center justify-center">
      <div class="flex items-center gap-3 text-zinc-500">
        <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
        <span class="font-mono text-sm tracking-wide">Loading Pry…</span>
      </div>
    </div>
  {/if}
</main>
