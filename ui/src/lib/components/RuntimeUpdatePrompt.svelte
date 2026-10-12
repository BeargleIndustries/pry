<script lang="ts">
  // Non-blocking engine-update banner (T4). Shows when the runtime is usable
  // but an update applies (legacy install, stale build, or a GPU was found
  // for a CPU-only engine). The active engine keeps working until the new one
  // is fully built and verified.
  import { onMount, onDestroy } from 'svelte';
  import { Zap, Loader2, CheckCircle2, X } from 'lucide-svelte';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import {
    runtimeUpdateStatus,
    runtimeUpdate,
    onRuntimeUpdateAvailable,
    RuntimeUpdateFailure,
  } from '$lib/tauri';
  import {
    onBootstrapProgress,
    onBootstrapLog,
    STAGE_LABELS,
    fmtBytes,
    type BootstrapProgressEvent,
  } from '$lib/bootstrap-events';
  import {
    failureHeadline,
    laterKey,
    promptCopy,
    shouldPrompt,
    type RuntimeUpdateFailureKind,
    type RuntimeUpdateStatus,
  } from '$lib/runtime-update';

  type Phase = 'prompt' | 'updating' | 'done' | 'error';

  let status = $state<RuntimeUpdateStatus | null>(null);
  let phase = $state<Phase>('prompt');
  let hidden = $state(false);
  let progress = $state<BootstrapProgressEvent | null>(null);
  let lastLog = $state('');
  let errorMessage = $state<string | null>(null);
  let errorKind = $state<RuntimeUpdateFailureKind | 'unknown'>('unknown');
  let errorLogPath = $state<string | null>(null);
  let unlisten: UnlistenFn[] = [];
  let destroyed = false;
  let progressAttached = false;

  function isDeferred(key: string): boolean {
    try {
      return localStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  }

  const visible = $derived(
    !hidden && (phase !== 'prompt' || shouldPrompt(status, isDeferred)),
  );

  const stepText = $derived.by(() => {
    if (!progress) return 'Starting…';
    const label = STAGE_LABELS[progress.stage] ?? progress.stage;
    if (progress.bytes_downloaded != null && progress.bytes_total) {
      return `${label}: ${fmtBytes(progress.bytes_downloaded)} / ${fmtBytes(progress.bytes_total)}`;
    }
    return `${label}: ${progress.message}`;
  });

  function later() {
    if (status?.target_variant) {
      try {
        localStorage.setItem(laterKey(status.schema, status.target_variant), 'true');
      } catch {
        // storage unavailable: just hide for this session
      }
    }
    hidden = true;
  }

  async function updateNow() {
    phase = 'updating';
    errorMessage = null;
    progress = null;
    try {
      if (!progressAttached) {
        progressAttached = true;
        const subs = await Promise.all([
          onBootstrapProgress((ev) => (progress = ev)),
          onBootstrapLog((line) => (lastLog = line)),
        ]);
        if (destroyed) subs.forEach((u) => u());
        else unlisten.push(...subs);
      }
      await runtimeUpdate();
      phase = 'done';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      errorKind = e instanceof RuntimeUpdateFailure ? e.kind : 'unknown';
      errorLogPath = e instanceof RuntimeUpdateFailure ? e.logPath : null;
      phase = 'error';
    }
  }

  onMount(async () => {
    try {
      const u = await onRuntimeUpdateAvailable((s) => {
        if (phase === 'prompt') status = s;
      });
      if (destroyed) u();
      else unlisten.push(u);
      const s = await runtimeUpdateStatus();
      if (phase === 'prompt' && s) status = s;
    } catch (e) {
      console.warn('[runtime-update] status unavailable:', e);
    }
  });

  onDestroy(() => {
    destroyed = true;
    unlisten.forEach((u) => u());
  });
</script>

{#if visible && (status?.target_variant || phase !== 'prompt')}
  <div
    class="flex-shrink-0 border-b px-4 py-2 text-sm {phase === 'error'
      ? 'border-red-800 bg-red-950/60 text-red-100'
      : 'border-indigo-800 bg-indigo-950/60 text-indigo-100'}"
    data-testid="runtime-update-prompt"
    role="status"
  >
    <div class="mx-auto flex max-w-3xl items-center gap-3">
      {#if phase === 'updating'}
        <Loader2 class="h-4 w-4 flex-none animate-spin text-indigo-300" />
      {:else if phase === 'done'}
        <CheckCircle2 class="h-4 w-4 flex-none text-emerald-400" />
      {:else if phase === 'error'}
        <X class="h-4 w-4 flex-none text-red-400" />
      {:else}
        <Zap class="h-4 w-4 flex-none text-indigo-300" />
      {/if}

      <div class="min-w-0 flex-1">
        {#if phase === 'prompt' && status?.target_variant}
          <div class="font-medium">{promptCopy(status.current_variant, status.target_variant, status.download_mb)}</div>
        {:else if phase === 'updating'}
          <div class="truncate font-medium">
            Updating the engine. You can keep using Pry meanwhile; the model will reload at the end.
          </div>
          <div class="truncate text-xs text-indigo-300/80" title={lastLog}>{stepText}</div>
          {#if progress && progress.progress >= 0}
            <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800/60">
              <div
                class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-300 transition-all duration-300"
                style="width: {Math.round(progress.progress * 100)}%"
              ></div>
            </div>
          {/if}
        {:else if phase === 'done'}
          <div class="font-medium">Engine updated. Reload to reconnect.</div>
        {:else if phase === 'error'}
          <div class="font-medium">{failureHeadline(errorKind)}</div>
          <div class="text-xs text-red-200/80">{errorMessage}</div>
          {#if errorLogPath}
            <div class="break-all font-mono text-[11px] text-red-200/70">Log: {errorLogPath}</div>
          {/if}
        {/if}
      </div>

      {#if phase === 'prompt'}
        <button
          type="button"
          onclick={updateNow}
          class="flex-none rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
        >
          Update now
        </button>
        <button
          type="button"
          onclick={later}
          class="flex-none rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60"
        >
          Later
        </button>
      {:else if phase === 'done'}
        <button
          type="button"
          onclick={() => location.reload()}
          class="flex-none rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
        >
          Reload
        </button>
      {:else if phase === 'error'}
        {#if errorKind !== 'restart_required' && errorKind !== 'unknown'}
        <button
          type="button"
          onclick={updateNow}
          class="flex-none rounded-md bg-red-800/60 px-2.5 py-1 text-xs font-medium text-red-100 hover:bg-red-700/70"
        >
          Retry
        </button>
        {/if}
        <button
          type="button"
          onclick={() => (hidden = true)}
          class="flex-none rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/60"
        >
          Dismiss
        </button>
      {/if}
    </div>
  </div>
{/if}
