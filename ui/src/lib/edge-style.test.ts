import { describe, expect, it } from 'vitest';
import {
  EDGE_MAX_WIDTH,
  EDGE_MIN_WIDTH,
  EDGE_NEGATIVE_COLOR,
  EDGE_POSITIVE_COLOR,
  edgeColor,
  edgeGlyph,
  edgeWidth,
} from './edge-style';
import { NEGATIVE_HEX, POSITIVE_HEX } from './signed-color';

describe('edge-style', () => {
  it('maps sign to the app-wide colourblind-safe pair', () => {
    expect(EDGE_POSITIVE_COLOR).toBe(POSITIVE_HEX);
    expect(EDGE_NEGATIVE_COLOR).toBe(NEGATIVE_HEX);
    expect(edgeColor(0.3)).toBe(POSITIVE_HEX);
    expect(edgeColor(-0.3)).toBe(NEGATIVE_HEX);
  });

  it('maps sign to a +/− glyph', () => {
    expect(edgeGlyph(0.2)).toBe('+');
    expect(edgeGlyph(-0.2)).toBe('−');
  });

  it('width depends on |weight|, not sign', () => {
    expect(edgeWidth(0.5, 1)).toBe(edgeWidth(-0.5, 1));
    expect(edgeWidth(1, 1)).toBe(EDGE_MAX_WIDTH);
    expect(edgeWidth(0, 1)).toBe(EDGE_MIN_WIDTH);
    expect(edgeWidth(0.2, 1)).toBeLessThan(edgeWidth(0.8, 1));
  });

  it('clamps and handles degenerate input', () => {
    expect(edgeWidth(5, 1)).toBe(EDGE_MAX_WIDTH);
    expect(edgeWidth(0.5, 0)).toBe(EDGE_MIN_WIDTH);
    expect(edgeWidth(Number.NaN, 1)).toBe(EDGE_MIN_WIDTH);
  });
});
