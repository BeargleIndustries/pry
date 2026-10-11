import { describe, expect, it } from 'vitest';
import {
  MINUS,
  NEGATIVE_HEX,
  NEGATIVE_RGB,
  POSITIVE_HEX,
  POSITIVE_RGB,
  signGlyph,
  signOf,
  signedColor,
  signedHex,
  signedIntensity,
  signedNumber,
  signedRgb,
} from './signed-color';

function parse(rgba: string): number[] {
  const m = rgba.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (!m) throw new Error(`not rgba: ${rgba}`);
  return m.slice(1).map(Number);
}

describe('palette', () => {
  it('is the Okabe-Ito sky blue / orange pair, never red or green', () => {
    expect(POSITIVE_HEX).toBe('#56b4e9');
    expect(NEGATIVE_HEX).toBe('#e69f00');
    // Blue-dominant vs red/orange-dominant: the families differ in hue, not just lightness.
    expect(POSITIVE_RGB[2]).toBeGreaterThan(POSITIVE_RGB[0]);
    expect(NEGATIVE_RGB[0]).toBeGreaterThan(NEGATIVE_RGB[2]);
  });
});

describe('sign -> hue family', () => {
  it('positive values use blue, negative values use orange', () => {
    expect(signedRgb(0.5)).toEqual(POSITIVE_RGB);
    expect(signedRgb(-0.5)).toEqual(NEGATIVE_RGB);
    expect(parse(signedColor(2, 4)).slice(0, 3)).toEqual([...POSITIVE_RGB]);
    expect(parse(signedColor(-2, 4)).slice(0, 3)).toEqual([...NEGATIVE_RGB]);
    expect(signedHex(1)).toBe(POSITIVE_HEX);
    expect(signedHex(-1)).toBe(NEGATIVE_HEX);
  });

  it('signOf handles zero and non-finite values', () => {
    expect(signOf(3)).toBe('positive');
    expect(signOf(-3)).toBe('negative');
    expect(signOf(0)).toBe('zero');
    expect(signOf(-0)).toBe('zero');
    expect(signOf(NaN)).toBe('zero');
  });
});

describe('|value| -> intensity', () => {
  it('scales alpha with magnitude, the same for both signs', () => {
    expect(parse(signedColor(1, 4))[3]).toBe(0.25);
    expect(parse(signedColor(-1, 4))[3]).toBe(0.25);
    expect(parse(signedColor(4, 4))[3]).toBe(1);
    expect(parse(signedColor(-3, 4))[3]).toBe(0.75);
  });

  it('is monotonic in |value|', () => {
    let prev = -1;
    for (let v = 0.1; v <= 1; v += 0.1) {
      const a = parse(signedColor(-v, 1))[3];
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it('clamps above maxAbs and handles a zero max', () => {
    expect(signedIntensity(10, 2)).toBe(1);
    expect(signedIntensity(1, 0)).toBe(0);
    expect(signedIntensity(NaN, 1)).toBe(0);
  });

  it('applies a floor with minAlpha; zero gets exactly the floor', () => {
    expect(parse(signedColor(0, 1, 0.2))[3]).toBe(0.2);
    expect(parse(signedColor(0.5, 1, 0.2))[3]).toBe(0.6);
    expect(parse(signedColor(0, 1))[3]).toBe(0);
  });

  it('is deterministic', () => {
    expect(signedColor(-0.123456, 0.7)).toBe(signedColor(-0.123456, 0.7));
    expect(signedColor(1 / 3, 1)).toBe('rgba(86, 180, 233, 0.333)');
  });
});

describe('non-colour sign cue', () => {
  it('signGlyph uses + and a real minus sign', () => {
    expect(signGlyph(2)).toBe('+');
    expect(signGlyph(-2)).toBe(MINUS);
    expect(MINUS).toBe('−');
    expect(signGlyph(0)).toBe('');
  });

  it('signedNumber always shows the sign, except for values that round to zero', () => {
    expect(signedNumber(0.1234, 3)).toBe('+0.123');
    expect(signedNumber(-0.1234, 3)).toBe('−0.123');
    expect(signedNumber(-0.00001, 3)).toBe('0.000');
    expect(signedNumber(0, 2)).toBe('0.00');
  });
});
