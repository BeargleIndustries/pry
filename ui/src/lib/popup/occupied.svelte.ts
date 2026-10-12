// TODO(pry-clarity T3): merge with place.ts occupied. This is a stub with the
// same API as T3's store so the experiment guide can register its rect; T3's
// version wins on merge.
//
// occupied: screen areas no popup may cover (the experiment guide, the update
// banner...). Surfaces register a way to measure themselves; popups read
// `rects()` when they place. `version` bumps on (un)register.

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Source = () => RectLike | null;

function measure(el: Element | null): RectLike | null {
  if (!el || !el.isConnected || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

class Occupied {
  private sources = new Map<string, Source>();
  version = $state(0);

  /** Register a surface. Returns an unregister function. */
  register(id: string, source: Source): () => void {
    this.sources.set(id, source);
    this.version++;
    return () => {
      if (this.sources.get(id) === source) {
        this.sources.delete(id);
        this.version++;
      }
    };
  }

  /** Register an element directly. */
  registerElement(id: string, el: Element): () => void {
    return this.register(id, () => measure(el));
  }

  /** Current rects, optionally leaving out some ids. */
  rects(exclude: string[] = []): RectLike[] {
    const out: RectLike[] = [];
    for (const [id, src] of this.sources) {
      if (exclude.includes(id)) continue;
      const r = src();
      if (r) out.push(r);
    }
    return out;
  }

  /** Current rects keyed by id. */
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
