// Styling for signed circuit edges (T23): the app-wide colourblind-safe pair
// from signed-color.ts. Blue = pushes toward the predicted word, orange = away.
import { NEGATIVE_HEX, POSITIVE_HEX } from './signed-color';

export const EDGE_POSITIVE_COLOR = POSITIVE_HEX;
export const EDGE_NEGATIVE_COLOR = NEGATIVE_HEX;

export const EDGE_MIN_WIDTH = 0.75;
export const EDGE_MAX_WIDTH = 6;

export function edgeColor(weight: number): string {
  return weight >= 0 ? EDGE_POSITIVE_COLOR : EDGE_NEGATIVE_COLOR;
}

/** "+" for positive (toward the predicted word), "−" (U+2212) for negative. */
export function edgeGlyph(weight: number): string {
  return weight >= 0 ? '+' : '−';
}

/** Stroke width proportional to |weight| / maxAbs, clamped to [min, max]. */
export function edgeWidth(weight: number, maxAbs: number): number {
  if (!Number.isFinite(weight) || !(maxAbs > 0)) return EDGE_MIN_WIDTH;
  const norm = Math.min(Math.abs(weight) / maxAbs, 1);
  return EDGE_MIN_WIDTH + (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH) * norm;
}
