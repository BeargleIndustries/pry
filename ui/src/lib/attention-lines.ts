// Geometry for the Attention "lines" view (T28): words in a column on the left
// (the word doing the looking) and again on the right (the word being looked at),
// with one straight line per (from, to) pair. Pure functions, no DOM.
//
// The input is one head's causal attention matrix ([query][key], rows sum to 1).
// Only causal pairs are drawn: a word can look at itself and earlier words, never
// later ones, so there is never an arc from i to j > i.

/** Lines below this attention weight are not drawn (the legend says so). */
export const LINE_THRESHOLD = 0.02;

/** Opacity given to the strongest line in the matrix. */
export const MAX_OPACITY = 0.9;

export interface LinesGeometry {
  /** Vertical space per word, in px. */
  rowHeight: number;
  /** Padding above the first row, in px. */
  top: number;
  /** x of the left end of every line. */
  leftX: number;
  /** x of the right end of every line. */
  rightX: number;
}

export const DEFAULT_GEOMETRY: LinesGeometry = { rowHeight: 22, top: 0, leftX: 0, rightX: 180 };

export interface Arc {
  /** Array position of the word doing the looking (left column). */
  from: number;
  /** Array position of the word being looked at (right column); always <= from. */
  to: number;
  weight: number;
  opacity: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Centre y of row `i`. Depends only on the index and geometry, never on weights. */
export function rowY(i: number, g: LinesGeometry = DEFAULT_GEOMETRY): number {
  return g.top + i * g.rowHeight + g.rowHeight / 2;
}

/** Total height needed for `n` rows (same padding top and bottom). */
export function linesHeight(n: number, g: LinesGeometry = DEFAULT_GEOMETRY): number {
  return 2 * g.top + Math.max(0, n) * g.rowHeight;
}

/** Opacity proportional to weight: 0 -> 0, maxWeight -> maxOpacity, linear between. */
export function opacityFor(weight: number, maxWeight: number, maxOpacity = MAX_OPACITY): number {
  if (!(maxWeight > 0) || !(weight > 0)) return 0;
  return maxOpacity * Math.min(1, weight / maxWeight);
}

function causalWeight(matrix: number[][], i: number, j: number): number {
  const w = matrix[i]?.[j];
  return typeof w === 'number' && Number.isFinite(w) ? w : 0;
}

/**
 * Arcs for the first `n` words of `matrix`, in a fixed order (by `from`, then `to`).
 * Weights below `threshold` are dropped. Opacity is scaled so the strongest causal
 * weight in the matrix gets `maxOpacity`.
 */
export function buildArcs(
  matrix: number[][],
  n: number,
  g: LinesGeometry = DEFAULT_GEOMETRY,
  threshold = LINE_THRESHOLD,
  maxOpacity = MAX_OPACITY,
): Arc[] {
  const size = Math.max(0, Math.min(n, matrix.length));
  let maxW = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      const w = causalWeight(matrix, i, j);
      if (w > maxW) maxW = w;
    }
  }
  const arcs: Arc[] = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      const w = causalWeight(matrix, i, j);
      if (w <= 0 || w < threshold) continue;
      arcs.push({
        from: i,
        to: j,
        weight: w,
        opacity: opacityFor(w, maxW, maxOpacity),
        x1: g.leftX,
        y1: rowY(i, g),
        x2: g.rightX,
        y2: rowY(j, g),
      });
    }
  }
  return arcs;
}

/** Number of causal pairs among the first `n` words that fall below the threshold. */
export function hiddenCount(matrix: number[][], n: number, threshold = LINE_THRESHOLD): number {
  const size = Math.max(0, Math.min(n, matrix.length));
  let hidden = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      const w = causalWeight(matrix, i, j);
      if (w <= 0 || w < threshold) hidden++;
    }
  }
  return hidden;
}

/**
 * Is this arc one of the focused word's lines? FROM: lines the word sends out
 * (left column). TO: lines arriving at the word (right column).
 */
export function isFocusArc(arc: Arc, focus: number, mode: 'from' | 'to'): boolean {
  return mode === 'from' ? arc.from === focus : arc.to === focus;
}
