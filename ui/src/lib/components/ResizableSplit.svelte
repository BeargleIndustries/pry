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
  // null until the user drags or a saved ratio loads; then it overrides initialRatio.
  let picked = $state<number | null>(null);
  const ratio = $derived(picked ?? initialRatio);
  let dragging = $state(false);

  // Restore persisted ratio on mount
  $effect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
          picked = parsed;
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
    picked = clampRatio(x / rect.width);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    // Critic note: restore text selection
    document.body.style.userSelect = '';
    // Critic note: persist to localStorage only on pointerup, not every pointermove
    persist();
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, ratio.toString());
    } catch { /* ignore */ }
  }

  // Keyboard resizing (T29, window-splitter pattern): Left/Right move the
  // divider 2%, Home/End jump to the narrowest/widest left side.
  function onSplitKey(e: KeyboardEvent) {
    let next: number;
    if (e.key === 'ArrowLeft') next = ratio - 0.02;
    else if (e.key === 'ArrowRight') next = ratio + 0.02;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else return;
    e.preventDefault();
    picked = clampRatio(Math.max(0.05, Math.min(0.95, next)));
    persist();
  }
</script>

<div class="flex h-full" bind:this={container}>
  <div style="width: {ratio * 100}%; min-width: {minPx}px" class="overflow-hidden">
    {@render left()}
  </div>
  <!-- False positive: a focusable role="separator" is an interactive widget in
       WAI-ARIA 1.2 (the window-splitter pattern, with aria-valuenow), but
       Svelte's role table always treats separator as non-interactive. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="w-1.5 flex-shrink-0 cursor-col-resize transition-colors touch-none focus:outline-none focus-visible:bg-indigo-400
      {dragging ? 'bg-indigo-500' : 'bg-zinc-800 hover:bg-indigo-500/50'}"
    onpointerdown={startDrag}
    onpointermove={onDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onkeydown={onSplitKey}
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    aria-label="Resize panels. Left and right arrow keys move the divider."
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(ratio * 100)}
  ></div>
  <div style="min-width: {minPx}px" class="flex-1 overflow-hidden">
    {@render right()}
  </div>
</div>
