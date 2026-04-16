// viridis colormap helper
// Polynomial approximation of the viridis perceptual colormap.
// t ∈ [0, 1] → rgb string / hex string

export function viridis(t: number): string {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  // 9-stop lookup table (more accurate than polynomial for edge cases)
  // Reference stops: [68,1,84] at 0 → [253,231,37] at 1
  const stops: [number, number, number][] = [
    [68, 1, 84],
    [72, 40, 120],
    [62, 74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [110, 206, 88],
    [181, 222, 43],
    [253, 231, 37],
  ];
  const n = stops.length - 1;
  const pos = c * n;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n);
  const frac = pos - lo;
  const [r0, g0, b0] = stops[lo];
  const [r1, g1, b1] = stops[hi];
  const r = Math.round(r0 + (r1 - r0) * frac);
  const g = Math.round(g0 + (g1 - g0) * frac);
  const b = Math.round(b0 + (b1 - b0) * frac);
  return `rgb(${r},${g},${b})`;
}

export function viridisHex(t: number): string {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  const stops: [number, number, number][] = [
    [68, 1, 84],
    [72, 40, 120],
    [62, 74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [110, 206, 88],
    [181, 222, 43],
    [253, 231, 37],
  ];
  const n = stops.length - 1;
  const pos = c * n;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n);
  const frac = pos - lo;
  const [r0, g0, b0] = stops[lo];
  const [r1, g1, b1] = stops[hi];
  const r = Math.round(r0 + (r1 - r0) * frac);
  const g = Math.round(g0 + (g1 - g0) * frac);
  const b = Math.round(b0 + (b1 - b0) * frac);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
