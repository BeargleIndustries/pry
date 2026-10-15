// Pointing from the sidebar (plan D3, T3 `pointer.ts`): a ring on the target,
// a direction-glyph tick on the sidebar's inner edge, and a short arrow only
// when the target is within 160px of the tick (the shipped arrow rule). Mirrored
// for either side. Runner targets (`lesson:spine`, `lesson:step:<id>`,
// `lesson:image:<id>`) and tool anchors that sit inside the sidebar get the
// in-place highlight instead, never the ring/tick/arrow path (R4-10). A target
// that isn't on screen (its tab is closed) offers "Open it", which runs the
// anchor's `reveal`.

import { MAX_ARROW, type Point, type RectLike } from '../../popup/place';
import type { AnchorDef, PointerTarget } from '../registry/contract';

export type Side = 'left' | 'right';

/** Eight directions, as the glyph on the tick shows them. */
export const GLYPHS = { e: '→', w: '←', n: '↑', s: '↓', ne: '↗', nw: '↖', se: '↘', sw: '↙' } as const;
export type Dir = keyof typeof GLYPHS;

export type PointerPlan =
  | { kind: 'in-place'; target: 'spine' | 'step' | 'image' | 'anchor'; id: string | null; el: HTMLElement | null }
  | {
      kind: 'ring';
      anchor: string;
      el: HTMLElement | null;
      rect: RectLike;
      tick: { x: number; y: number; edge: Side; dir: Dir; glyph: string };
      arrow: { from: Point; to: Point } | null;
    }
  | { kind: 'hidden'; anchor: string; label: string; reveal: { action: string; args: unknown } | null };

export interface PointerEnv {
  anchors: Record<string, AnchorDef>;
  side: Side;
  /** The sidebar's rect (its inner edge carries the tick). */
  sidebar: RectLike | null;
  /** Element -> rect, or null when it isn't laid out (tests pass a fake). */
  rectOf(el: HTMLElement): RectLike | null;
  /** True when the element sits inside the sidebar. */
  inSidebar(el: HTMLElement): boolean;
  /** Finds the sidebar's own block for a runner target (`lesson:step:<id>` ...). */
  runnerEl?(kind: 'spine' | 'step' | 'image', id: string | null): HTMLElement | null;
}

export const TICK_PAD = 16;

/** The direction from `from` to `to`, in eight steps (a 22.5° band around each axis). */
export function direction(from: Point, to: Point): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI; // 0 = east, 90 = north
  const sectors: Dir[] = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se'];
  const i = Math.round(((a + 360) % 360) / 45) % 8;
  return sectors[i];
}

/** The point of `r` nearest to `p`. */
export function nearestPoint(r: RectLike, p: Point): Point {
  return { x: Math.min(Math.max(p.x, r.left), r.left + r.width), y: Math.min(Math.max(p.y, r.top), r.top + r.height) };
}

/** The tick: on the sidebar's inner edge, level with the target's focus point, kept inside the sidebar. */
export function tickFor(sidebar: RectLike, side: Side, target: RectLike, focus?: [number, number]): { x: number; y: number; edge: Side } {
  const [, fy] = focus ?? [0.5, 0.5];
  const ty = target.top + target.height * fy;
  const y = Math.min(Math.max(ty, sidebar.top + TICK_PAD), sidebar.top + sidebar.height - TICK_PAD);
  // A right-side sidebar's inner edge is its left edge, and the reverse.
  const x = side === 'right' ? sidebar.left : sidebar.left + sidebar.width;
  return { x, y, edge: side === 'right' ? 'left' : 'right' };
}

function runnerKind(name: string): { kind: 'spine' | 'step' | 'image'; id: string | null } | null {
  if (name === 'lesson:spine') return { kind: 'spine', id: null };
  const m = /^lesson:(step|image):(.+)$/.exec(name);
  return m ? { kind: m[1] as 'step' | 'image', id: m[2] } : null;
}

/** How to point at one target. */
export function planPointer(target: PointerTarget, env: PointerEnv): PointerPlan | null {
  if ('runner' in target) {
    const r = runnerKind(target.runner);
    if (!r) return null;
    const box = r.kind === 'spine' ? ((target.args as { box?: string } | undefined)?.box ?? null) : r.id;
    return { kind: 'in-place', target: r.kind, id: box, el: env.runnerEl?.(r.kind, r.id) ?? null };
  }
  const def = env.anchors[target.anchor];
  if (!def) return null;
  const el = def.locate(target.args);
  const rect = el ? env.rectOf(el) : null;
  if (!el || !rect) return { kind: 'hidden', anchor: target.anchor, label: def.label, reveal: def.reveal ?? null };
  if (env.inSidebar(el)) return { kind: 'in-place', target: 'anchor', id: target.anchor, el };
  if (!env.sidebar) return { kind: 'ring', anchor: target.anchor, el, rect, tick: { x: 0, y: 0, edge: 'left', dir: 'e', glyph: GLYPHS.e }, arrow: null };
  const t = tickFor(env.sidebar, env.side, rect, def.focus);
  const focus = def.large && def.focus ? { x: rect.left + rect.width * def.focus[0], y: rect.top + rect.height * def.focus[1] } : null;
  const aim = focus ?? nearestPoint(rect, t);
  const dir = direction(t, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  const len = Math.hypot(aim.x - t.x, aim.y - t.y);
  const arrow = len <= MAX_ARROW && len > 8 ? { from: { x: t.x, y: t.y }, to: aim } : null;
  return { kind: 'ring', anchor: target.anchor, el, rect, tick: { ...t, dir, glyph: GLYPHS[dir] }, arrow };
}

/** A sequence (`at=[a, b]`): every target keeps its highlight; the last is the active one. */
export function planSequence(targets: PointerTarget[], env: PointerEnv): { plans: (PointerPlan | null)[]; active: number } {
  return { plans: targets.map((t) => planPointer(t, env)), active: targets.length - 1 };
}
