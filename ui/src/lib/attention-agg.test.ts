import { describe, expect, it } from 'vitest';
import {
  FROM_OPTIONS,
  TO_OPTIONS,
  aggregateFrom,
  aggregateHead,
  aggregateTo,
  isValidAgg,
} from './attention-agg';

/** Build a lower-triangular row-stochastic matrix from raw positive weights. */
function causal(weights: number[][]): number[][] {
  return weights.map((w, q) => {
    const row = w.map((v, k) => (k <= q ? v : 0));
    const s = row.reduce((a, b) => a + b, 0);
    return row.map((v) => v / s);
  });
}

const N = 6;
const idx = Array.from({ length: N }, (_, i) => i);
const uniform = causal(idx.map(() => idx.map(() => 1)));
const prevHead = causal(idx.map((q) => idx.map((k) => (k === q - 1 ? 20 : 1))));
const firstHead = causal(idx.map(() => idx.map((k) => (k === 0 ? 20 : 1))));
const weakFirst = causal(idx.map(() => idx.map((k) => (k === 0 ? 3 : 1))));
const selfHead = causal(idx.map((q) => idx.map((k) => (k === q ? 20 : 1))));

describe('FROM mode', () => {
  const fi = 4;
  it('every option differs between two different heads', () => {
    for (const o of FROM_OPTIONS) {
      const a = aggregateFrom(prevHead, fi, o.id)!;
      const b = aggregateFrom(weakFirst, fi, o.id)!;
      expect(Math.abs(a - b), o.id).toBeGreaterThan(1e-3);
    }
  });

  it('no option is constant at 1/seq_len across varied heads', () => {
    for (const o of FROM_OPTIONS) {
      const vals = [uniform, prevHead, firstHead, selfHead].map((m) => aggregateFrom(m, fi, o.id)!);
      expect(
        vals.every((v) => Math.abs(v - 1 / N) < 1e-6),
        o.id,
      ).toBe(false);
      expect(new Set(vals.map((v) => v.toFixed(4))).size, o.id).toBeGreaterThan(1);
    }
  });

  it('spread on a uniform causal row is 1.0', () => {
    for (let f = 1; f < N; f++) expect(aggregateFrom(uniform, f, 'spread')).toBeCloseTo(1, 9);
  });

  it('previous word equals row[fi-1]', () => {
    for (let f = 1; f < N; f++) {
      expect(aggregateFrom(prevHead, f, 'previous')).toBe(prevHead[f][f - 1]);
    }
  });

  it('looks back is larger when attending to the first word than to self', () => {
    expect(aggregateFrom(firstHead, 4, 'looks-back')!).toBeGreaterThan(
      aggregateFrom(selfHead, 4, 'looks-back')!,
    );
    expect(
      aggregateFrom(
        [
          [1, 0],
          [1, 0],
        ],
        1,
        'looks-back',
      ),
    ).toBe(1);
  });

  it('fi=0: spread, looks-back, previous are null; max = 1', () => {
    expect(aggregateFrom(uniform, 0, 'spread')).toBeNull();
    expect(aggregateFrom(uniform, 0, 'looks-back')).toBeNull();
    expect(aggregateFrom(uniform, 0, 'previous')).toBeNull();
    expect(aggregateFrom(uniform, 0, 'max')).toBe(1);
  });

  it('fi=1: looks back is in [0,1]', () => {
    for (const m of [uniform, prevHead, firstHead, selfHead]) {
      const v = aggregateFrom(m, 1, 'looks-back')!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('never returns NaN', () => {
    for (let f = 0; f < N; f++) {
      for (const o of FROM_OPTIONS) {
        const v = aggregateFrom(firstHead, f, o.id);
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('TO mode', () => {
  it('average received uses only causal queries q >= fi', () => {
    const expected0 = (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5 + 1 / 6) / 6;
    expect(aggregateTo(uniform, 0, 'mean')).toBeCloseTo(expected0, 9);
    // Column 4: queries 4,5 only, not diluted by queries 0..3 (masked zeros).
    expect(aggregateTo(uniform, 4, 'mean')).toBeCloseTo((1 / 5 + 1 / 6) / 2, 9);
  });

  it('strongest is the max over q >= fi', () => {
    expect(aggregateTo(uniform, 3, 'max')).toBeCloseTo(1 / 4, 9);
    expect(aggregateTo(firstHead, 0, 'max')).toBeCloseTo(1, 9);
  });

  it('options differ between heads', () => {
    for (const o of TO_OPTIONS) {
      const a = aggregateTo(selfHead, 2, o.id)!;
      const b = aggregateTo(firstHead, 2, o.id)!;
      expect(Math.abs(a - b), o.id).toBeGreaterThan(1e-4);
    }
  });

  it('spread of an even column is 1.0, uneven is below 1', () => {
    const flat = [
      [0.5, 0, 0],
      [0.5, 0.5, 0],
      [0.5, 0.25, 0.25],
    ];
    const uneven = [
      [1, 0, 0],
      [0.5, 0.5, 0],
      [0.5, 0.25, 0.25],
    ];
    expect(aggregateTo(flat, 0, 'spread')).toBeCloseTo(1, 9);
    expect(aggregateTo(uneven, 0, 'spread')!).toBeLessThan(1);
  });

  it('single query (last token): spread is null, max/mean defined', () => {
    const last = N - 1;
    expect(aggregateTo(uniform, last, 'spread')).toBeNull();
    expect(aggregateTo(uniform, last, 'max')).toBeCloseTo(1 / N, 9);
    expect(aggregateTo(uniform, last, 'mean')).toBeCloseTo(1 / N, 9);
  });

  it('all-zero column gives null spread, not NaN', () => {
    expect(
      aggregateTo(
        [
          [0, 0],
          [0, 0],
        ],
        0,
        'spread',
      ),
    ).toBeNull();
  });

  it('out-of-range focus returns null', () => {
    expect(aggregateTo(uniform, N, 'max')).toBeNull();
    expect(aggregateTo(uniform, -1, 'max')).toBeNull();
  });
});

describe('dispatch', () => {
  it('validates ids per mode', () => {
    expect(isValidAgg('from', 'previous')).toBe(true);
    expect(isValidAgg('from', 'mean')).toBe(false);
    expect(isValidAgg('to', 'mean')).toBe(true);
    expect(isValidAgg('to', 'previous')).toBe(false);
    expect(aggregateHead(uniform, 2, 'from', 'mean')).toBeNull();
    expect(aggregateHead(uniform, 2, 'to', 'mean')).not.toBeNull();
  });
});
