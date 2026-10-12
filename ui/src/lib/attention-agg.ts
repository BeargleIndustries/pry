// Per-head aggregation of a causal attention matrix ([query][key], lower-triangular,
// rows sum to 1) into one number for the Panel A grid. All functions return null
// when the quantity is undefined (e.g. first word) so callers can grey the cell.

export type FromAgg = 'max' | 'spread' | 'looks-back' | 'previous';
export type ToAgg = 'max' | 'mean' | 'spread';
export type Aggregation = FromAgg | ToAgg;

export type AggOption<T extends string> = { id: T; label: string };

export const FROM_OPTIONS: AggOption<FromAgg>[] = [
  { id: 'max', label: 'Strongest look' },
  { id: 'spread', label: 'Spread (focused vs. scattered)' },
  { id: 'looks-back', label: 'Looks back (how far)' },
  { id: 'previous', label: 'Previous word' },
];

export const TO_OPTIONS: AggOption<ToAgg>[] = [
  { id: 'max', label: 'Strongest look' },
  { id: 'mean', label: 'Average received' },
  { id: 'spread', label: 'Spread (one word vs. many)' },
];

export const DEFAULT_AGG: Aggregation = 'max';

export function isValidAgg(mode: 'from' | 'to', agg: string): agg is Aggregation {
  return (mode === 'from' ? FROM_OPTIONS : TO_OPTIONS).some((o) => o.id === agg);
}

/** Entropy of values (renormalized to sum 1) divided by log(n); null if undefined. */
function normalizedEntropy(vals: number[]): number | null {
  const n = vals.length;
  if (n < 2) return null;
  let sum = 0;
  for (const v of vals) sum += v;
  if (!(sum > 0)) return null;
  let ent = 0;
  for (const v of vals) {
    const p = v / sum;
    if (p > 1e-12) ent -= p * Math.log(p);
  }
  return Math.min(1, Math.max(0, ent / Math.log(n)));
}

/** FROM mode: row `fi` of the head matrix, causal keys 0..fi only. */
export function aggregateFrom(matrix: number[][], fi: number, agg: FromAgg): number | null {
  const row = matrix[fi];
  if (!row || fi < 0) return null;
  const p = row.slice(0, fi + 1);
  if (p.length === 0) return null;
  switch (agg) {
    case 'max': {
      let m = -Infinity;
      for (const v of p) if (v > m) m = v;
      return m;
    }
    case 'spread':
      return normalizedEntropy(p);
    case 'looks-back': {
      if (fi === 0) return null;
      let s = 0;
      for (let k = 0; k <= fi; k++) s += p[k] * ((fi - k) / fi);
      return s;
    }
    case 'previous':
      return fi === 0 ? null : (p[fi - 1] ?? null);
  }
}

/**
 * TO mode: column `fi`, later queries q > fi only. The word's attention to
 * itself is left out, so the last word (no later words) gives null.
 */
export function aggregateTo(matrix: number[][], fi: number, agg: ToAgg): number | null {
  if (fi < 0 || fi >= matrix.length) return null;
  const col: number[] = [];
  for (let q = fi + 1; q < matrix.length; q++) col.push(matrix[q]?.[fi] ?? 0);
  if (col.length === 0) return null;
  switch (agg) {
    case 'max': {
      let m = -Infinity;
      for (const v of col) if (v > m) m = v;
      return m;
    }
    case 'mean': {
      let s = 0;
      for (const v of col) s += v;
      return s / col.length;
    }
    case 'spread':
      return normalizedEntropy(col);
  }
}

export function aggregateHead(
  matrix: number[][],
  fi: number,
  mode: 'from' | 'to',
  agg: Aggregation,
): number | null {
  if (!isValidAgg(mode, agg)) return null;
  return mode === 'from'
    ? aggregateFrom(matrix, fi, agg as FromAgg)
    : aggregateTo(matrix, fi, agg as ToAgg);
}
