<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { SkipForward, ArrowLeft } from 'lucide-svelte';
  import PresetPickerCard from '$lib/components/PresetPickerCard.svelte';
  import {
    probeHardware,
    evaluatePresets,
    type PresetCompatibility,
  } from '$lib/tauri';

  let presets = $state<PresetCompatibility[]>([]);
  let error = $state<string | null>(null);

  interface PresetMeta {
    id: string;
    display: string;
    subtitle: string;
    size: string;
    flagship: boolean;
    locked: boolean;
  }

  const META: Record<string, PresetMeta> = {
    'gpt2-small': {
      id: 'gpt2-small',
      display: 'GPT-2 small',
      subtitle: '124M params · the classic interp playground. Start here.',
      size: '600 MB',
      flagship: true,
      locked: false,
    },
    'pythia-410m': {
      id: 'pythia-410m',
      display: 'Pythia-410M',
      subtitle: 'EleutherAI · clean training data · good for circuits work.',
      size: '1.6 GB',
      flagship: false,
      locked: false,
    },
    'pythia-1.4b': {
      id: 'pythia-1.4b',
      display: 'Pythia-1.4B',
      subtitle: 'Bigger Pythia. Needs more VRAM but sees more structure.',
      size: '5.6 GB',
      flagship: false,
      locked: false,
    },
    'gemma-2-2b': {
      id: 'gemma-2-2b',
      display: 'Gemma-2-2B',
      subtitle: 'Google · power-user tier. Requires a HuggingFace account.',
      size: '10 GB',
      flagship: false,
      locked: true,
    },
    'gemma-2-9b': {
      id: 'gemma-2-9b',
      display: 'Gemma-2-9B',
      subtitle: 'Stretch goal · 24GB+ VRAM recommended.',
      size: '36 GB',
      flagship: false,
      locked: true,
    },
  };

  onMount(async () => {
    try {
      const hw = await probeHardware();
      presets = await evaluatePresets(hw);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  function pick(id: string) {
    const meta = META[id];
    localStorage.setItem('pry:onboarding_preset', id);
    if (meta?.locked) {
      goto('/welcome/hf-token');
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
  <h2 class="mb-2 text-2xl font-semibold text-zinc-100">Pick a starter preset</h2>
  <p class="mb-6 text-sm text-zinc-400">
    A preset is a model + tokenizer + SAE bundle. You can add more later. If you're just looking
    around, skip this and grab one from inside the app.
  </p>

  {#if error}
    <div class="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
      {error}
    </div>
  {/if}

  {#if presets.length === 0 && !error}
    <div class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <div class="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></div>
      <span class="text-sm text-zinc-500">Evaluating presets…</span>
    </div>
  {/if}

  <div class="space-y-3">
    {#each presets as c (c.preset_id)}
      {@const meta = META[c.preset_id]}
      {#if meta}
        <PresetPickerCard
          compat={c}
          displayName={meta.display}
          subtitle={meta.subtitle}
          sizeLabel={meta.size}
          flagship={meta.flagship}
          locked={meta.locked}
          onpick={pick}
        />
      {/if}
    {/each}
  </div>

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
      Skip — take me in
      <SkipForward class="h-4 w-4" />
    </button>
  </div>
</div>
