<!--
  FirstTimeTip — one-shot anchored popover for first-mount explanations.

  z-index: 60. Sits above SettingsDrawer (z-40) and the driven tutorial overlay
  (z-50). Tips are suppressed while the tutorial is open (see pickNextTip
  gate), so the ordering with z-50 is informational — the reason for z-60
  specifically is that a tip anchored to something inside SettingsDrawer must
  not be clipped or covered by the drawer's z-40 surface.

  Lifecycle:
    - MutationObserver on document.body (childList+subtree, 50ms debounce)
      re-runs pickNextTip() when conditionally-rendered tips (e.g. the
      expanded head detail canvas) enter the DOM.
    - IntersectionObserver on the active target (threshold 0.1) auto-dismisses
      when the target scrolls out of view.
    - Scroll listener in capture phase so nested scrolling ancestors reposition
      the popover while the target is still visible but moving.
    - aria-describedby on the target is saved on activation and restored
      (or removed) on dismiss.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
  import { tipsRegistry, type TipDef, type TipPlacement } from '$lib/tips/tips-registry';
  import { markTipSeen, isTipSeen } from '$lib/tips/coordinate';

  const TIP_MAX_W = 320; // matches max-w-xs (~20rem)
  const TIP_EST_H = 120;
  const EDGE_PAD = 8;
  const GAP = 10;

  let activeTip: TipDef | null = $state(null);
  let position: { top: number; left: number; arrow: TipPlacement } | null =
    $state(null);
  let whyExpanded = $state(false);

  let targetEl: HTMLElement | null = null;
  let tipEl: HTMLDivElement | null = $state(null);
  let prevAriaDescribedBy: string | null = null;

  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let pickDebounce: ReturnType<typeof setTimeout> | null = null;

  function tipStorageKey(id: string) {
    return `pry:tip_seen:${id}`;
  }

  function pickNextTip(): void {
    if (activeTip) return;
    if (tutorialState.open) return;
    if (typeof document === 'undefined') return;
    for (const tip of tipsRegistry) {
      if (isTipSeen(tip.id)) continue;
      const el = document.querySelector(tip.target) as HTMLElement | null;
      if (!el) continue;
      activateTip(tip, el);
      return;
    }
  }

  function schedulePick(): void {
    if (pickDebounce) clearTimeout(pickDebounce);
    pickDebounce = setTimeout(() => {
      pickDebounce = null;
      pickNextTip();
    }, 50);
  }

  function computePosition(
    target: HTMLElement,
    placement: TipPlacement,
    tipW: number,
    tipH: number,
  ): { top: number; left: number; arrow: TipPlacement } {
    const r = target.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    function place(p: TipPlacement): { top: number; left: number } {
      switch (p) {
        case 'top':
          return { top: r.top - tipH - GAP, left: r.left + r.width / 2 - tipW / 2 };
        case 'bottom':
          return { top: r.bottom + GAP, left: r.left + r.width / 2 - tipW / 2 };
        case 'left':
          return { top: r.top + r.height / 2 - tipH / 2, left: r.left - tipW - GAP };
        case 'right':
          return { top: r.top + r.height / 2 - tipH / 2, left: r.right + GAP };
      }
    }

    function fits(pos: { top: number; left: number }): boolean {
      return (
        pos.top >= EDGE_PAD &&
        pos.left >= EDGE_PAD &&
        pos.top + tipH <= vh - EDGE_PAD &&
        pos.left + tipW <= vw - EDGE_PAD
      );
    }

    const opposite: Record<TipPlacement, TipPlacement> = {
      top: 'bottom',
      bottom: 'top',
      left: 'right',
      right: 'left',
    };

    let chosen: TipPlacement = placement;
    let pos = place(chosen);
    if (!fits(pos)) {
      chosen = opposite[placement];
      pos = place(chosen);
    }
    if (!fits(pos)) {
      // Fall back to bottom-center with X clamp.
      chosen = 'bottom';
      pos = {
        top: Math.min(r.bottom + GAP, vh - tipH - EDGE_PAD),
        left: r.left + r.width / 2 - tipW / 2,
      };
    }

    // Clamp to viewport.
    pos.left = Math.max(EDGE_PAD, Math.min(pos.left, vw - tipW - EDGE_PAD));
    pos.top = Math.max(EDGE_PAD, Math.min(pos.top, vh - tipH - EDGE_PAD));

    return { top: pos.top, left: pos.left, arrow: chosen };
  }

  async function recomputePosition(): Promise<void> {
    if (!activeTip || !targetEl) return;
    await tick();
    const tipW = tipEl?.offsetWidth ?? TIP_MAX_W;
    const tipH = tipEl?.offsetHeight ?? TIP_EST_H;
    position = computePosition(targetEl, activeTip.placement, tipW, tipH);
  }

  function activateTip(tip: TipDef, el: HTMLElement): void {
    activeTip = tip;
    targetEl = el;
    whyExpanded = false;

    prevAriaDescribedBy = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', `pry-tip-${tip.id}`);

    resizeObserver = new ResizeObserver(() => {
      void recomputePosition();
    });
    resizeObserver.observe(el);

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.1) {
            dismiss();
            return;
          }
        }
      },
      { root: null, threshold: [0, 0.1, 1] },
    );
    intersectionObserver.observe(el);

    window.addEventListener('resize', onWindowResize, { passive: true });
    window.addEventListener('scroll', onWindowScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('mousedown', onMouseDown, true);

    void recomputePosition();
  }

  function dismiss(): void {
    if (!activeTip) return;
    const tip = activeTip;
    markTipSeen(tip.id);

    if (targetEl) {
      if (prevAriaDescribedBy !== null) {
        targetEl.setAttribute('aria-describedby', prevAriaDescribedBy);
      } else {
        targetEl.removeAttribute('aria-describedby');
      }
      try {
        targetEl.focus({ preventScroll: true });
      } catch {
        /* ignore — not all targets are focusable */
      }
    }

    resizeObserver?.disconnect();
    resizeObserver = null;
    intersectionObserver?.disconnect();
    intersectionObserver = null;
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('scroll', onWindowScroll, {
      capture: true,
    } as AddEventListenerOptions);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('mousedown', onMouseDown, true);

    activeTip = null;
    position = null;
    targetEl = null;
    prevAriaDescribedBy = null;

    // Pick the next eligible tip.
    schedulePick();
  }

  function onWindowResize(): void {
    void recomputePosition();
  }

  function onWindowScroll(): void {
    void recomputePosition();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismiss();
    }
  }

  function onMouseDown(e: MouseEvent): void {
    if (!tipEl) return;
    const t = e.target as Node | null;
    if (t && (tipEl.contains(t) || (targetEl && targetEl.contains(t)))) return;
    dismiss();
  }

  function toggleWhy(): void {
    whyExpanded = !whyExpanded;
    void recomputePosition();
  }

  // Suppress tips whenever the tutorial is open; re-scan when it closes.
  $effect(() => {
    if (tutorialState.open && activeTip) {
      // Tutorial took over mid-tip; silently release without marking seen.
      resizeObserver?.disconnect();
      resizeObserver = null;
      intersectionObserver?.disconnect();
      intersectionObserver = null;
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('scroll', onWindowScroll, {
        capture: true,
      } as AddEventListenerOptions);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('mousedown', onMouseDown, true);
      if (targetEl) {
        if (prevAriaDescribedBy !== null) {
          targetEl.setAttribute('aria-describedby', prevAriaDescribedBy);
        } else {
          targetEl.removeAttribute('aria-describedby');
        }
      }
      activeTip = null;
      position = null;
      targetEl = null;
      prevAriaDescribedBy = null;
    }
    if (!tutorialState.open) {
      schedulePick();
    }
  });

  onMount(() => {
    mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches?.('[data-tip]') ||
            node.querySelector?.('[data-tip]')
          ) {
            schedulePick();
            return;
          }
        }
      }
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    schedulePick();

    return () => {
      if (pickDebounce) clearTimeout(pickDebounce);
      mutationObserver?.disconnect();
      mutationObserver = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      intersectionObserver?.disconnect();
      intersectionObserver = null;
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('scroll', onWindowScroll, {
        capture: true,
      } as AddEventListenerOptions);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
  });
</script>

{#if activeTip && position}
  <div
    bind:this={tipEl}
    role="dialog"
    aria-modal="false"
    aria-labelledby={`pry-tip-${activeTip.id}-title`}
    id={`pry-tip-${activeTip.id}`}
    class="fixed z-[60] max-w-xs rounded-lg border border-indigo-700/60 bg-zinc-900 p-3 shadow-xl"
    style:top={`${position.top}px`}
    style:left={`${position.left}px`}
  >
    <div class="flex items-start gap-2">
      <p
        id={`pry-tip-${activeTip.id}-title`}
        class="flex-1 text-xs leading-relaxed text-zinc-200"
      >
        {activeTip.blurb}
      </p>
      <button
        type="button"
        onclick={dismiss}
        aria-label="Dismiss tip"
        class="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        &times;
      </button>
    </div>
    {#if activeTip.why}
      <button
        type="button"
        onclick={toggleWhy}
        class="mt-2 text-[10px] uppercase tracking-widest text-indigo-400 hover:text-indigo-300"
      >
        {whyExpanded ? 'less' : 'why?'}
      </button>
      {#if whyExpanded}
        <p class="mt-2 text-xs leading-relaxed text-zinc-400">
          {activeTip.why}
        </p>
      {/if}
    {/if}
  </div>
{/if}
