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
