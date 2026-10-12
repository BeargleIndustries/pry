// DOM side of placePopup: measuring targets and popups, and writing the
// result onto the popup element as data attributes the popup audit reads.

import type { Placement, Point, RectLike } from './place';

export function rectOf(el: Element | null | undefined): RectLike | null {
  if (!el || !el.isConnected || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function viewportSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

/** A [fx, fy] fraction of `r` as a viewport point (default: the centre). */
export function focusPoint(r: RectLike, frac?: [number, number]): Point {
  const [fx, fy] = frac ?? [0.5, 0.5];
  return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}

/**
 * Scroll `el`'s scrolling ancestors (then the page) so it moves up by `dy`
 * pixels (down when negative). Instant, so the next measurement sees it.
 */
function scrollByY(el: Element, dy: number): void {
  let rest = dy;
  let firstScroller: HTMLElement | null = null;
  for (let n = el.parentElement; n && Math.abs(rest) >= 1; n = n.parentElement) {
    if (!/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY)) continue;
    firstScroller ??= n;
    if (n.scrollHeight <= n.clientHeight) continue;
    const before = n.scrollTop;
    n.scrollTop = before + rest;
    rest -= n.scrollTop - before;
  }
  const page = document.scrollingElement;
  if (page && Math.abs(rest) >= 1) {
    const before = page.scrollTop;
    page.scrollTop = before + rest;
    rest -= page.scrollTop - before;
  }
  // Content at the very end of its scroller can't move up far enough: pad the
  // scroller's bottom (undone by clearSheetPadding) and scroll into the pad.
  if (rest >= 1 && firstScroller) {
    if (!padded.has(firstScroller)) padded.set(firstScroller, firstScroller.style.paddingBottom);
    const cur = parseFloat(getComputedStyle(firstScroller).paddingBottom) || 0;
    firstScroller.style.paddingBottom = `${cur + Math.ceil(rest)}px`;
    firstScroller.scrollTop += rest;
  }
}

/** Scrollers padded for the bottom sheet, with their original inline padding. */
const padded = new Map<HTMLElement, string>();

/** Undo the bottom padding scrollAboveSheet added (step change, tour closed, wide window). */
export function clearSheetPadding(): void {
  for (const [el, orig] of padded) el.style.paddingBottom = orig;
  padded.clear();
}

/**
 * Bottom sheet (narrow windows): scroll the target into the space above the
 * sheet. A target that fits there goes wholly above it; a taller one keeps
 * its focus point (where the arrow aims) about 120px above it, so the arrow
 * stays short. "Fits" counts only the scroller's visible area (a fixed header
 * above it can't be scrolled past). Returns which rule applied, for the audit.
 */
export function scrollAboveSheet(el: Element, focusY: number, sheetTop: number, gap = 10, pad = 12): SheetFit {
  const r = el.getBoundingClientRect();
  const limit = sheetTop - gap;
  let top = pad;
  for (let n = el.parentElement; n; n = n.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY)) {
      top = Math.max(pad, n.getBoundingClientRect().top);
      break;
    }
  }
  let dy = 0;
  const fit: SheetFit = r.height <= limit - top ? 'whole' : 'focus';
  if (fit === 'whole') {
    if (r.bottom > limit) dy = r.bottom - limit;
    else if (r.top < top) dy = r.top - top;
  } else {
    dy = focusY - Math.max(top + 40, limit - 120);
  }
  if (Math.abs(dy) >= 1) scrollByY(el, dy);
  return fit;
}

/** How the bottom sheet keeps its target in view: all of it, or its focus point. */
export type SheetFit = 'whole' | 'focus';

/** True when a new placement differs enough from the old one to re-render. */
export function placementChanged(a: Placement | null, b: Placement | null): boolean {
  if (!a || !b) return a !== b;
  return (
    a.mode !== b.mode ||
    a.side !== b.side ||
    a.caretEdge !== b.caretEdge ||
    a.arrowExempt !== b.arrowExempt ||
    a.largeTarget !== b.largeTarget ||
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.caret - b.caret) > 0.5 ||
    Math.abs((a.arrowTo?.x ?? 0) - (b.arrowTo?.x ?? 0)) > 0.5 ||
    Math.abs((a.arrowTo?.y ?? 0) - (b.arrowTo?.y ?? 0)) > 0.5
  );
}

/** Data attributes describing a placement, for the popup audit. */
export function placementAttrs(p: Placement | null, focus: Point | null): Record<string, string> {
  if (!p) return {};
  return {
    'data-popup-mode': p.mode,
    'data-popup-side': p.side ?? '',
    'data-popup-arrow-len': p.arrowFrom ? p.arrowLen.toFixed(1) : '',
    'data-popup-arrow-exempt': String(p.arrowExempt),
    'data-popup-large-target': String(p.largeTarget),
    'data-popup-focus': focus ? `${focus.x.toFixed(1)},${focus.y.toFixed(1)}` : '',
  };
}
