<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    initialRatio?: number;
    storageKey?: string;
    minPx?: number;
    left: Snippet;
    right: Snippet;
  }

  let {
    initialRatio = 0.5,
    storageKey = 'pry:split_ratio',
    minPx = 300,
    left,
    right,
  }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let ratio = $state(initialRatio);
  let dragging = $state(false);

  // Restore persisted ratio on mount
  $effect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
          ratio = parsed;
        }
      }
    } catch { /* localStorage may be unavailable */ }
  });

  function clampRatio(r: number): number {
    if (!container) return r;
    const w = container.clientWidth - 6; // subtract divider width
    const minRatio = minPx / w;
    const maxRatio = 1 - minRatio;
    return Math.max(minRatio, Math.min(maxRatio, r));
  }

  function startDrag(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    // Critic note: prevent text selection in panels during drag
    document.body.style.userSelect = 'none';
  }

  function onDrag(e: PointerEvent) {
    if (!dragging || !container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    ratio = clampRatio(x / rect.width);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    // Critic note: restore text selection
    document.body.style.userSelect = '';
    // Critic note: persist to localStorage only on pointerup, not every pointermove
    try {
      localStorage.setItem(storageKey, ratio.toString());
    } catch { /* ignore */ }
  }
</script>

<div class="flex h-full" bind:this={container}>
  <div style="width: {ratio * 100}%; min-width: {minPx}px" class="overflow-hidden">
    {@render left()}
  </div>
  <div
    class="w-1.5 flex-shrink-0 cursor-col-resize transition-colors touch-none
      {dragging ? 'bg-indigo-500' : 'bg-zinc-800 hover:bg-indigo-500/50'}"
    onpointerdown={startDrag}
    onpointermove={onDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    role="separator"
    aria-orientation="vertical"
  ></div>
  <div style="min-width: {minPx}px" class="flex-1 overflow-hidden">
    {@render right()}
  </div>
</div>
