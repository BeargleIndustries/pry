// Colorblind-safe signed colour scale (T29), shared by Patching, DLA, Key parts
// and Compare. Sign picks the hue family, |value| picks the intensity.
//
// The pair is Okabe-Ito sky blue (#56B4E9) for positive and orange (#E69F00)
// for negative. Blue vs orange stays distinct for protan, deutan and tritan
// colour vision, unlike red vs green or red vs indigo. Sky blue is used rather
// than Okabe-Ito blue (#0072B2) because Pry's panels are dark and the darker
// blue all but disappears at low intensity.
//
// Colour is never the only cue: pair every coloured value with signGlyph() or
// signedNumber() in its text, label or tooltip.

export const POSITIVE_RGB = [86, 180, 233] as const; // #56B4E9
export const NEGATIVE_RGB = [230, 159, 0] as const; // #E69F00
export const POSITIVE_HEX = '#56b4e9';
export const NEGATIVE_HEX = '#e69f00';

/** U+2212 MINUS SIGN: reads as "minus" in screen readers, unlike a hyphen. */
export const MINUS = '−';

export type Sign = 'positive' | 'negative' | 'zero';

export function signOf(value: number): Sign {
  if (!Number.isFinite(value) || value === 0) return 'zero';
  return value > 0 ? 'positive' : 'negative';
}

/** "+" for positive, "−" for negative, "" for zero. */
export function signGlyph(value: number): string {
  const s = signOf(value);
  return s === 'positive' ? '+' : s === 'negative' ? MINUS : '';
}

/** Value with an explicit sign, e.g. "+0.123" or "−0.123". */
export function signedNumber(value: number, digits: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const body = Math.abs(v).toFixed(digits);
  // A value that rounds to zero shows no sign, so "−0.000" never appears.
  if (Number(body) === 0) return body;
  return `${signGlyph(v)}${body}`;
}

/** |value| / maxAbs, clamped to [0, 1]. A non-positive maxAbs gives 0. */
export function signedIntensity(value: number, maxAbs: number): number {
  if (!Number.isFinite(value) || !(maxAbs > 0)) return 0;
  return Math.min(Math.abs(value) / maxAbs, 1);
}

/** Base rgb for a value's sign (zero uses the positive hue at intensity 0). */
export function signedRgb(value: number): readonly [number, number, number] {
  return signOf(value) === 'negative' ? NEGATIVE_RGB : POSITIVE_RGB;
}

/**
 * rgba() fill for a signed value. Alpha = minAlpha + (1 - minAlpha) * intensity,
 * rounded to 3 decimals so the output is deterministic. Zero is transparent
 * unless minAlpha is set.
 */
export function signedColor(value: number, maxAbs: number, minAlpha = 0): string {
  const t = signedIntensity(value, maxAbs);
  const [r, g, b] = signedRgb(value);
  const a = signOf(value) === 'zero' ? minAlpha : minAlpha + (1 - minAlpha) * t;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

/** Solid hex for text, legends and node strokes. */
export function signedHex(value: number): string {
  return signOf(value) === 'negative' ? NEGATIVE_HEX : POSITIVE_HEX;
}
