<script lang="ts">
  import { onMount } from 'svelte';
  import { Cpu, Loader2, RotateCcw } from 'lucide-svelte';
  import { health } from '$lib/sidecar';
  import { onSidecarCrashed, onSidecarRestarted, restartSidecar } from '$lib/tauri';
  import type { PresetCompatibility } from '$lib/tauri';
  import type { SidecarHealth } from '$lib/types';
  import { displayName } from '$lib/preset-display';
  import { friendlyError } from '$lib/errors';
  import { isTauri } from '$lib/is-tauri';

  interface Props {
    compatibilities: PresetCompatibility[] | null;
    /** Bump to re-read /health (e.g. after a model finishes loading). */
    refreshKey?: number;
  }

  let { compatibilities, refreshKey = 0 }: Props = $props();

  let h = $state<SidecarHealth | null>(null);
  let offline = $state(false);
  let open = $state(false);
  let restarting = $state(false);
  let restartError = $state<string | null>(null);
  let rootEl: HTMLDivElement | null = $state(null);

  async function refresh() {
    try {
      h = await health();
      offline = false;
    } catch {
      h = null;
      offline = true;
    }
  }

  $effect(() => {
    void refreshKey;
    void refresh();
  });

  onMount(() => {
    const unlisten: Array<() => void> = [];
    let disposed = false;
    const keep = (p: Promise<() => void>) =>
      p.then((u) => (disposed ? u() : unlisten.push(u))).catch(() => {});
    keep(
      onSidecarCrashed(() => {
        h = null;
        offline = true;
      }),
    );
    keep(onSidecarRestarted(() => void refresh()));
    const onDoc = (e: MouseEvent) => {
      if (open && rootEl && !rootEl.contains(e.target as Node)) open = false;
    };
    window.addEventListener('click', onDoc);
    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
      window.removeEventListener('click', onDoc);
    };
  });

  const device = $derived.by(() => {
    if (!h) return offline ? 'Engine offline' : 'Engine…';
    if (h.device === 'cuda') return h.gpu_name ? `GPU (${h.gpu_name})` : 'GPU';
    if (h.device === 'cpu') return 'CPU';
    return 'Engine ready';
  });

  const model = $derived(h?.loaded_preset ? displayName(h.loaded_preset, compatibilities) : null);
  const layerText = $derived(h?.sae_layer != null ? `feature layer ${h.sae_layer}` : null);

  async function restart() {
    if (restarting) return;
    restarting = true;
    restartError = null;
    try {
      await restartSidecar();
      await refresh();
    } catch (e) {
      restartError = friendlyError(e).message;
    } finally {
      restarting = false;
    }
  }
</script>

<div bind:this={rootEl} class="relative flex-shrink-0">
  <button
    type="button"
    onclick={() => (open = !open)}
    class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] {offline
      ? 'border-red-800 bg-red-950/40 text-red-300'
      : 'border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:bg-zinc-800'}"
    aria-haspopup="dialog"
    aria-expanded={open}
    title="Engine status"
    data-testid="engine-status-chip"
  >
    <span
      class="h-1.5 w-1.5 rounded-full {offline ? 'bg-red-500' : h ? 'bg-emerald-400' : 'bg-zinc-500'}"
    ></span>
    <Cpu class="h-3.5 w-3.5 opacity-70" />
    <span class="max-w-[14rem] truncate">{device}</span>
    {#if model}
      <span class="hidden text-zinc-500 2xl:inline">
        · {model}{#if layerText}&nbsp;· {layerText}{/if}
      </span>
    {/if}
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-zinc-700 bg-zinc-900 p-3 text-xs shadow-xl"
      role="dialog"
      aria-label="Engine status"
    >
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt class="text-zinc-500">Device</dt>
        <dd class="truncate text-zinc-200">{device}</dd>
        <dt class="text-zinc-500">Model</dt>
        <dd class="truncate text-zinc-200">{model ?? 'None loaded'}</dd>
        <dt class="text-zinc-500">Feature layer</dt>
        <dd class="text-zinc-200">{h?.sae_layer ?? '—'}</dd>
        {#if h?.torch}
          <dt class="text-zinc-500">PyTorch</dt>
          <dd class="truncate text-zinc-400">{h.torch}{h.cuda ? ` · CUDA ${h.cuda}` : ''}</dd>
        {/if}
        {#if h?.version}
          <dt class="text-zinc-500">Engine</dt>
          <dd class="text-zinc-400">v{h.version}</dd>
        {/if}
      </dl>
      {#if restartError}
        <p class="mt-2 text-red-400">{restartError}</p>
      {/if}
      {#if isTauri()}
        <button
          type="button"
          onclick={restart}
          disabled={restarting}
          class="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-zinc-200 hover:border-indigo-600 hover:text-indigo-200 disabled:cursor-wait disabled:opacity-60"
        >
          {#if restarting}
            <Loader2 class="h-3.5 w-3.5 animate-spin" /> Restarting…
          {:else}
            <RotateCcw class="h-3.5 w-3.5" /> Restart engine
          {/if}
        </button>
      {/if}
    </div>
  {/if}
</div>
