import { describe, expect, it } from 'vitest';
import { placePopup } from './place';

describe('placePopup beside a side-docked surface (Lessons sidebar)', () => {
  it('› a target that fills the app beside a docked sidebar takes the inset, never the sidebar', () => {
    // 1024x700, the sidebar docked right (x 646..1024), a grid filling the app's side.
    const sidebar = { left: 646, top: 44, width: 378, height: 656 };
    const p = placePopup({
      target: { left: 10, top: 120, width: 620, height: 560 },
      size: { w: 320, h: 120 },
      viewport: { w: 1024, h: 700 },
      preferred: 'bottom',
      avoid: [sidebar],
    });
    expect(p.mode).toBe('inset');
    expect(p.largeTarget).toBe(true);
    expect(p.left + p.width).toBeLessThanOrEqual(646);
  });

  it('› a sheet below 760 leaves a docked rail uncovered', () => {
    const rail = { left: 696, top: 44, width: 44, height: 656 };
    const p = placePopup({
      target: { left: 20, top: 120, width: 200, height: 40 },
      size: { w: 320, h: 120 },
      viewport: { w: 740, h: 700 },
      preferred: 'bottom',
      avoid: [rail],
      sheetBelow: 760,
    });
    expect(p.mode).toBe('sheet');
    expect(p.left + p.width).toBeLessThanOrEqual(696);
  });
});
