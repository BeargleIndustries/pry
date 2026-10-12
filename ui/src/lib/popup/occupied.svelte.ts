// occupied: screen areas no popup may cover (the experiment guide, the update
// banner, the tour card while a tip is up...). Surfaces register a way to
// measure themselves; popups read `rects()` when they place, so the store
// never holds stale geometry.

import type { RectLike } from './place';

type Source = () => RectLike | null;

function measure(el: Element | null): RectLike | null {
  if (!el || !el.isConnected || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

class Occupied {
  // Deliberately not reactive: surfaces register from inside effects, and a
  // reactive counter read-and-written there would loop. Popups re-measure on
  // their own (every frame, or on scroll/resize/size changes).
  private sources = new Map<string, Source>();

  /** Register a surface. Returns an unregister function. */
  register(id: string, source: Source): () => void {
    this.sources.set(id, source);
    return () => {
      if (this.sources.get(id) === source) this.sources.delete(id);
    };
  }

  /** Register an element directly. */
  registerElement(id: string, el: Element): () => void {
    return this.register(id, () => measure(el));
  }

  /** Register whatever currently matches `selector` (first visible match). */
  registerSelector(id: string, selector: string): () => void {
    return this.register(id, () => {
      if (typeof document === 'undefined') return null;
      for (const el of document.querySelectorAll(selector)) {
        const r = measure(el);
        if (r) return r;
      }
      return null;
    });
  }

  /** Current rects, optionally leaving out some ids (a popup never avoids itself). */
  rects(exclude: string[] = []): RectLike[] {
    const out: RectLike[] = [];
    for (const [id, src] of this.sources) {
      if (exclude.includes(id)) continue;
      const r = src();
      if (r) out.push(r);
    }
    return out;
  }

  /** Current rects keyed by id (the popup audit reports which one was hit). */
  entries(): [string, RectLike][] {
    const out: [string, RectLike][] = [];
    for (const [id, src] of this.sources) {
      const r = src();
      if (r) out.push([id, r]);
    }
    return out;
  }
}

export const occupied = new Occupied();

/** Ids used by the app's surfaces. */
export const OCCUPIED = {
  guide: 'experiment-guide',
  updateBanner: 'update-banner',
  tourCard: 'tour-card',
  tip: 'first-time-tip',
} as const;
