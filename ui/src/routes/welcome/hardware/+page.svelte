<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ArrowRight, ArrowLeft } from 'lucide-svelte';
  import HardwareCard from '$lib/components/HardwareCard.svelte';
  import PresetList from '$lib/components/PresetList.svelte';
  import {
    probeHardware,
    evaluatePresets,
    type HardwareReport,
    type PresetCompatibility,
  } from '$lib/tauri';

  let report = $state<HardwareReport | null>(null);
  let presets = $state<PresetCompatibility[]>([]);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const hw = await probeHardware();
      report = hw;
      presets = await evaluatePresets(hw);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  function next() {
    localStorage.setItem('pry:onboarding_step', 'installing');
    goto('/welcome/installing');
  }

  function back() {
    goto('/welcome');
  }
</script>

<div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 backdrop-blur">
  <div class="mb-1 font-mono text-xs uppercase tracking-widest text-indigo-400">step 02</div>
  <h2 class="mb-2 text-2xl font-semibold text-zinc-100">Checking your hardware</h2>
  <p class="mb-6 text-sm text-zinc-400">
    Pry needs to know what it's working with so it can pick sane defaults for batch sizes, dtype,
    and which presets actually fit.
  </p>

  {#if error}
    <div class="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
      <div class="mb-1 font-semibold">Hardware probe failed</div>
      <div class="font-mono text-xs text-red-400/80">{error}</div>
    </div>
  {:else if !report}
    <div class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
      <span class="text-sm text-zinc-500">Probing GPU and drivers…</span>
    </div>
  {:else}
    <HardwareCard {report} />
    {#if presets.length > 0}
      <PresetList compatibilities={presets} />
    {/if}
  {/if}

  <div class="mt-8 flex items-center justify-between border-t border-zinc-800 pt-6">
    <button
      onclick={back}
      class="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-5 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
    >
      <ArrowLeft class="h-4 w-4" /> Back
    </button>
    <button
      onclick={next}
      disabled={!report}
      class="group inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Continue
      <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  </div>
</div>
