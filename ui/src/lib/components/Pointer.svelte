<!--
  Pointer: shows which element a tip or tour step is talking about.
  Draws a ring around `target` and, when `from` is given, an arrow from the
  edge of `from` (the tour card) to the ring. Follows layout changes with a
  requestAnimationFrame loop, since targets move with scrolling, tab switches
  and results arriving. Purely visual: pointer-events none, aria-hidden.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  let {
    target,
    from = null,
    z = 55,
  }: { target: HTMLElement | null; from?: HTMLElement | null; z?: number } = $props();

  type Box = { x: number; y: number; w: number; h: number };
  const PAD = 4;

  let ring: Box | null = $state(null);
  let line: { x1: number; y1: number; x2: number; y2: number } | null = $state(null);

  function boxOf(el: HTMLElement): Box | null {
    if (!el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
  }

  /** Point where the segment from the box centre toward (px, py) leaves the box. */
  function edgePoint(b: Box, px: number, py: number): { x: number; y: number } {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = px - cx;
    const dy = py - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx === 0 ? Infinity : b.w / 2 / Math.abs(dx);
    const sy = dy === 0 ? Infinity : b.h / 2 / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function overlaps(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function same<T>(a: T, b: T): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function measure() {
    const t = target ? boxOf(target) : null;
    let l: typeof line = null;
    const f = from ? boxOf(from) : null;
    if (t && f && !overlaps(t, f)) {
      const fc = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
      const tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      const start = edgePoint(f, tc.x, tc.y);
      const end = edgePoint(t, fc.x, fc.y);
      l = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    }
    if (!same(t, ring)) ring = t;
    if (!same(l, line)) line = l;
  }

  onMount(() => {
    let raf = 0;
    const loop = () => {
      measure();
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
