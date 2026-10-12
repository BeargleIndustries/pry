import { describe, expect, it } from 'vitest';
import {
  FOCUS_RING_R,
  MAX_ARROW,
  coversPoint,
  insideViewport,
  intersects,
  jumped,
  placePopup,
  rect,
  type PlaceInput,
  type Side,
} from './place';

const VP = { w: 1280, h: 800 };
const SIZE = { w: 300, h: 140 };

function base(over: Partial<PlaceInput>): PlaceInput {
  return { target: rect(500, 350, 120, 40), size: SIZE, viewport: VP, preferred: 'bottom', ...over };
}

function boxOf(p: { left: number; top: number; width: number; height: number }) {
  return rect(p.left, p.top, p.width, p.height);
}

/** Small deterministic PRNG so the property test is reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('placePopup', () => {
  it('› uses preferred side when it fits', () => {
    for (const side of ['top', 'bottom', 'left', 'right'] as Side[]) {
      const p = placePopup(base({ preferred: side }));
      expect(p.mode).toBe('anchored');
      expect(p.side).toBe(side);
    }
    const p = placePopup(base({ preferred: 'bottom' }));
    expect(p.top).toBe(350 + 40 + 10);
  });

  it('› keeps previousSide while it fits', () => {
    const p = placePopup(base({ preferred: 'bottom', previousSide: 'right', previousMode: 'anchored' }));
    expect(p.side).toBe('right');
    // ...but drops it once it stops fitting.
    const q = placePopup(base({ target: rect(1000, 350, 120, 40), preferred: 'bottom', previousSide: 'right', previousMode: 'anchored' }));
    expect(q.side).toBe('bottom');
  });

  it('› flips to opposite, then cross sides', () => {
    // Near the bottom edge: bottom doesn't fit, so top.
    const flip = placePopup(base({ target: rect(500, 720, 120, 40), preferred: 'bottom' }));
    expect(flip.side).toBe('top');
    // A tall target leaves no room above or below: cross side (right first).
    const cross = placePopup(base({ target: rect(400, 100, 120, 600), preferred: 'bottom' }));
    expect(cross.side).toBe('right');
    // Right edge too: left.
    const cross2 = placePopup(base({ target: rect(1100, 100, 120, 600), preferred: 'top' }));
    expect(cross2.side).toBe('left');
  });

  it('› respects avoid rects', () => {
    const avoid = [rect(400, 400, 400, 200)]; // under the target
    const p = placePopup(base({ preferred: 'bottom', avoid }));
    expect(intersects(boxOf(p), avoid[0])).toBe(false);
    expect(p.mode).toBe('anchored');
    // Slides sideways past a narrow avoid rect instead of changing side.
    const narrow = [rect(540, 395, 60, 60)];
    const q = placePopup(base({ preferred: 'bottom', avoid: narrow }));
    expect(q.side).toBe('bottom');
    expect(intersects(boxOf(q), narrow[0])).toBe(false);
  });

  it('› narrows (minW) to sit beside the target when a dock leaves too little room', () => {
    // 740x700 with a 400px guide down the left: 302px of room on the right.
    const vp = { w: 740, h: 700 };
    const guide = rect(16, 64, 400, 620);
    const target = rect(660, 8, 28, 28); // a header button, top right
    const full = placePopup({ target, viewport: vp, size: { w: 320, h: 130 }, preferred: 'bottom', avoid: [guide] });
    expect(full.mode).not.toBe('anchored');
    const narrow = placePopup({ target, viewport: vp, size: { w: 320, h: 130 }, preferred: 'bottom', avoid: [guide], minW: 220 });
    expect(narrow.mode).toBe('anchored');
    expect(narrow.width).toBeLessThan(320);
    expect(intersects(boxOf(narrow), guide)).toBe(false);
    expect(narrow.height).toBeGreaterThan(130); // reflowed text is taller
  });

  it('› clamps inside viewport with edgePad', () => {
    const p = placePopup(base({ target: rect(5, 300, 40, 20), preferred: 'bottom' }));
    expect(p.left).toBeGreaterThanOrEqual(12);
    const q = placePopup(base({ target: rect(1250, 300, 20, 20), preferred: 'top' }));
    expect(q.left + q.width).toBeLessThanOrEqual(1280 - 12);
    expect(insideViewport(boxOf(q), VP, 12)).toBe(true);
  });

  it('› caret stays 14px from corners', () => {
    const p = placePopup(base({ target: rect(2, 300, 10, 10), preferred: 'bottom' }));
    expect(p.caret).toBeGreaterThanOrEqual(14);
    const q = placePopup(base({ target: rect(1268, 300, 10, 10), preferred: 'bottom' }));
    expect(q.caret).toBeLessThanOrEqual(q.width - 14);
    // Lined up with arrowFrom on the caret edge.
    expect(q.arrowFrom!.x - q.left).toBeCloseTo(q.caret);
  });

  it('› large target uses inset next to focus on the side with most room', () => {
    const target = rect(0, 0, 1280, 800);
    const focus = { x: 300, y: 400 };
    const p = placePopup(base({ target, focus, preferred: 'right' }));
    expect(p.mode).toBe('inset');
    expect(p.side).toBe('right'); // most room is to the right of x=300
    expect(p.left).toBe(300 + 10 + FOCUS_RING_R);
    const q = placePopup(base({ target, focus: { x: 1000, y: 400 }, preferred: 'right' }));
    expect(q.side).toBe('left');
  });

  it('› inset arrowLen <= 160 whenever the target is at least popup size + 2*gap on some side of focus', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const tw = 700 + rnd() * 580;
      const th = 450 + rnd() * 350;
      const target = rect(rnd() * (1280 - tw), rnd() * (800 - th), tw, th);
      const focus = { x: target.left + rnd() * tw, y: target.top + rnd() * th };
      const p = placePopup(base({ target, focus, preferred: 'right' }));
      const roomOnSomeSide =
        target.right - focus.x >= SIZE.w + 2 * 10 + FOCUS_RING_R ||
        focus.x - target.left >= SIZE.w + 2 * 10 + FOCUS_RING_R ||
        target.bottom - focus.y >= SIZE.h + 2 * 10 + FOCUS_RING_R ||
        focus.y - target.top >= SIZE.h + 2 * 10 + FOCUS_RING_R;
      if (p.mode !== 'inset' || !roomOnSomeSide) continue;
      expect(p.arrowExempt).toBe(false);
      expect(p.arrowLen).toBeLessThanOrEqual(MAX_ARROW);
    }
  });

  it('› inset falls back to the far corner with arrowExempt only when no side next to focus fits', () => {
    // Focus dead centre of a target just big enough for the popup in a corner,
    // with an avoid rect blocking every side next to focus.
    const target = rect(100, 100, 1000, 600);
    const focus = { x: 600, y: 400 };
    const avoid = [rect(560, 200, 80, 400), rect(300, 360, 600, 80)];
    const p = placePopup(base({ target, focus, avoid, preferred: 'right', size: { w: 300, h: 140 } }));
    expect(p.mode).toBe('inset');
    // The usual case has a side and no exemption.
    const q = placePopup(base({ target, focus, preferred: 'right' }));
    expect(q.arrowExempt).toBe(false);
    expect(q.side).not.toBeNull();
    if (p.arrowExempt) {
      expect(p.side).toBeNull();
      expect(p.arrowFrom).toBeNull();
    } else {
      expect(p.arrowLen).toBeLessThanOrEqual(MAX_ARROW);
    }
    // Forced: every beside position is blocked, so it must be the corner.
    const block = [rect(100, 100, 1000, 120), rect(100, 580, 1000, 120), rect(100, 220, 200, 360), rect(900, 220, 200, 360)];
    const blocked = placePopup(base({ target, focus, avoid: block, preferred: 'right', size: { w: 300, h: 140 } }));
    expect(blocked.mode).toBe('inset');
    expect(coversPoint(boxOf(blocked), focus, FOCUS_RING_R)).toBe(false);
  });

  it('› far corner is used when focus sits mid-target and the sides are cramped', () => {
    // Target 700x500: beside focus there is <300px either way horizontally and
    // <140 vertically, but a corner still fits without covering focus.
    const target = rect(290, 150, 700, 500);
    const focus = { x: 640, y: 400 };
    const p = placePopup(base({ target, focus, preferred: 'right', size: { w: 330, h: 230 } }));
    expect(p.mode).toBe('inset');
    expect(p.arrowExempt).toBe(true);
    expect(coversPoint(boxOf(p), focus, FOCUS_RING_R)).toBe(false);
    expect(p.left === 290 + 0 || p.left + p.width === 990 || p.top === 150 || p.top + p.height === 650).toBe(true);
  });

  it('› inset never covers focus', () => {
    const rnd = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const vp = { w: 740 + Math.round(rnd() * 1180), h: 600 + Math.round(rnd() * 600) };
      const target = rect(0, 0, vp.w, vp.h);
      const focus = { x: rnd() * vp.w, y: rnd() * vp.h };
      const p = placePopup({ target, focus, viewport: vp, preferred: 'right', size: { w: 200 + rnd() * 200, h: 80 + rnd() * 180 } });
      expect(p.mode).toBe('inset');
      expect(coversPoint(boxOf(p), p.arrowTo ?? focus, FOCUS_RING_R)).toBe(false);
    }
  });

  it('› sheet and fallback respect avoid', () => {
    const vp = { w: 740, h: 700 };
    const guide = rect(16, 652, 360, 32); // collapsed guide header, bottom-left
    const sheet = placePopup({ target: rect(100, 100, 50, 20), viewport: vp, size: { w: 400, h: 200 }, preferred: 'bottom', sheetBelow: 760, avoid: [guide] });
    expect(sheet.mode).toBe('sheet');
    expect(sheet.top + sheet.height).toBe(guide.top - 10);
    expect(intersects(boxOf(sheet), guide)).toBe(false);
    const fb = placePopup({ target: null, viewport: { w: 1280, h: 800 }, size: { w: 400, h: 200 }, preferred: 'bottom', avoid: [rect(860, 700, 400, 80)] });
    expect(fb.mode).toBe('fallback');
    expect(fb.top + fb.height).toBe(700 - 10);
    // An avoid rect at the top (update banner) doesn't drag the card up.
    const banner = placePopup({ target: null, viewport: { w: 1280, h: 800 }, size: { w: 400, h: 200 }, preferred: 'bottom', avoid: [rect(0, 0, 1280, 50)] });
    expect(banner.top + banner.height).toBe(800 - 12);
  });

  it('› jump detector: side change or >24px move with a still target counts; target-driven moves don\'t', () => {
    const t = rect(100, 100, 50, 50);
    const a = { box: rect(200, 100, 300, 100), side: 'right' as Side, mode: 'anchored' as const, target: t };
    expect(jumped(a, { ...a, side: 'left' })).toBe(true);
    expect(jumped(a, { ...a, mode: 'inset' })).toBe(true);
    expect(jumped(a, { ...a, box: rect(200, 140, 300, 100) })).toBe(true);
    expect(jumped(a, { ...a, box: rect(210, 110, 300, 100) })).toBe(false);
    // The target grew/moved (results arriving): the card following it is fine,
    // even when that takes it to another side or into inset mode.
    expect(jumped(a, { ...a, box: rect(200, 300, 300, 100), target: rect(100, 300, 50, 50) })).toBe(false);
    expect(jumped(a, { ...a, side: 'bottom', target: rect(100, 100, 50, 400) })).toBe(false);
    expect(jumped(a, { ...a, mode: 'inset', target: rect(0, 0, 1200, 700) })).toBe(false);
  });

  it('› anchored never overlaps target', () => {
    const rnd = mulberry32(42);
    const sides: Side[] = ['top', 'bottom', 'left', 'right'];
    for (let i = 0; i < 500; i++) {
      const vp = { w: 740 + Math.round(rnd() * 1180), h: 600 + Math.round(rnd() * 600) };
      const tw = 4 + rnd() * vp.w * 1.1;
      const th = 4 + rnd() * vp.h * 1.1;
      const target = rect(rnd() * vp.w - tw / 4, rnd() * vp.h - th / 4, tw, th);
      const size = { w: 200 + rnd() * 200, h: 80 + rnd() * 180 };
      const avoid = rnd() < 0.3 ? [rect(16, vp.h - 60, 360, 44)] : [];
      const sheetBelow = rnd() < 0.3 ? 760 : undefined;
      const p = placePopup({ target, viewport: vp, size, preferred: sides[i % 4], avoid, sheetBelow });
      const box = boxOf(p);
      expect(insideViewport(box, vp, 0), `case ${i} in viewport`).toBe(true);
      for (const a of avoid) expect(intersects(box, a), `case ${i} avoid`).toBe(false);
      if (p.mode === 'anchored') {
        expect(intersects(box, target), `case ${i} anchored overlap`).toBe(false);
        expect(p.arrowLen).toBeLessThanOrEqual(MAX_ARROW);
      } else if (p.mode === 'inset') {
        expect(coversPoint(box, p.arrowTo ?? { x: target.left + tw / 2, y: target.top + th / 2 }, FOCUS_RING_R), `case ${i} inset focus`).toBe(false);
        if (!p.arrowExempt) expect(p.arrowLen).toBeLessThanOrEqual(MAX_ARROW);
      } else if (p.mode === 'sheet') {
        expect(vp.w).toBeLessThan(760);
      } else {
        // fallback only when nothing of the target is on screen
        const onScreen = intersects(target, rect(0, 0, vp.w, vp.h));
        expect(onScreen, `case ${i} fallback`).toBe(false);
      }
    }
  });

  it('› viewport narrower than sheetBelow yields sheet with arrow up to focus', () => {
    const vp = { w: 740, h: 700 };
    const p = placePopup({ target: rect(300, 120, 80, 30), focus: { x: 340, y: 135 }, viewport: vp, size: { w: 400, h: 220 }, preferred: 'right', sheetBelow: 760 });
    expect(p.mode).toBe('sheet');
    expect(p.width).toBe(740 - 24);
    expect(p.left).toBe(12);
    expect(p.caretEdge).toBe('top');
    expect(p.arrowFrom!.y).toBe(p.top);
    expect(p.arrowTo).toEqual({ x: 340, y: 135 });
    expect(p.arrowTo!.y).toBeLessThan(p.arrowFrom!.y); // pointing up
    // Wide windows ignore sheetBelow.
    expect(placePopup({ target: rect(300, 120, 80, 30), viewport: { w: 1024, h: 700 }, size: { w: 400, h: 220 }, preferred: 'right', sheetBelow: 760 }).mode).toBe('anchored');
  });

  it('› null target returns fallback', () => {
    const p = placePopup(base({ target: null }));
    expect(p.mode).toBe('fallback');
    expect(p.arrowFrom).toBeNull();
    expect(p.left + p.width).toBe(1280 - 12);
    expect(p.top + p.height).toBe(800 - 12);
    // Off-screen target counts as no target.
    expect(placePopup(base({ target: rect(-500, 100, 100, 100) })).mode).toBe('fallback');
  });

  it('› small inline target (Term) flips above near the bottom edge', () => {
    const p = placePopup({ target: rect(600, 770, 60, 16), viewport: VP, size: { w: 256, h: 80 }, preferred: 'bottom', gap: 6, edgePad: 8 });
    expect(p.side).toBe('top');
    expect(p.top + p.height).toBe(770 - 6);
    const q = placePopup({ target: rect(600, 300, 60, 16), viewport: VP, size: { w: 256, h: 80 }, preferred: 'bottom', gap: 6, edgePad: 8 });
    expect(q.side).toBe('bottom');
  });
});
