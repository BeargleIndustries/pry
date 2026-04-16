<script lang="ts">
  import { page } from '$app/stores';

  let { children } = $props();

  // Ordered onboarding steps. The step dots highlight everything up to and
  // including the current route. Steps with `hidden: true` are matched for
  // progress tracking but not rendered as dots.
  const STEPS: { path: string; label: string; hidden?: boolean }[] = [
    { path: '/welcome', label: 'Welcome' },
    { path: '/welcome/hardware', label: 'Hardware' },
    { path: '/welcome/installing', label: 'Runtime' },
    { path: '/welcome/preset', label: 'Preset' },
    { path: '/welcome/hf-token', label: 'HF Token', hidden: true },
    { path: '/welcome/downloading', label: 'Download' },
    { path: '/welcome/done', label: 'Done' },
  ];

  const visibleSteps = STEPS.filter((s) => !s.hidden);

  const currentIndex = $derived.by(() => {
    const path = $page.url.pathname.replace(/\/+$/, '') || '/welcome';
    const allIdx = STEPS.findIndex((s) => s.path === path);
    if (allIdx === -1) return 0;
    // Map the full-step index to a visible-step index (hidden steps map to
    // the preceding visible step's index).
    let visibleCount = -1;
    for (let i = 0; i <= allIdx; i++) {
      if (!STEPS[i].hidden) visibleCount++;
    }
    return Math.max(0, visibleCount);
  });
</script>

<div class="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
  <!-- Atmospheric background: radial indigo wash + subtle grid -->
  <div
    class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15),transparent_60%)]"
  ></div>
  <div
    class="pointer-events-none absolute inset-0 opacity-[0.03]"
    style="background-image: linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px); background-size: 32px 32px;"
  ></div>

  <div class="relative flex min-h-screen flex-col items-center px-6 pb-12 pt-16">
    <!-- Header -->
    <header class="mb-10 text-center">
      <div class="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-indigo-400/70">
        interpretability toolkit
      </div>
      <h1 class="text-3xl font-semibold text-zinc-100">Setting up Pry</h1>
    </header>

    <!-- Step indicator -->
    <div class="mb-10 flex items-center gap-2">
      {#each visibleSteps as step, i}
        <div
          class="h-2.5 w-2.5 rounded-full transition-all duration-300 {i <= currentIndex
            ? 'bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.6)]'
            : 'bg-zinc-700'}"
          title={step.label}
        ></div>
        {#if i < visibleSteps.length - 1}
          <div
            class="h-px w-6 transition-colors duration-300 {i < currentIndex
              ? 'bg-indigo-500/60'
              : 'bg-zinc-800'}"
          ></div>
        {/if}
      {/each}
    </div>

    <!-- Slot -->
    <div class="w-full max-w-2xl">
      {@render children()}
    </div>
  </div>
</div>
