import { describe, it, expect } from 'vitest';
import {
  LINE_THRESHOLD,
  MAX_OPACITY,
  DEFAULT_GEOMETRY,
  buildArcs,
  hiddenCount,
  isFocusArc,
  linesHeight,
  opacityFor,
  rowY,
} from './attention-lines';

// 4-word causal matrix; rows sum to 1. The upper triangle holds junk that must be ignored.
const M = [
  [1.0, 0.7, 0.7, 0.7],
  [0.6, 0.4, 0.9, 0.9],
  [0.01, 0.29, 0.7, 0.9],
  [0.1, 0.2, 0.3, 0.4],
];

describe('buildArcs', () => {
  it('only draws causal arcs (no arc from i to j > i)', () => {
    const arcs = buildArcs(M, 4);
    expect(arcs.length).toBeGreaterThan(0);
    for (const a of arcs) expect(a.to).toBeLessThanOrEqual(a.from);
  });

  it('ignores non-zero values above the diagonal', () => {
    const arcs = buildArcs(M, 4);
    expect(arcs.some((a) => a.from === 0 && a.to > 0)).toBe(false);
    expect(arcs.some((a) => a.from === 1 && a.to === 2)).toBe(false);
  });

  it('gives the max causal weight the max opacity', () => {
    const arcs = buildArcs(M, 4);
    const top = arcs.find((a) => a.from === 0 && a.to === 0)!;
    expect(top.weight).toBe(1);
    expect(top.opacity).toBeCloseTo(MAX_OPACITY);
    for (const a of arcs) expect(a.opacity).toBeLessThanOrEqual(MAX_OPACITY + 1e-12);
  });

  it('makes opacity proportional (and monotone) in weight', () => {
    const arcs = buildArcs(M, 4);
    const sorted = [...arcs].sort((a, b) => a.weight - b.weight);
    for (let k = 1; k < sorted.length; k++) {
      expect(sorted[k].opacity).toBeGreaterThanOrEqual(sorted[k - 1].opacity);
    }
    for (const a of arcs) expect(a.opacity / a.weight).toBeCloseTo(MAX_OPACITY / 1.0);
  });

  it('respects the threshold', () => {
    const arcs = buildArcs(M, 4);
    for (const a of arcs) expect(a.weight).toBeGreaterThanOrEqual(LINE_THRESHOLD);
    expect(arcs.some((a) => a.from === 2 && a.to === 0)).toBe(false); // 0.01 < 0.02
    expect(hiddenCount(M, 4)).toBe(1);
    // 10 causal pairs total = drawn + hidden
    expect(arcs.length + hiddenCount(M, 4)).toBe(10);
    // A custom threshold drops more.
    expect(buildArcs(M, 4, DEFAULT_GEOMETRY, 0.5).every((a) => a.weight >= 0.5)).toBe(true);
  });

  it('places arcs at stable coordinates that depend only on index', () => {
    const a1 = buildArcs(M, 4);
    const a2 = buildArcs(M, 4);
    expect(a1).toEqual(a2);
    const scaled = M.map((r) => r.map((v) => v * 0.5));
    const b = buildArcs(scaled, 4);
    const coords = (arcs: typeof a1) => arcs.map((a) => [a.from, a.to, a.x1, a.y1, a.x2, a.y2]);
    expect(coords(b)).toEqual(coords(a1));
    for (const a of a1) {
      expect(a.x1).toBe(DEFAULT_GEOMETRY.leftX);
      expect(a.x2).toBe(DEFAULT_GEOMETRY.rightX);
      expect(a.y1).toBe(rowY(a.from));
      expect(a.y2).toBe(rowY(a.to));
    }
  });

  it('only uses the first n words and tolerates short or ragged rows', () => {
    const arcs = buildArcs(M, 2);
    expect(arcs.every((a) => a.from < 2)).toBe(true);
    expect(buildArcs([[1], [0.5]], 5).map((a) => [a.from, a.to])).toEqual([[0, 0], [1, 0]]);
    expect(buildArcs([], 3)).toEqual([]);
  });

  it('handles 64 words (the attention cap)', () => {
    const n = 64;
    const uniform = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (j <= i ? 1 / (i + 1) : 0)),
    );
    const arcs = buildArcs(uniform, n);
    for (const a of arcs) expect(a.to).toBeLessThanOrEqual(a.from);
    // 1/(i+1) >= 0.02 iff i <= 49: rows 0..49 fully drawn.
    expect(arcs.length).toBe((50 * 51) / 2);
    expect(arcs.length + hiddenCount(uniform, n)).toBe((n * (n + 1)) / 2);
  });
});

describe('helpers', () => {
  it('opacityFor is 0 for non-positive input and capped at max', () => {
    expect(opacityFor(0, 1)).toBe(0);
    expect(opacityFor(0.5, 0)).toBe(0);
    expect(opacityFor(2, 1)).toBe(MAX_OPACITY);
    expect(opacityFor(0.25, 0.5, 1)).toBeCloseTo(0.5);
  });

  it('rowY and linesHeight follow the geometry', () => {
    const g = { rowHeight: 10, top: 4, leftX: 0, rightX: 100 };
    expect(rowY(0, g)).toBe(9);
    expect(rowY(3, g)).toBe(39);
    expect(linesHeight(5, g)).toBe(58);
  });

  it('isFocusArc picks outgoing lines in FROM mode and incoming in TO mode', () => {
    const arcs = buildArcs(M, 4);
    const from3 = arcs.filter((a) => isFocusArc(a, 3, 'from'));
    expect(from3.every((a) => a.from === 3)).toBe(true);
    expect(from3.length).toBe(4);
    const to1 = arcs.filter((a) => isFocusArc(a, 1, 'to'));
    expect(to1.map((a) => a.from)).toEqual([1, 2, 3]);
  });
});
