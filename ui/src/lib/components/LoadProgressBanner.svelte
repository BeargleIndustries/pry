<script lang="ts">
  import { Download, X, AlertTriangle, Loader2 } from 'lucide-svelte';
  import type { LoadProgress } from '$lib/sidecar';

  interface Props {
    visible: boolean;
    presetId: string | null;
    phase: 'unloading' | 'loading' | 'warning' | 'error';
    progress: LoadProgress | null;
    errorMessage?: string | null;
    onRetry?: () => void;
    onDismiss?: () => void;
  }

  let {
    visible,
    presetId,
    phase,
    progress,
    errorMessage = null,
    onRetry,
    onDismiss,
  }: Props = $props();

  const pct = $derived(
    progress ? Math.max(0, Math.min(100, Math.round((progress.progress ?? 0) * 100))) : 0,
  );

  function fmtMB(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1);
  }

  const bytesLabel = $derived.by(() => {
    const done = progress?.bytes_downloaded;
    const total = progress?.bytes_total;
    if (typeof done !== 'number') return '';
    if (typeof total === 'number' && total > 0) return `${fmtMB(done)} / ${fmtMB(total)} MB`;
    return `${fmtMB(done)} MB`;
  });

  const message = $derived.by(() => {
    if (phase === 'error') return errorMessage ?? 'Load failed.';
    if (phase === 'warning') return errorMessage ?? '';
    if (phase === 'unloading') return `Unloading ${presetId ?? ''}…`;
    // loading: prefer the sidecar's stage message ("Preparing features…", …)
    const pStr = progress ? ` (${pct}%)` : '';
    const what = progress?.message?.trim() || `Loading ${presetId ?? ''}…`;
    return `${what}${pStr}`;
  });

  const barClass = $derived(
    phase === 'error'
      ? 'bg-red-950/70 border-red-800 text-red-100'
      : phase === 'warning'
      ? 'bg-yellow-950/60 border-yellow-800 text-yellow-100'
      : 'bg-indigo-950/70 border-indigo-800 text-indigo-100',
  );
</script>

{#if visible}
  <div
    class="sticky top-0 z-20 w-full border-b px-4 py-2 text-sm {barClass}"
    data-testid="load-progress-banner"
  >
    <div class="mx-auto flex max-w-3xl items-center gap-3">
      {#if phase === 'error'}
        <X class="h-4 w-4 flex-none text-red-400" />
      {:else if phase === 'warning'}
        <AlertTriangle class="h-4 w-4 flex-none text-yellow-400" />
      {:else if phase === 'unloading'}
        <Loader2 class="h-4 w-4 flex-none animate-spin text-indigo-300" />
      {:else}
        <Download class="h-4 w-4 flex-none animate-pulse text-indigo-300" />
      {/if}

      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-3">
          <div class="min-w-0 flex-1 truncate font-medium">{message}</div>
          {#if phase === 'loading' && bytesLabel}
            <div class="flex-none font-mono text-xs tabular-nums text-indigo-300" data-testid="load-bytes">
              {bytesLabel}
            </div>
          {/if}
        </div>
        {#if phase === 'loading' || phase === 'unloading'}
          <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800/60">
            <div
              class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-300 transition-all duration-300"
              style="width: {phase === 'loading' ? pct : 100}%"
            ></div>
          </div>
        {/if}
      </div>

      {#if phase === 'error' && onRetry}
        <button
          type="button"
          onclick={onRetry}
          class="flex-none rounded-md bg-red-800/60 px-2.5 py-1 text-xs font-medium text-red-100 hover:bg-red-700/70"
        >
          Retry
        </button>
      {/if}
      {#if (phase === 'warning' || phase === 'error') && onDismiss}
        <button
          type="button"
          onclick={onDismiss}
          class="flex-none rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60"
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      {/if}
    </div>
  </div>
{/if}
