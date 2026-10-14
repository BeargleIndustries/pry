// placePopup: one placement rule for every popup that points at something
// (tour card, first-time tips, glossary tooltips, cell hover tooltips).
//
// Pure geometry, no DOM: callers measure the target, the popup and the
// `occupied` rects, and apply the result. Rules, in order:
//   1. sheet     viewport narrower than `sheetBelow` (tour card only): a
//                full-width card along the bottom, arrow up to the focus point.
//   2. anchored  beside the target: previousSide (if it still fits), preferred,
//                opposite, then the two cross sides. Must sit inside the
//                viewport minus edgePad and touch neither the target nor any
//                `avoid` rect.
//      (minW)    if no side fits, the same at narrower widths down to minW.
//   3. inset     only for a target too large to sit beside (the caller says
//                so with `large`, it covers more than half the viewport, or
//                no side of it has room for the popup): inside the target,
//                next to the focus point on the side with the most room. The
//                target corner farthest from focus is only a fallback
//                (arrowExempt).
//      nearest   a small target with no side free (crowded by `avoid` rects):
//                the closest spot that covers neither the target nor any
//                avoid rect, reported as anchored. If there is none, the popup
//                is clamped into the viewport (inset, arrowExempt; the audit
//                fails it).
//   4. fallback  no target, or the target is off screen.
// Every non-fallback result carries an arrow (arrowFrom on the popup edge,
// arrowTo at the target or focus) and a caret offset lined up with it.

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type PlaceMode = 'anchored' | 'inset' | 'sheet' | 'fallback';

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Rect extends RectLike {
  right: number;
  bottom: number;
}

export interface PlaceInput {
  /** Target rect in viewport coordinates; null (or off screen) gives `fallback`. */
  target: RectLike | null;
  /** Viewport point inside the target the arrow aims at. Default: target centre. */
  focus?: Point;
  size: { w: number; h: number };
  viewport: { w: number; h: number };
  preferred: Side;
  /** Hysteresis: the side used last time. Kept while it still fits. */
  previousSide?: Side | null;
  /** The mode used last time (hysteresis applies within the same mode). */
  previousMode?: PlaceMode | null;
  gap?: number;
  edgePad?: number;
  /** Rects no popup may cover (experiment guide, update banner, another popup). */
  avoid?: RectLike[];
  /** Tour card only: viewports narrower than this get the bottom sheet. */
  sheetBelow?: number;
  /**
   * Allow narrowing the popup down to this width (its text reflows, so the
   * height grows to keep the area) when it can't sit beside the target or
   * next to the focus point at full width. The result's `width` says how wide.
   */
  minW?: number;
  /** The caller knows the target is one of the big panels (tour LARGE_TARGETS): inset is allowed. */
  large?: boolean;
}

export interface Placement {
  top: number;
  left: number;
  /** Width to apply (differs from size.w only for the sheet, or when clamped). */
  width: number;
  height: number;
  /** Side of the target the popup sits on (anchored), or of the focus point (inset). */
  side: Side | null;
  /** Offset of the caret along the popup edge that faces the target. */
  caret: number;
  /** Which popup edge carries the caret (the edge facing the target). */
  caretEdge: Side | null;
  arrowFrom: Point | null;
  arrowTo: Point | null;
  arrowLen: number;
  /** Inset far-corner fallback: the ring shows, the arrow doesn't. */
  arrowExempt: boolean;
  mode: PlaceMode;
  /** The target counted as too large to sit beside, so inset (covering it) was allowed. */
  largeTarget: boolean;
}

export const DEFAULT_GAP = 10;
export const DEFAULT_EDGE_PAD = 12;
/** Narrower than this, the tour card docks as a bottom sheet (decision 4). */
export const DEFAULT_SHEET_BELOW = 760;
/** Radius of the ring drawn around the focus point in inset mode. */
export const FOCUS_RING_R = 14;
/** Arrows longer than this are not drawn (and fail the popup audit). */
export const MAX_ARROW = 160;
export const CARET_INSET = 14;
/** Pad the Pointer ring adds around the target. */
export const RING_PAD = 4;

/** Whether a popup draws its arrow: only when short, and never for the inset far-corner fallback. */
export function arrowShown(p: Placement | null): boolean {
  return !!p?.arrowFrom && !p.arrowExempt && p.arrowLen <= MAX_ARROW;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

export function toRect(r: RectLike): Rect {
  return rect(r.left, r.top, r.width, r.height);
}

/** Strict overlap: rects that only touch along an edge don't intersect. */
export function intersects(a: RectLike, b: RectLike): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

export function contains(r: RectLike, p: Point): boolean {
  return p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
}

/** True when the disc of radius `r` around `p` touches the rect. */
export function coversPoint(box: RectLike, p: Point, r = 0): boolean {
  const cx = clamp(p.x, box.left, box.left + box.width);
  const cy = clamp(p.y, box.top, box.top + box.height);
  return Math.hypot(p.x - cx, p.y - cy) < r || contains(box, p);
}

export function insideViewport(box: RectLike, vp: { w: number; h: number }, pad = 0): boolean {
  const e = 0.5; // sub-pixel slack
  return (
    box.left >= pad - e &&
    box.top >= pad - e &&
    box.left + box.width <= vp.w - pad + e &&
    box.top + box.height <= vp.h - pad + e
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function intersection(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return rect(left, top, right - left, bottom - top);
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const CROSS: Record<Side, Side[]> = {
  top: ['right', 'left'],
  bottom: ['right', 'left'],
  left: ['bottom', 'top'],
  right: ['bottom', 'top'],
};

function vertical(side: Side): boolean {
  return side === 'top' || side === 'bottom';
}

/** Candidate positions along one axis: the ideal one, then ones that slide past each avoid rect. */
function crossCandidates(ideal: number, size: number, lo: number, hi: number, avoid: Rect[], gap: number, axis: 'x' | 'y'): number[] {
  const out = [clamp(ideal, lo, hi - size)];
  const extra: number[] = [];
  for (const a of avoid) {
    const start = axis === 'x' ? a.left : a.top;
    const end = axis === 'x' ? a.right : a.bottom;
    extra.push(clamp(end + gap, lo, hi - size), clamp(start - gap - size, lo, hi - size));
  }
  extra.sort((p, q) => Math.abs(p - ideal) - Math.abs(q - ideal));
  for (const v of extra) if (!out.includes(v)) out.push(v);
  return out;
}

/** Arrow from the popup edge facing the target/focus to `to`, with the caret on that edge. */
function arrowFor(box: Rect, edge: Side, to: Point): { from: Point; caret: number; len: number } {
  if (vertical(edge)) {
    const x = clamp(to.x, box.left + CARET_INSET, box.right - CARET_INSET);
    const y = edge === 'top' ? box.top : box.bottom;
    return { from: { x, y }, caret: x - box.left, len: Math.hypot(to.x - x, to.y - y) };
  }
  const y = clamp(to.y, box.top + CARET_INSET, box.bottom - CARET_INSET);
  const x = edge === 'left' ? box.left : box.right;
  return { from: { x, y }, caret: y - box.top, len: Math.hypot(to.x - x, to.y - y) };
}

function result(
  box: Rect,
  mode: PlaceMode,
  side: Side | null,
  edge: Side | null,
  to: Point | null,
  arrowExempt = false,
): Placement {
  if (!edge || !to) {
    return {
      top: box.top, left: box.left, width: box.width, height: box.height,
      side, caret: 0, caretEdge: null, arrowFrom: null, arrowTo: null, arrowLen: 0, arrowExempt, mode,
      largeTarget: false,
    };
  }
  const a = arrowFor(box, edge, to);
  return {
    top: box.top, left: box.left, width: box.width, height: box.height,
    side, caret: a.caret, caretEdge: edge, arrowFrom: a.from, arrowTo: to, arrowLen: a.len, arrowExempt, mode,
    largeTarget: false,
  };
}

/**
 * The viewport minus side-docked surfaces: an avoid rect that runs most of the
 * window's height along its left or right edge (the Lessons sidebar or its
 * rail) narrows the area a popup may use, so "room beside the target" counts
 * only the app's side of it. Kept as is when what's left can't hold the popup.
 */
function sideDocked(view: Rect, avoid: Rect[], vp: { w: number; h: number }, pad: number, minW: number): Rect {
  let left = view.left;
  let right = view.right;
  for (const a of avoid) {
    if (a.height < vp.h * 0.6) continue;
    if (a.left <= 1) left = Math.max(left, a.right + pad);
    else if (a.right >= vp.w - 1) right = Math.min(right, a.left - pad);
  }
  if (right - left < Math.min(minW, 220)) return view;
  return rect(left, view.top, right - left, view.height);
}

/** Bottom edge for a bottom-docked surface spanning [left, right]: above any bottom-docked avoid rect. */
function dockBottom(left: number, right: number, vp: { w: number; h: number }, pad: number, gap: number, avoid: Rect[]): number {
  let bottom = vp.h - pad;
  for (const a of avoid) {
    if (a.right <= left || a.left >= right) continue;
    if (a.top < vp.h / 2) continue; // only docks along the bottom push the card up
    bottom = Math.min(bottom, a.top - gap);
  }
  return bottom;
}

// ---------------------------------------------------------------------------
// placePopup
// ---------------------------------------------------------------------------

export function placePopup(input: PlaceInput): Placement {
  const full = placeAtSize(input, 'beside');
  if (full) return full;
  const narrower = (stage: Stage): Placement | null => {
    if (!input.minW) return null;
    const { w, h } = input.size;
    for (let nw = w - 20; nw >= input.minW; nw -= 20) {
      const p = placeAtSize({ ...input, size: { w: nw, h: Math.ceil((h * w) / nw) } }, stage);
      if (p && placedWell(p)) return p;
    }
    return null;
  };
  // A narrower popup beside the target beats one inside it or farther away.
  const beside = narrower('beside');
  if (beside) return beside;
  const first = placeAtSize(input, 'rest')!;
  if (placedWell(first)) return first;
  // Crowded (say, a docked guide taking most of a narrow window): keep the
  // widest popup that lands next to the focus point or near the target.
  return narrower('rest') ?? first;
}

/** Beside the target, near it, or next to the focus point inside a large one. */
function placedWell(p: Placement): boolean {
  return p.mode !== 'inset' || !p.arrowExempt;
}

/** 'beside': only sheet, fallback or anchored (else null). 'rest': inset or the nearest free spot. */
type Stage = 'beside' | 'rest';

function placeAtSize(input: PlaceInput, stage: Stage): Placement | null {
  const gap = input.gap ?? DEFAULT_GAP;
  const pad = input.edgePad ?? DEFAULT_EDGE_PAD;
  const vp = input.viewport;
  const avoid = (input.avoid ?? []).map(toRect).filter((a) => a.width > 0 && a.height > 0);
  const w = Math.min(input.size.w, vp.w - pad * 2);
  const h = Math.min(input.size.h, vp.h - pad * 2);
  const view = sideDocked(rect(pad, pad, vp.w - pad * 2, vp.h - pad * 2), avoid, vp, pad, input.size.w);
  const target = input.target ? toRect(input.target) : null;
  const visible = target ? intersection(target, rect(0, 0, vp.w, vp.h)) : null;
  const focus: Point | null = target
    ? {
        x: clamp(input.focus?.x ?? target.left + target.width / 2, (visible ?? target).left, (visible ?? target).right),
        y: clamp(input.focus?.y ?? target.top + target.height / 2, (visible ?? target).top, (visible ?? target).bottom),
      }
    : null;

  // 1. sheet
  if (input.sheetBelow !== undefined && vp.w < input.sheetBelow) {
    const sw = view.width;
    const bottom = dockBottom(view.left, view.left + sw, vp, pad, gap, avoid);
    const box = rect(view.left, Math.max(pad, bottom - h), sw, Math.min(h, bottom - pad));
    return result(box, 'sheet', 'bottom', focus ? 'top' : null, focus);
  }

  // 4. fallback (no target, or nothing of it on screen)
  if (!target || !visible || !focus) {
    const left = vp.w - pad - w;
    const bottom = dockBottom(left, left + w, vp, pad, gap, avoid);
    return result(rect(left, Math.max(pad, bottom - h), w, h), 'fallback', null, null, null);
  }

  const fits = (box: Rect) =>
    insideViewport(box, vp, pad) && !intersects(box, target) && !avoid.some((a) => intersects(box, a));

  // 2. anchored
  const covers = visible.width * visible.height > 0.5 * vp.w * vp.h;
  if (stage === 'beside') {
    if (covers) return null;
    const order: Side[] = [];
    if (input.previousSide && (input.previousMode ?? 'anchored') === 'anchored') order.push(input.previousSide);
    for (const s of [input.preferred, OPPOSITE[input.preferred], ...CROSS[input.preferred]]) {
      if (!order.includes(s)) order.push(s);
    }
    for (const side of order) {
      const box = anchoredBox(side, target, focus, w, h, gap, view, avoid);
      if (box) {
        const to = edgePointToward(target, side, box);
        return result(box, 'anchored', side, OPPOSITE[side], to);
      }
    }
    return null;
  }

  // 3. inset, only for a target too large to sit beside
  if (input.large || covers || tooLargeToSitBeside(target, visible, w, h, gap, view)) {
    const p = inset(input, target, visible, focus, w, h, gap, pad, view, avoid);
    p.largeTarget = true;
    return p;
  }
  return nearestFreeSpot(target, focus, w, h, gap, pad, vp, view, avoid, fits);

  function anchoredBox(side: Side, t: Rect, f: Point, bw: number, bh: number, g: number, area: Rect, av: Rect[]): Rect | null {
    if (vertical(side)) {
      const top = side === 'top' ? t.top - g - bh : t.bottom + g;
      for (const left of crossCandidates(f.x - bw / 2, bw, area.left, area.right, av, g, 'x')) {
        const box = rect(left, top, bw, bh);
        if (fits(box)) return box;
      }
      return null;
    }
    const left = side === 'left' ? t.left - g - bw : t.right + g;
    for (const top of crossCandidates(f.y - bh / 2, bh, area.top, area.bottom, av, g, 'y')) {
      const box = rect(left, top, bw, bh);
      if (fits(box)) return box;
    }
    return null;
  }
}

/** No side of the target has room for the popup, and the target is at least popup-sized one way. */
function tooLargeToSitBeside(t: Rect, visible: Rect, w: number, h: number, gap: number, view: Rect): boolean {
  const room =
    t.top - gap - view.top >= h ||
    view.bottom - t.bottom - gap >= h ||
    t.left - gap - view.left >= w ||
    view.right - t.right - gap >= w;
  return !room && (visible.width >= w || visible.height >= h);
}

/** Gap between two rects (0 when they touch or overlap). */
function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.left - a.right, a.left - b.right);
  const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom);
  return Math.hypot(dx, dy);
}

/**
 * A small target with no side free: the closest spot in the viewport that
 * covers neither the target nor an avoid rect, reported as anchored on the
 * side it ended up on. None at all: clamped next to focus (inset, arrowExempt),
 * which the popup audit fails.
 */
function nearestFreeSpot(
  target: Rect,
  focus: Point,
  w: number,
  h: number,
  gap: number,
  pad: number,
  vp: { w: number; h: number },
  view: Rect,
  avoid: Rect[],
  fits: (box: Rect) => boolean,
): Placement {
  const xs = [target.left - gap - w, target.right + gap, focus.x - w / 2, target.left, target.right - w, view.left, view.right - w];
  const ys = [target.top - gap - h, target.bottom + gap, focus.y - h / 2, target.top, target.bottom - h, view.top, view.bottom - h];
  for (const a of avoid) {
    xs.push(a.left - gap - w, a.right + gap);
    ys.push(a.top - gap - h, a.bottom + gap);
  }
  let best: Rect | null = null;
  let bestScore = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const box = rect(clamp(x, view.left, view.right - w), clamp(y, view.top, view.bottom - h), w, h);
      if (!fits(box)) continue;
      const score = rectDistance(box, target) * 1000 + Math.hypot(box.left + w / 2 - focus.x, box.top + h / 2 - focus.y);
      if (score < bestScore) {
        bestScore = score;
        best = box;
      }
    }
  }
  if (best) {
    const side: Side =
      best.bottom <= target.top ? 'top' : best.top >= target.bottom ? 'bottom' : best.right <= target.left ? 'left' : 'right';
    return result(best, 'anchored', side, OPPOSITE[side], edgePointToward(target, side, best));
  }
  const off = gap + FOCUS_RING_R;
  const left = clamp(focus.x + off, pad, vp.w - pad - w);
  const top = clamp(focus.y - h / 2, pad, vp.h - pad - h);
  return result(rect(left, top, w, h), 'inset', null, null, null, true);
}

/** Where an anchored arrow lands: on the ring around the target, on the side facing the popup. */
function edgePointToward(t: Rect, side: Side, box: Rect): Point {
  if (vertical(side)) {
    const lo = Math.max(t.left, box.left + CARET_INSET);
    const hi = Math.min(t.right, box.right - CARET_INSET);
    const x = lo <= hi ? (lo + hi) / 2 : clamp(box.left + box.width / 2, t.left, t.right);
    return { x, y: side === 'top' ? t.top - RING_PAD : t.bottom + RING_PAD };
  }
  const lo = Math.max(t.top, box.top + CARET_INSET);
  const hi = Math.min(t.bottom, box.bottom - CARET_INSET);
  const y = lo <= hi ? (lo + hi) / 2 : clamp(box.top + box.height / 2, t.top, t.bottom);
  return { x: side === 'left' ? t.left - RING_PAD : t.right + RING_PAD, y };
}

function inset(
  input: PlaceInput,
  target: Rect,
  visible: Rect,
  focus: Point,
  w: number,
  h: number,
  gap: number,
  pad: number,
  view: Rect,
  avoid: Rect[],
): Placement {
  const vp = input.viewport;
  const off = gap + FOCUS_RING_R;
  const ok = (box: Rect, area: Rect) =>
    box.left >= area.left - 0.5 &&
    box.top >= area.top - 0.5 &&
    box.right <= area.right + 0.5 &&
    box.bottom <= area.bottom + 0.5 &&
    insideViewport(box, vp, pad) &&
    !coversPoint(box, focus, FOCUS_RING_R) &&
    !avoid.some((a) => intersects(box, a));

  /** Popup next to focus on `side`, inside `area`, or null. */
  const beside = (side: Side, area: Rect): Rect | null => {
    if (vertical(side)) {
      const top = side === 'top' ? focus.y - off - h : focus.y + off;
      for (const left of crossCandidates(focus.x - w / 2, w, area.left, area.right, avoid, gap, 'x')) {
        const box = rect(left, top, w, h);
        if (ok(box, area)) return box;
      }
      return null;
    }
    const left = side === 'left' ? focus.x - off - w : focus.x + off;
    for (const top of crossCandidates(focus.y - h / 2, h, area.top, area.bottom, avoid, gap, 'y')) {
      const box = rect(left, top, w, h);
      if (ok(box, area)) return box;
    }
    return null;
  };

  const room = (side: Side, area: Rect): number => {
    switch (side) {
      case 'top': return focus.y - area.top - off - h;
      case 'bottom': return area.bottom - focus.y - off - h;
      case 'left': return focus.x - area.left - off - w;
      case 'right': return area.right - focus.x - off - w;
    }
  };

  const area = intersection(target, view) ?? visible;
  const sides: Side[] = (['right', 'left', 'bottom', 'top'] as Side[]).sort((a, b) => room(b, area) - room(a, area));
  if (input.previousMode === 'inset' && input.previousSide) {
    const keep = beside(input.previousSide, area);
    if (keep) return result(keep, 'inset', input.previousSide, OPPOSITE[input.previousSide], focus);
  }
  for (const side of sides) {
    const box = beside(side, area);
    if (box) return result(box, 'inset', side, OPPOSITE[side], focus);
  }

  // Far-corner fallback inside the target: ring only, no arrow.
  const corners: Point[] = [
    { x: area.left, y: area.top },
    { x: area.right - w, y: area.top },
    { x: area.left, y: area.bottom - h },
    { x: area.right - w, y: area.bottom - h },
  ];
  corners.sort((a, b) => Math.hypot(b.x + w / 2 - focus.x, b.y + h / 2 - focus.y) - Math.hypot(a.x + w / 2 - focus.x, a.y + h / 2 - focus.y));
  for (const c of corners) {
    const box = rect(c.x, c.y, w, h);
    if (ok(box, area)) return result(box, 'inset', null, null, null, true);
  }

  // Target ∩ viewport too small for any of that: next to focus anywhere on screen.
  const viewSides: Side[] = (['right', 'left', 'bottom', 'top'] as Side[]).sort((a, b) => room(b, view) - room(a, view));
  for (const side of viewSides) {
    const box = beside(side, view);
    if (box) return result(box, 'inset', side, OPPOSITE[side], focus);
  }

  // Nothing avoids everything: clamp into the viewport (the audit flags this).
  const left = clamp(focus.x + off, pad, vp.w - pad - w);
  const top = clamp(focus.y - h / 2, pad, vp.h - pad - h);
  return result(rect(left, top, w, h), 'inset', null, null, null, true);
}

// ---------------------------------------------------------------------------
// Jump detector (arch:R2-5)
// ---------------------------------------------------------------------------

export interface PlacedSnapshot {
  box: RectLike;
  side: Side | null;
  mode: PlaceMode;
  target: RectLike | null;
}

/** Largest edge movement between two rects (Infinity when one is missing). */
export function rectDelta(a: RectLike | null, b: RectLike | null): number {
  if (!a && !b) return 0;
  if (!a || !b) return Infinity;
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.left + a.width - (b.left + b.width)),
    Math.abs(a.top + a.height - (b.top + b.height)),
  );
}

/**
 * A popup jumped if, while its target held still (moved < 4px), its side or
 * mode changed or it moved more than 24px. Changes that follow the target
 * (results arriving and a panel growing from small to large, say) don't count.
 */
export function jumped(before: PlacedSnapshot, after: PlacedSnapshot): boolean {
  if (rectDelta(before.target, after.target) >= 4) return false;
  if (before.side !== after.side || before.mode !== after.mode) return true;
  const moved = Math.hypot(after.box.left - before.box.left, after.box.top - before.box.top);
  return moved > 24;
}

// ---------------------------------------------------------------------------
// Audit flags (shared by place.test.ts and the dev popup audit)
// ---------------------------------------------------------------------------

export interface PlacementFlags {
  inViewport: boolean;
  overlapsTarget: boolean;
  coversFocus: boolean;
  overlapsAvoid: boolean;
}

export function placementFlags(
  box: RectLike,
  vp: { w: number; h: number },
  target: RectLike | null,
  focus: Point | null,
  avoid: RectLike[],
): PlacementFlags {
  return {
    inViewport: insideViewport(box, vp, 0),
    overlapsTarget: target ? intersects(box, target) : false,
    coversFocus: focus ? coversPoint(box, focus, FOCUS_RING_R) : false,
    overlapsAvoid: avoid.some((a) => a.width > 0 && a.height > 0 && intersects(box, a)),
  };
}
