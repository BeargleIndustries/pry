<script lang="ts">
  import Term from '$lib/components/Term.svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { SkipForward, ArrowLeft } from 'lucide-svelte';
  import PresetPickerCard from '$lib/components/PresetPickerCard.svelte';
  import {
    probeHardware,
    evaluatePresets,
    type PresetCompatibility,
  } from '$lib/tauri';
  import { displayName, needsHfToken } from '$lib/preset-display';
  import LicenseGateSteps from '$lib/components/LicenseGateSteps.svelte';

  let presets = $state<PresetCompatibility[]>([]);
  let error = $state<string | null>(null);
  // T31: a gated preset (Gemma) was picked; explain the license first.
  let gated = $state<PresetCompatibility | null>(null);

  onMount(async () => {
    try {
      const hw = await probeHardware();
      presets = await evaluatePresets(hw);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  function pick(id: string) {
    const c = presets.find((p) => p.preset_id === id);
    localStorage.setItem('pry:onboarding_preset', id);
    if (c && needsHfToken(c)) {
      gated = c;
    } else {
      goto('/welcome/downloading');
    }
  }

  function skip() {
    // M5 fix: don't set onboarding_done here. If the runtime isn't installed,
    // the traffic cop will redirect back to /welcome on next boot anyway — and
    // setting onboarding_done would confuse that check. Just route to / and let
    // the traffic cop decide. The user will be re-prompted if needed.
    goto('/');
  }

  function back() {
    goto('/welcome/installing');
  }
</script>

<div class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 backdrop-blur">
  <div class="mb-1 font-mono text-xs uppercase tracking-widest text-indigo-400">step 04</div>
  <h2 class="mb-2 text-2xl font-semibold text-zinc-100">Pick a starter model</h2>
  <p class="mb-6 text-sm text-zinc-400">
    Each choice is a model plus the sparse autoencoder (<Term key="sae">SAE</Term>) that goes with it. You can add more
    later. If you're just looking around, skip this and pick one from inside the app.
  </p>

  {#if error}
    <div class="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
      {error}
    </div>
  {/if}

  {#if presets.length === 0 && !error}
    <div class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
      <span class="text-sm text-zinc-500">Checking which models fit…</span>
    </div>
  {/if}

  {#if gated}
    <div class="rounded-lg border border-indigo-800/60 bg-zinc-950/40 p-5">
      <h3 class="mb-3 text-base font-semibold text-zinc-100">Before {displayName(gated)}: two steps on Hugging Face</h3>
      <LicenseGateSteps name={displayName(gated)} onAddToken={() => goto('/welcome/hf-token')} />
      <div class="mt-5 flex items-center justify-between">
        <button
          type="button"
          onclick={() => (gated = null)}
          class="text-sm text-zinc-500 hover:text-zinc-300"
        >
          Pick a different model
        </button>
        <button
          type="button"
          onclick={() => goto('/welcome/hf-token')}
          class="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          I've accepted it. Next: the token
        </button>
      </div>
    </div>
  {:else}
    <div class="space-y-3">
      {#each presets as c (c.preset_id)}
        <PresetPickerCard compat={c} locked={needsHfToken(c)} onpick={pick} />
      {/each}
    </div>
  {/if}

  <div class="mt-8 flex items-center justify-between border-t border-zinc-800 pt-6">
    <button
      onclick={back}
      class="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-5 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
    >
      <ArrowLeft class="h-4 w-4" /> Back
    </button>
    <button
      onclick={skip}
      class="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm text-zinc-500 transition hover:text-zinc-300"
    >
      Skip and take me in
      <SkipForward class="h-4 w-4" />
    </button>
  </div>
</div>
