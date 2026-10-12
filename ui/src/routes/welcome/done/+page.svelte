<script lang="ts">
  import { goto } from '$app/navigation';
  import { Sparkles, PlayCircle, ArrowRight, Copy } from 'lucide-svelte';

  type Next = 'copying-heads' | 'tour' | 'skip';

  function finish(next: Next) {
    localStorage.setItem('pry:onboarding_done', 'true');
    localStorage.removeItem('pry:onboarding_step');
    if (next === 'tour') {
      goto('/?demo=tour');
      return;
    }
    // Not taking the tour now: don't auto-start it. It's still under the ? icon.
    localStorage.setItem('pry:tutorial_seen', 'true');
    goto(next === 'copying-heads' ? '/?demo=induction-heads' : '/');
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

    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <button
        onclick={() => finish('copying-heads')}
        class="group inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:bg-indigo-500 hover:shadow-[0_0_24px_-4px_rgba(99,102,241,0.8)]"
      >
        <Copy class="h-4 w-4" />
        Find the copying heads
      </button>
      <button
        onclick={() => finish('tour')}
        class="group inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-6 py-3 font-medium text-zinc-200 transition hover:bg-zinc-700"
      >
        <PlayCircle class="h-4 w-4" />
        Start the guided tour
      </button>
      <button
        onclick={() => finish('skip')}
        class="group inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-6 py-3 font-medium text-zinc-200 transition hover:bg-zinc-700"
      >
        Just take me in
        <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>

    <p class="mt-6 text-xs text-zinc-500">
      <span class="text-zinc-400">Find the copying heads</span> gives the model you just set up a short
      test: 25 random word-pieces, then the same ones again. Pry then rings the attention heads that,
      the second time through, look at whatever came next last time. That is one way models copy.
    </p>
    <p class="mt-2 text-xs text-zinc-500">
      <span class="text-zinc-400">The guided tour</span> walks you through two guided demos on GPT-2
      small: one on attention (which words the model looks at) and one on features (which concepts
      light up). You can start it anytime from the ? icon.
    </p>
  </div>
</div>
