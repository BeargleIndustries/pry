<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Copy, RefreshCcw, CheckCircle2, AlertTriangle } from 'lucide-svelte';
  import { bootstrapRuntime, copyDiagnostic, runtimeStatus } from '$lib/tauri';
  import {
    onBootstrapProgress,
    onBootstrapLog,
    STAGE_LABELS,
    STAGE_ORDER,
    fmtBytes,
    type BootstrapProgressEvent,
    type BootstrapStage,
  } from '$lib/bootstrap-events';
  import type { UnlistenFn } from '@tauri-apps/api/event';

  let stage = $state<BootstrapStage>('probing');
  let message = $state('Starting…');
  let progress = $state(0);
  let bytesDownloaded = $state<number | undefined>(undefined);
  let bytesTotal = $state<number | undefined>(undefined);
  let logLines = $state<string[]>([]);
  let failed = $state(false);
  let errorDetail = $state<string | null>(null);
  let diagnosticPath = $state<string | null>(null);
  let unlistenProgress: UnlistenFn | null = null;
  let unlistenLog: UnlistenFn | null = null;
  let destroyed = false;
  let doneFired = false;

  const stageIndex = $derived(STAGE_ORDER.indexOf(stage));
  const totalStages = STAGE_ORDER.length;
  const overallPct = $derived(
    Math.min(
      100,
      Math.round(((stageIndex + Math.max(0, progress)) / totalStages) * 100),
    ),
  );

  async function attachListeners() {
    let progressUnlisten: UnlistenFn;
    try {
      progressUnlisten = await onBootstrapProgress((ev: BootstrapProgressEvent) => {
        stage = ev.stage;
        message = ev.message;
        progress = ev.progress;
        bytesDownloaded = ev.bytes_downloaded;
        bytesTotal = ev.bytes_total;

        if (ev.stage === 'ready' && !doneFired) {
          doneFired = true;
          localStorage.setItem('pry:onboarding_step', 'preset');
          setTimeout(() => goto('/welcome/preset'), 600);
        }
      });
    } catch (e) {
      throw e;
    }

    // Component may have been destroyed while awaiting the first listener.
    if (destroyed) {
      progressUnlisten();
      return;
    }
    unlistenProgress = progressUnlisten;

    let logUnlisten: UnlistenFn;
    try {
      logUnlisten = await onBootstrapLog((line) => {
        logLines = [...logLines.slice(-200), line];
      });
    } catch (e) {
      // Release progress listener before re-throwing.
      progressUnlisten();
      unlistenProgress = null;
      throw e;
    }

    // Component may have been destroyed while awaiting the second listener.
    if (destroyed) {
      progressUnlisten();
      logUnlisten();
      unlistenProgress = null;
      return;
    }
    unlistenLog = logUnlisten;
  }

  async function start() {
    failed = false;
    errorDetail = null;
    logLines = [];
    stage = 'probing';
    progress = 0;
    doneFired = false;

    try {
      // If the runtime is already good, skip straight ahead.
      const ready = await runtimeStatus();
      const forceReady = $page.url.searchParams.get('runtime') === 'ready';
      if (ready || forceReady) {
        stage = 'ready';
        message = 'Runtime already installed';
        progress = 1;
        setTimeout(() => goto('/welcome/preset'), 400);
        return;
      }
      await bootstrapRuntime();
    } catch (e) {
      failed = true;
      errorDetail = e instanceof Error ? e.message : String(e);
    }
  }

  async function copyDiag() {
    try {
      diagnosticPath = await copyDiagnostic();
    } catch (e) {
      diagnosticPath = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  onMount(async () => {
    // H1 fix: catch listener-setup failures so bootstrap errors aren't silent.
    // If attachListeners throws (e.g. Tauri event bus unavailable), show the
    // error UI and skip start() entirely rather than running blind.
    try {
      await attachListeners();
    } catch (e) {
      failed = true;
      errorDetail = e instanceof Error ? e.message : String(e);
      return;
    }
    await start();
  });

  onDestroy(() => {
    destroyed = true;
    unlistenProgress?.();
    unlistenLog?.();
  });
</script>

<div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 backdrop-blur">
  <div class="mb-1 font-mono text-xs uppercase tracking-widest text-indigo-400">step 03</div>
  <h2 class="mb-2 text-2xl font-semibold text-zinc-100">Installing the runtime</h2>
  <p class="mb-6 text-sm text-zinc-400">
    Downloading a bundled Python, PyTorch, TransformerLens, and SAE Lens. This is a one-time
    setup — after this, launches are instant.
  </p>

  {#if failed}
    <div class="mb-5 rounded-lg border border-red-800 bg-red-950/40 p-5">
      <div class="mb-2 flex items-center gap-2 text-red-300">
        <AlertTriangle class="h-5 w-5" />
        <span class="font-semibold">Bootstrap failed</span>
      </div>
      <div class="mb-4 max-h-40 overflow-auto rounded border border-red-900/60 bg-black/40 p-3 font-mono text-xs text-red-300/90">
        {errorDetail}
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button
          onclick={start}
          class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <RefreshCcw class="h-4 w-4" /> Retry
        </button>
        <button
          onclick={copyDiag}
          class="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          <Copy class="h-4 w-4" /> Copy diagnostic
        </button>
        {#if diagnosticPath}
          <span class="font-mono text-xs text-zinc-500">{diagnosticPath}</span>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Current stage -->
    <div class="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div class="mb-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          {#if stage === 'ready'}
            <CheckCircle2 class="h-4 w-4 text-emerald-400" />
          {:else}
            <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
          {/if}
          <span class="text-sm font-medium text-zinc-200">{STAGE_LABELS[stage]}</span>
        </div>
        <span class="font-mono text-xs text-zinc-500">
          step {stageIndex + 1} / {totalStages}
        </span>
      </div>
      <div class="mb-2 text-xs text-zinc-400">{message}</div>

      <!-- Overall progress bar -->
      <div class="mb-1 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          class="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300"
          style="width: {overallPct}%"
        ></div>
      </div>
      <div class="flex items-center justify-between text-[10px] font-mono text-zinc-600">
        <span>{overallPct}%</span>
        {#if bytesDownloaded != null && bytesTotal != null && bytesTotal > 0}
          <span>{fmtBytes(bytesDownloaded)} / {fmtBytes(bytesTotal)}</span>
        {:else if progress < 0}
          <span>working…</span>
        {/if}
      </div>
    </div>

    <!-- Log tail -->
    <details class="mb-2 rounded-lg border border-zinc-800 bg-black/40">
      <summary class="cursor-pointer px-4 py-2 text-xs font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
        install log ({logLines.length} lines)
      </summary>
      <div class="max-h-64 overflow-auto px-4 pb-3 font-mono text-[11px] leading-relaxed text-zinc-500">
        {#each logLines.slice(-100) as line}
          <div class="whitespace-pre-wrap">{line}</div>
        {:else}
          <div class="italic text-zinc-700">waiting for output…</div>
        {/each}
      </div>
    </details>
  {/if}
</div>
