import { describe, expect, it } from 'vitest';
import { viridis, viridisHex } from './viridis';

describe('viridis', () => {
  it('returns rgb() string at the endpoints', () => {
    expect(viridis(0)).toBe('rgb(68,1,84)');
    expect(viridis(1)).toBe('rgb(253,231,37)');
  });

  it('clamps out-of-range input', () => {
    expect(viridis(-5)).toBe(viridis(0));
    expect(viridis(5)).toBe(viridis(1));
  });
});

describe('viridisHex', () => {
  it('returns #rrggbb at the endpoints', () => {
    expect(viridisHex(0)).toBe('#440154');
    expect(viridisHex(1)).toBe('#fde725');
  });

  it('always yields a 7-char hex string', () => {
    for (let t = 0; t <= 1; t += 0.07) {
      expect(viridisHex(t)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
