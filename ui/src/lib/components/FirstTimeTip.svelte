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
  import { tipsRegistry, type TipDef } from '$lib/tips/tips-registry';
  import { markTipSeen, isTipSeen } from '$lib/tips/coordinate';
  import { anchorState } from '$lib/tutorial/anchors';
  import { MAX_ARROW, placePopup, type Placement, type Point } from '$lib/popup/place';
  import { focusPoint, placementAttrs, rectOf, viewportSize } from '$lib/popup/measure';
  import { occupied, OCCUPIED } from '$lib/popup/occupied.svelte';
  import { POPUP_AUDIT, popupDevHooks, type ForcedTipReport } from '$lib/popup/dev';
  import Pointer from './Pointer.svelte';

  const TIP_MAX_W = 320; // matches max-w-xs (~20rem)
  const TIP_EST_H = 120;
  /** Narrowest a tip gets when a docked guide crowds a small window. */
  const TIP_MIN_W = 220;

  let activeTip: TipDef | null = $state(null);
  let position = $state<Placement | null>(null);
  let positionFocus = $state<Point | null>(null);
  let whyExpanded = $state(false);
  /** Dev-only (popup audit): the active tip was forced and must not be marked seen. */
  let forced = false;

  let targetEl: HTMLElement | null = $state(null);
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
    if (typeof document === 'undefined') return;
    if (activeTip) return;
    if (tutorialState.open) return;
    if (document.querySelector('.loading-screen')) return; // wait until the model has loaded
    for (const tip of tipsRegistry) {
      if (isTipSeen(tip.id)) continue;
      const el = document.querySelector(tip.target) as HTMLElement | null;
      // A target that's hidden, disabled or covered (a dialog, the experiment
      // guide) waits; the tip shows once it's usable again.
      if (!el || !usable(el)) continue;
      activateTip(tip, el);
      return;
    }
  }

  /** A tip only makes sense next to something on screen that you can use. */
  function usable(el: HTMLElement): boolean {
    return anchorState(el, tipEl) === 'usable';
  }

  /** Hide the current tip without marking it seen; it comes back later. */
  function release(): void {
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
    positionFocus = null;
    targetEl = null;
    prevAriaDescribedBy = null;
    forced = false;
  }

  function schedulePick(): void {
    if (pickDebounce) clearTimeout(pickDebounce);
    pickDebounce = setTimeout(() => {
      pickDebounce = null;
      pickNextTip();
    }, 50);
  }

  /** Place the tip with placePopup. A target that can't be pointed at makes the tip wait. */
  async function placeTip(): Promise<void> {
    if (!activeTip || !targetEl) return;
    await tick();
    if (!activeTip || !targetEl) return;
    const t = rectOf(targetEl);
    const focus = t ? focusPoint(t, activeTip.focus) : null;
    // Size at full width: a tip narrowed last time reports its reflowed height,
    // so scale it back to the area it would take at TIP_MAX_W.
    const w = tipEl?.offsetWidth || TIP_MAX_W;
    const h = tipEl?.offsetHeight || TIP_EST_H;
    const next = placePopup({
      target: t,
      focus: focus ?? undefined,
      size: { w: TIP_MAX_W, h: Math.ceil((h * w) / TIP_MAX_W) },
      minW: TIP_MIN_W,
      viewport: viewportSize(),
      preferred: activeTip.placement,
      previousSide: position?.side,
      previousMode: position?.mode,
      avoid: occupied.rects([OCCUPIED.tip]),
    });
    if (next.mode === 'fallback') {
      // Nowhere to point: hide without marking seen; it comes back later.
      release();
      schedulePick();
      return;
    }
    position = next;
    positionFocus = focus;
  }

  /** Arrow for the tip: only when it's short and not the far-corner fallback. */
  const tipArrow = $derived(
    position?.arrowFrom && !position.arrowExempt && position.arrowLen <= MAX_ARROW ? position : null,
  );

  // The tip is an occupied area for other popups while it's up.
  $effect(() => {
    if (!tipEl) return;
    const el = tipEl;
    // Re-place when the tip's own size changes (first render, "why?" opening).
    const ro = new ResizeObserver(() => void placeTip());
    ro.observe(el);
    const unregister = occupied.registerElement(OCCUPIED.tip, el);
    return () => {
      ro.disconnect();
      unregister();
    };
  });

  function activateTip(tip: TipDef, el: HTMLElement): void {
    activeTip = tip;
    targetEl = el;
    whyExpanded = false;

    prevAriaDescribedBy = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', `pry-tip-${tip.id}`);

    resizeObserver = new ResizeObserver(() => {
      void placeTip();
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

    void placeTip();
  }

  function dismiss(): void {
    if (!activeTip) return;
    const tip = activeTip;
    if (!forced) markTipSeen(tip.id);
    forced = false;

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
    positionFocus = null;
    targetEl = null;
    prevAriaDescribedBy = null;

    // Pick the next eligible tip.
    schedulePick();
  }

  function onWindowResize(): void {
    void placeTip();
  }

  function onWindowScroll(): void {
    void placeTip();
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
    void placeTip();
  }

  /** Dev-only: force `id` on screen (bypasses seen-state, never persists). */
  async function forceTip(id: string): Promise<ForcedTipReport> {
    const tip = tipsRegistry.find((t) => t.id === id);
    if (!tip) return { id, shown: false, waiting: false, reason: 'not in registry' };
    if (activeTip) release();
    await tick();
    const el = document.querySelector(tip.target) as HTMLElement | null;
    if (!el) return { id, shown: false, waiting: false, reason: 'target not in DOM' };
    const state = anchorState(el, null);
    if (state !== 'usable') return { id, shown: false, waiting: state === 'covered', reason: `target ${state}` };
    forced = true;
    activateTip(tip, el);
    // Let it render, measure itself and settle.
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await placeTip();
    }
    if (activeTip?.id !== id || !position) {
      return { id, shown: false, waiting: true, reason: 'no placement (target unusable)' };
    }
    return { id, shown: true, waiting: false };
  }

  // Suppress tips whenever the tutorial is open; re-scan when it closes.
  $effect(() => {
    if (tutorialState.open && activeTip) {
      // Tutorial took over mid-tip; silently release without marking seen.
      release();
    }
    if (!tutorialState.open) {
      schedulePick();
    }
  });

  onMount(() => {
    mutationObserver = new MutationObserver((mutations) => {
      // Something now covers the active tip's target (dialog), or loading started.
      if (activeTip && targetEl && (!usable(targetEl) || document.querySelector('.loading-screen'))) {
        release();
        schedulePick();
        return;
      }
      for (const m of mutations) {
        // An overlay went away: a waiting tip may be usable now.
        if (m.removedNodes.length > 0 && !activeTip) {
          schedulePick();
          return;
        }
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
        // A tip target becoming enabled (e.g. Export after the first Run).
        if (m.type === 'attributes' && !activeTip) {
          schedulePick();
          return;
        }
      }
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'hidden'],
    });

    schedulePick();

    // Dev-only (popup audit): show one tip on demand, without reading or
    // writing its seen flag. Dropped from release builds.
    if (POPUP_AUDIT) {
      popupDevHooks.forceTip = forceTip;
      popupDevHooks.clearForcedTip = () => {
        if (forced) release();
      };
    }

    return () => {
      if (POPUP_AUDIT) {
        delete popupDevHooks.forceTip;
        delete popupDevHooks.clearForcedTip;
      }
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
  <Pointer
    target={targetEl}
    arrowFrom={tipArrow?.arrowFrom}
    arrowTo={tipArrow?.arrowTo}
    focusRing={position.mode === 'inset' && !position.arrowExempt}
    z={59}
  />
  <div
    bind:this={tipEl}
    role="dialog"
    aria-modal="false"
    aria-labelledby={`pry-tip-${activeTip.id}-title`}
    id={`pry-tip-${activeTip.id}`}
    class="fixed z-[60] rounded-lg border border-indigo-700/60 bg-zinc-900 p-3 shadow-xl"
    style:top={`${position.top}px`}
    style:left={`${position.left}px`}
    style:width={`${position.width}px`}
    data-popup="tip"
    data-tip-id={activeTip.id}
    {...placementAttrs(position, positionFocus)}
    data-popup-arrow-shown={String(!!tipArrow)}
  >
    {#if position.caretEdge}
      <span
        class="pry-tip-caret pry-tip-caret-{position.caretEdge}"
        style:--caret={`${position.caret}px`}
        aria-hidden="true"
      ></span>
    {/if}
    <div class="flex items-start gap-2">
      <div class="flex-1">
        <p
          id={`pry-tip-${activeTip.id}-title`}
          class="text-[10px] font-semibold uppercase tracking-widest text-indigo-300"
        >
          {activeTip.title}
        </p>
        <p class="mt-1 text-xs leading-relaxed text-zinc-200">
          {activeTip.blurb}
        </p>
      </div>
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

<style>
  /* Caret: a small rotated square on the edge facing the target. */
  .pry-tip-caret {
    position: absolute;
    width: 12px;
    height: 12px;
    background: rgb(24 24 27); /* zinc-900 */
    border: 1px solid rgba(67, 56, 202, 0.6); /* indigo-700/60 */
    transform: rotate(45deg);
  }
  /* Named by the tip edge that carries the caret (the edge facing the target). */
  .pry-tip-caret-top { top: -7px; left: calc(var(--caret) - 6px); border-right: none; border-bottom: none; }
  .pry-tip-caret-bottom { bottom: -7px; left: calc(var(--caret) - 6px); border-left: none; border-top: none; }
  .pry-tip-caret-left { left: -7px; top: calc(var(--caret) - 6px); border-right: none; border-top: none; }
  .pry-tip-caret-right { right: -7px; top: calc(var(--caret) - 6px); border-left: none; border-bottom: none; }
</style>
