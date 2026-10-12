<!--
  Pointer: shows which element a tip or tour step is talking about.
  Draws a ring around `target` and, when the popup's placement (placePopup)
  gives one, an arrow from the popup edge to the target. In inset mode
  (`focusRing`), a small second ring marks the exact spot inside a large
  target and the arrow stops at it. The ring follows layout changes with a
  requestAnimationFrame loop, since targets move with scrolling, tab switches
  and results arriving. Purely visual: pointer-events none, aria-hidden.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { FOCUS_RING_R, RING_PAD, type Point } from '$lib/popup/place';

  let {
    target,
    arrowFrom = null,
    arrowTo = null,
    focusRing = false,
    z = 55,
  }: {
    target: HTMLElement | null;
    arrowFrom?: Point | null;
    arrowTo?: Point | null;
    focusRing?: boolean;
    z?: number;
  } = $props();

  type Box = { x: number; y: number; w: number; h: number };

  let ring: Box | null = $state(null);

  function boxOf(el: HTMLElement): Box | null {
    if (!el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left - RING_PAD, y: r.top - RING_PAD, w: r.width + RING_PAD * 2, h: r.height + RING_PAD * 2 };
  }

  function same(a: Box | null, b: Box | null): boolean {
    if (!a || !b) return a === b;
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  }

  /** The arrow, shortened so it ends on the focus ring rather than its centre. */
  const line = $derived.by(() => {
    if (!arrowFrom || !arrowTo) return null;
    const dx = arrowTo.x - arrowFrom.x;
    const dy = arrowTo.y - arrowFrom.y;
    const len = Math.hypot(dx, dy);
    const stop = focusRing ? FOCUS_RING_R : 0;
    if (len - stop < 8) return null; // the caret alone says it
    const k = (len - stop) / len;
    return { x1: arrowFrom.x, y1: arrowFrom.y, x2: arrowFrom.x + dx * k, y2: arrowFrom.y + dy * k };
  });

  onMount(() => {
    let raf = 0;
    const loop = () => {
      const t = target ? boxOf(target) : null;
      if (!same(t, ring)) ring = t;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  });
</script>

{#if ring}
  <svg
    class="pointer-events-none fixed inset-0 h-full w-full"
    style:z-index={z}
    aria-hidden="true"
    data-popup-pointer
  >
    <defs>
      <marker id="pry-pointer-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="rgb(129 140 248)" />
      </marker>
    </defs>
    <rect
      class="pry-pointer-ring"
      x={ring.x}
      y={ring.y}
      width={ring.w}
      height={ring.h}
      rx="7"
      fill="none"
      stroke="rgb(129 140 248)"
      stroke-width="2"
    />
    {#if focusRing && arrowTo}
      <circle
        class="pry-pointer-ring"
        cx={arrowTo.x}
        cy={arrowTo.y}
        r={FOCUS_RING_R}
        fill="none"
        stroke="rgb(129 140 248)"
        stroke-width="2"
      />
    {/if}
    {#if line}
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke="rgb(129 140 248)"
        stroke-width="2"
        stroke-dasharray="5 4"
        marker-end="url(#pry-pointer-head)"
      />
    {/if}
  </svg>
{/if}

<style>
  .pry-pointer-ring {
    filter: drop-shadow(0 0 6px rgba(99, 102, 241, 0.7));
    animation: pry-pointer-pulse 1.6s ease-in-out infinite;
  }
  @keyframes pry-pointer-pulse {
    0%, 100% { stroke-opacity: 1; }
    50% { stroke-opacity: 0.45; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pry-pointer-ring { animation: none; }
  }
</style>
