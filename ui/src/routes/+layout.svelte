<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { isTauri } from '$lib/is-tauri';
  import { runtimeStatus } from '$lib/tauri';
  import '../app.css';

  let { children } = $props();
  let checked = $state(false);

  onMount(async () => {
    if (!isTauri()) {
      // Dev mode (`npm run dev` outside Tauri) — skip onboarding gate entirely.
      checked = true;
      return;
    }

    try {
      const ready = await runtimeStatus();
      const path = $page.url.pathname;
      const inWelcome = path.startsWith('/welcome');
      const onboardingDone =
        typeof localStorage !== 'undefined' &&
        localStorage.getItem('pry:onboarding_done') === 'true';

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
      console.error('[traffic-cop] runtime_status failed:', e);
      checked = true; // never block the app on a failed probe
    }
  });
</script>

<main class="min-h-screen bg-zinc-950 text-zinc-100">
  {#if checked}
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
