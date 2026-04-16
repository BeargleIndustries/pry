<script lang="ts">
  import { goto } from '$app/navigation';
  import { ArrowRight, ChevronDown } from 'lucide-svelte';

  let expanded = $state(false);

  function start() {
    localStorage.setItem('pry:onboarding_step', 'welcome');
    goto('/welcome/hardware');
  }
</script>

<div
  class="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-10 shadow-[0_0_60px_-20px_rgba(99,102,241,0.3)] backdrop-blur"
>
  <div class="mb-6">
    <div class="mb-1 font-mono text-xs uppercase tracking-widest text-indigo-400">step 01</div>
    <h2 class="text-3xl font-semibold text-zinc-100">Welcome to Pry.</h2>
  </div>

  <p class="mb-6 text-lg leading-relaxed text-zinc-300">
    Pry open the black box — explore what's actually happening inside small transformer language
    models, locally, no cloud.
  </p>

  <p class="mb-8 text-sm leading-relaxed text-zinc-500">
    Attention patterns. Residual streams. Sparse autoencoder features. The machinery that makes
    these models tick — visible, pokeable, yours.
  </p>

  <button
    onclick={start}
    class="group inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition-all hover:bg-indigo-500 hover:shadow-[0_0_24px_-4px_rgba(99,102,241,0.8)]"
  >
    Get started
    <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
  </button>

  <div class="mt-8 border-t border-zinc-800 pt-6">
    <button
      onclick={() => (expanded = !expanded)}
      class="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
    >
      <ChevronDown class="h-4 w-4 transition-transform {expanded ? 'rotate-180' : ''}" />
      What is this?
    </button>
    {#if expanded}
      <div class="mt-4 space-y-3 text-sm leading-relaxed text-zinc-400">
        <p>
          Pry is a desktop app for mechanistic interpretability research. It runs small, open
          transformers (GPT-2, Pythia) on your own machine and gives you an interactive window
          into their internals: attention heads, MLP neurons, residual-stream decompositions, and
          SAE features.
        </p>
        <p>
          Everything runs locally. The first launch downloads a bundled Python runtime and the
          research libraries (TransformerLens, SAE Lens). After that, you pick a model preset, and
          Pry takes care of the rest.
        </p>
        <p class="text-zinc-500">
          This setup takes a couple of minutes. Grab a coffee.
        </p>
      </div>
    {/if}
  </div>
</div>
