<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { Download, CheckCircle2 } from 'lucide-svelte';
  import { loadPreset, type LoadProgress } from '$lib/sidecar';
  import { fmtBytes } from '$lib/bootstrap-events';
  import { isTauri } from '$lib/is-tauri';

  // LoadProgress is imported from $lib/sidecar — shared SSE event type.

  const storedPreset = typeof localStorage !== 'undefined'
    ? localStorage.getItem('pry:onboarding_preset')
    : null;
  // H2 fix: don't call goto() at module top-level. SvelteKit's router may not
  // be ready during module initialization (before component mount), which causes
  // "navigation not available" errors. The guard below in onMount handles it.
  const presetId = storedPreset ?? 'gpt2-small';

  let phase = $state<'model' | 'sae' | 'ready'>('model');
  let message = $state('Starting download…');
  let progress = $state(0);
  let bytesDownloaded = $state<number | undefined>(undefined);
  let bytesTotal = $state<number | undefined>(undefined);
  let error = $state<string | null>(null);
  let unlistenEvt: UnlistenFn | null = null;
  let sseAbort: AbortController | null = null;
  // H2 fix: guard against dual progress sources (Tauri events + SSE) both
  // firing the ready-phase goto, which causes a double-navigation error.
  let doneFired = false;
  let retrying = $state(false);

  async function retry() {
    if (retrying) return;
    retrying = true;
    error = null;
    doneFired = false;
    try {
      await startSse();
    } finally {
      retrying = false;
    }
  }

  async function startSse() {
    try {
      sseAbort = new AbortController();
      await loadPreset(presetId, applyEvent, sseAbort.signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function applyEvent(ev: LoadProgress) {
    message = ev.message;
    progress = ev.progress;
    bytesDownloaded = ev.bytes_downloaded;
    bytesTotal = ev.bytes_total;

    // Map server stage → local display phase. The server has finer-grained
    // stages (download_* vs load_*) but the UI only shows 3 dots: model, sae, ready.
    if (ev.stage === 'download_model' || ev.stage === 'load_model') {
      phase = 'model';
    } else if (ev.stage === 'download_sae' || ev.stage === 'load_sae') {
      phase = 'sae';
    } else if (ev.stage === 'ready' || ev.stage === 'already_loaded') {
      phase = 'ready';
    }

    // Treat both `ready` (fresh load) and `already_loaded` (cached fast-path)
    // as terminal — iter-2 added `already_loaded` as a server stage but the
    // frontend was only checking for `ready`, causing the UI to hang forever
    // when the sidecar had the model cached.
    const done = ev.stage === 'ready' || ev.stage === 'already_loaded';
    if (done && !doneFired) {
      doneFired = true;
      localStorage.setItem('pry:active_preset', presetId);
      localStorage.setItem('pry:onboarding_step', 'done');
      setTimeout(() => goto('/welcome/done'), 500);
    }
  }

  onMount(async () => {
    // H2 fix: redirect guard lives here so goto() runs after the router is ready.
    if (!storedPreset) {
      goto('/welcome/preset');
      return;
    }
    if (isTauri()) {
      // Prefer Tauri-emitted event channel if the sidecar rebroadcasts it.
      unlistenEvt = await listen<LoadProgress>('preset_download_progress', (e) =>
        applyEvent(e.payload),
      );
    }
    await startSse();
  });

  onDestroy(() => {
    unlistenEvt?.();
    unlistenEvt = null;
    sseAbort?.abort();
    sseAbort = null;
  });

  const pct = $derived(Math.max(0, Math.min(100, Math.round(progress * 100))));
  const phaseLabel = $derived(
    phase === 'model' ? 'Downloading model weights' :
    phase === 'sae' ? 'Downloading SAE features' :
    'Ready',
  );
</script>

<div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 backdrop-blur">
  <div class="mb-1 font-mono text-xs uppercase tracking-widest text-indigo-400">step 05</div>
  <h2 class="mb-2 text-2xl font-semibold text-zinc-100">Downloading {presetId}</h2>
  <p class="mb-6 text-sm text-zinc-400">
    Pulling weights and sparse autoencoder features from HuggingFace. Downloads are cached — next
    time this is instant.
  </p>

  {#if error}
    <div class="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
      <div class="mb-1 font-semibold">Download failed</div>
      <div class="mb-3 font-mono text-xs text-red-400/80">{error}</div>
      <button
        onclick={retry}
        disabled={retrying}
        class="rounded-md bg-red-800/50 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  {:else}
    <div class="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          {#if phase === 'ready'}
            <CheckCircle2 class="h-4 w-4 text-emerald-400" />
          {:else}
            <Download class="h-4 w-4 animate-pulse text-indigo-400" />
          {/if}
          <span class="text-sm font-medium text-zinc-200">{phaseLabel}</span>
        </div>
        <span class="font-mono text-xs text-zinc-500">{pct}%</span>
      </div>

      <div class="mb-2 text-xs text-zinc-400">{message}</div>

      <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          class="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300"
          style="width: {pct}%"
        ></div>
      </div>

      {#if bytesDownloaded != null && bytesTotal != null && bytesTotal > 0}
        <div class="mt-1 text-right font-mono text-[10px] text-zinc-600">
          {fmtBytes(bytesDownloaded)} / {fmtBytes(bytesTotal)}
        </div>
      {/if}
    </div>

    <!-- Phase indicator dots -->
    <div class="flex items-center gap-3 text-xs text-zinc-500">
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full {phase === 'model' || phase === 'sae' || phase === 'ready' ? 'bg-indigo-500' : 'bg-zinc-700'}"></div>
        <span>Model</span>
      </div>
      <div class="h-px w-4 bg-zinc-800"></div>
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full {phase === 'sae' || phase === 'ready' ? 'bg-indigo-500' : 'bg-zinc-700'}"></div>
        <span>SAE features</span>
      </div>
      <div class="h-px w-4 bg-zinc-800"></div>
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-1.5 rounded-full {phase === 'ready' ? 'bg-emerald-500' : 'bg-zinc-700'}"></div>
        <span>Ready</span>
      </div>
    </div>
  {/if}
</div>
