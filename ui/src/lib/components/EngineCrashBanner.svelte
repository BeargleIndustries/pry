<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertTriangle, Loader2, RotateCcw } from 'lucide-svelte';
  import { onSidecarCrashed, onSidecarRestarted, restartSidecar } from '$lib/tauri';
  import { friendlyError } from '$lib/errors';

  interface Props {
    /** Called after the engine is back (sidecar:restarted); reload the active preset here. */
    onRestarted?: () => void;
  }

  let { onRestarted }: Props = $props();

  let crashed = $state(false);
  let restarting = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    const unlisten: Array<() => void> = [];
    let disposed = false;
    const keep = (p: Promise<() => void>) =>
      p.then((u) => (disposed ? u() : unlisten.push(u))).catch(() => {});
    keep(
      onSidecarCrashed(() => {
        crashed = true;
        restarting = false;
        error = null;
      }),
    );
    keep(
      onSidecarRestarted(() => {
        crashed = false;
        restarting = false;
        error = null;
        onRestarted?.();
      }),
    );
    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
    };
  });

  async function restart() {
    if (restarting) return;
    restarting = true;
    error = null;
    try {
      await restartSidecar();
      // sidecar:restarted clears the banner; this covers a missed event.
      crashed = false;
    } catch (e) {
      error = friendlyError(e).message;
    } finally {
      restarting = false;
    }
  }
</script>

{#if crashed}
  <div
    role="alert"
    class="flex-shrink-0 border-b border-red-800 bg-red-950/70 px-4 py-2 text-sm text-red-100"
    data-testid="engine-crash-banner"
  >
    <div class="mx-auto flex max-w-3xl items-center gap-3">
      <AlertTriangle class="h-4 w-4 flex-none text-red-400" />
      <div class="min-w-0 flex-1">
        <div class="font-medium">Pry's engine stopped.</div>
        {#if error}
          <div class="mt-0.5 text-xs text-red-300">{error}</div>
        {/if}
      </div>
      <button
        type="button"
        onclick={restart}
        disabled={restarting}
        class="inline-flex flex-none items-center gap-1.5 rounded-md bg-red-800/70 px-3 py-1 text-xs font-medium text-red-50 hover:bg-red-700/80 disabled:cursor-wait disabled:opacity-70"
      >
        {#if restarting}
          <Loader2 class="h-3.5 w-3.5 animate-spin" /> Restarting…
        {:else}
          <RotateCcw class="h-3.5 w-3.5" /> Restart engine
        {/if}
      </button>
    </div>
  </div>
{/if}
