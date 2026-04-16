<script lang="ts">
  import { goto } from '$app/navigation';
  import { Sparkles, PlayCircle, ArrowRight } from 'lucide-svelte';

  function finish(withDemo: boolean) {
    localStorage.setItem('pry:onboarding_done', 'true');
    localStorage.removeItem('pry:onboarding_step');
    if (withDemo) {
      goto('/?demo=induction-heads');
    } else {
      goto('/');
    }
  }
</script>

<div
  class="relative overflow-hidden rounded-2xl border border-indigo-800/60 bg-gradient-to-br from-indigo-950/40 via-zinc-900 to-zinc-900 p-10 shadow-[0_0_80px_-20px_rgba(99,102,241,0.5)] backdrop-blur"
>
  <!-- Decorative sparkles -->
  <div
    class="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-indigo-600/20 blur-3xl"
  ></div>
  <div
    class="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl"
  ></div>

  <div class="relative">
    <div class="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-700/50 bg-indigo-950/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-indigo-300">
      <Sparkles class="h-3 w-3" /> setup complete
    </div>

    <h2 class="mb-3 text-4xl font-semibold text-zinc-100">Pry is ready.</h2>

    <p class="mb-8 max-w-lg text-lg leading-relaxed text-zinc-300">
      Let's open the black box.
    </p>

    <div class="flex flex-col gap-3 sm:flex-row">
      <button
        onclick={() => finish(true)}
        class="group inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500 hover:shadow-[0_0_24px_-4px_rgba(99,102,241,0.8)]"
      >
        <PlayCircle class="h-4 w-4" />
        Run the first demo
      </button>
      <button
        onclick={() => finish(false)}
        class="group inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-6 py-3 font-medium text-zinc-200 transition hover:bg-zinc-700"
      >
        Just take me in
        <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>

    <p class="mt-6 text-xs text-zinc-500">
      The demo walks you through the classic induction-heads experiment on GPT-2 small. Takes
      about 2 minutes.
    </p>
  </div>
</div>
