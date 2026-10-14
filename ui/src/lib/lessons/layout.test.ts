import { describe, expect, it } from 'vitest';
import {
  HANDLE,
  MIN_SIDEBAR,
  afterOsRounding,
  clampSidebar,
  defaultSidebar,
  layoutFor,
  maxSidebar,
  readPrefs,
  widenShown,
  widenTarget,
  writePref,
  type Side,
  type WidenInput,
} from './layout';

const widths = (w: number) => {
  const out: number[] = [];
  for (let s = MIN_SIDEBAR; s <= maxSidebar(w); s++) out.push(s);
  return out;
};

describe('layout', () => {
  for (const side of ['right', 'left'] as Side[]) {
    describe(`sidebar on the ${side}`, () => {
      // The side mirrors the markup only; every width rule is the same.
      it('› off-mode equals the 0.3.8 query at 1024/1279/1280/1920', () => {
        for (const w of [1024, 1279, 1280, 1920]) {
          const l = layoutFor({ on: false, windowWidth: w, sidebarWidth: 400, collapsed: false });
          const q = w >= 1280; // (min-width: 1280px)
          expect({ w, wide: l.windowWide, split: l.workspaceSplit, prompt: l.promptInHeader, sidebar: l.sidebar }).toEqual({ w, wide: q, split: q, prompt: q, sidebar: 0 });
        }
      });

      it('› 1280 any width splits', () => {
        for (const w of [1280, 1366, 1600, 1920]) {
          for (const s of widths(w)) expect(layoutFor({ on: true, windowWidth: w, sidebarWidth: s, collapsed: false }).workspaceSplit).toBe(true);
        }
        expect(maxSidebar(1280)).toBe(512);
        expect(1280 - 512 - HANDLE).toBe(762);
      });

      it('› 1024 any width is tabbed', () => {
        for (const s of widths(1024)) {
          const l = layoutFor({ on: true, windowWidth: 1024, sidebarWidth: s, collapsed: false });
          expect(l.workspaceSplit).toBe(false);
          expect(l.railed).toBe(false);
        }
        expect(1024 - MIN_SIDEBAR - HANDLE).toBe(698);
      });

      it("› opening at 1024x700 doesn't rail (640 stays open)", () => {
        expect(defaultSidebar(1024)).toBe(378);
        const l = layoutFor({ on: true, windowWidth: 1024, sidebarWidth: null, collapsed: false });
        expect(l).toMatchObject({ railed: false, workspace: 640, sidebar: 378 });
      });

      it('› a 639 workspace rails', () => {
        // A window resized under the minimum (the 960 and 740 harness sizes).
        const l = layoutFor({ on: true, windowWidth: 965, sidebarWidth: 320, collapsed: false });
        expect(965 - 320 - HANDLE).toBe(639);
        expect(l.railed).toBe(true);
        expect(layoutFor({ on: true, windowWidth: 966, sidebarWidth: 320, collapsed: false }).railed).toBe(false);
      });

      it('› dragging never moves the prompt', () => {
        for (const w of [1024, 1100, 1279, 1280, 1600]) {
          const places = new Set(widths(w).map((s) => layoutFor({ on: true, windowWidth: w, sidebarWidth: s, collapsed: false }).promptInHeader));
          expect(places.size).toBe(1);
          expect([...places][0]).toBe(layoutFor({ on: false, windowWidth: w, sidebarWidth: null, collapsed: false }).promptInHeader);
        }
        // Dragging clamps at window - 640 - 6 and at 40%.
        expect(clampSidebar(900, 1024)).toBe(378);
        expect(clampSidebar(100, 1024)).toBe(MIN_SIDEBAR);
      });

      const base: WidenInput = {
        on: true,
        workspaceSplit: false,
        maximized: false,
        window: { width: 1024, height: 700 },
        sidebar: 378,
        workArea: { width: 1920, height: 1040 },
        scale: 1,
      };

      it('› widen is hidden when off, split, maximised or too small', () => {
        expect(widenShown(base)).toBe(true);
        expect(widenShown({ ...base, on: false })).toBe(false);
        expect(widenShown({ ...base, workspaceSplit: true })).toBe(false);
        expect(widenShown({ ...base, maximized: true })).toBe(false);
        expect(widenShown({ ...base, workArea: { width: 1100, height: 1040 } })).toBe(false);
        expect(widenShown({ ...base, workArea: { width: 1920, height: 1040 }, scale: 1.75 })).toBe(false); // 1097 logical
      });

      it('› the widen target splits', () => {
        const t = widenTarget(base);
        expect(t).toEqual({ width: 378 + 6 + 760 + 2, height: 700 });
        const l = layoutFor({ on: true, windowWidth: t.width, sidebarWidth: 378, collapsed: false });
        expect(l.workspaceSplit).toBe(true);
      });

      it('› widen from 1024 undragged ends split at device scale 1.25', () => {
        const sidebar = defaultSidebar(1024); // frozen before the resize
        const input = { ...base, sidebar, workArea: { width: 2400, height: 1300 }, scale: 1.25 };
        expect(widenShown(input)).toBe(true);
        const t = widenTarget(input);
        const real = afterOsRounding(t.width, 1.25);
        const l = layoutFor({ on: true, windowWidth: real, sidebarWidth: sidebar, collapsed: false });
        expect(l.workspace).toBeGreaterThanOrEqual(760);
        expect(l.workspaceSplit).toBe(true);
      });
    });
  }

  it('remembers width, side, collapsed and open', () => {
    const m = new Map<string, string>();
    const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readPrefs(kv)).toEqual({ open: false, width: null, side: 'right', collapsed: false });
    writePref('side', 'left', kv);
    writePref('width', '420', kv);
    writePref('collapsed', 'true', kv);
    writePref('open', 'true', kv);
    expect(readPrefs(kv)).toEqual({ open: true, width: 420, side: 'left', collapsed: true });
  });
});
