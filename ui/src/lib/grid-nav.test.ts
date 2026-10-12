import { describe, expect, it, vi } from 'vitest';
import {
  clampCell,
  focusGridCell,
  handleGridKey,
  isActivateKey,
  moveInGrid,
  sameCell,
} from './grid-nav';

const rect = { rows: 3, cols: 4 };

describe('moveInGrid (rectangular)', () => {
  it('moves with the arrow keys', () => {
    expect(moveInGrid('ArrowRight', { row: 1, col: 1 }, rect)).toEqual({ row: 1, col: 2 });
    expect(moveInGrid('ArrowLeft', { row: 1, col: 1 }, rect)).toEqual({ row: 1, col: 0 });
    expect(moveInGrid('ArrowDown', { row: 1, col: 1 }, rect)).toEqual({ row: 2, col: 1 });
    expect(moveInGrid('ArrowUp', { row: 1, col: 1 }, rect)).toEqual({ row: 0, col: 1 });
  });

  it('stops at the edges instead of wrapping', () => {
    expect(moveInGrid('ArrowRight', { row: 0, col: 3 }, rect)).toEqual({ row: 0, col: 3 });
    expect(moveInGrid('ArrowLeft', { row: 0, col: 0 }, rect)).toEqual({ row: 0, col: 0 });
    expect(moveInGrid('ArrowUp', { row: 0, col: 2 }, rect)).toEqual({ row: 0, col: 2 });
    expect(moveInGrid('ArrowDown', { row: 2, col: 2 }, rect)).toEqual({ row: 2, col: 2 });
  });

  it('Home/End stay in the row; with Ctrl they go to the first/last cell', () => {
    expect(moveInGrid('Home', { row: 1, col: 2 }, rect)).toEqual({ row: 1, col: 0 });
    expect(moveInGrid('End', { row: 1, col: 2 }, rect)).toEqual({ row: 1, col: 3 });
    expect(moveInGrid('Home', { row: 1, col: 2 }, rect, true)).toEqual({ row: 0, col: 0 });
    expect(moveInGrid('End', { row: 1, col: 2 }, rect, true)).toEqual({ row: 2, col: 3 });
  });

  it('PageUp/PageDown go to the first/last row in the same column', () => {
    expect(moveInGrid('PageUp', { row: 2, col: 3 }, rect)).toEqual({ row: 0, col: 3 });
    expect(moveInGrid('PageDown', { row: 0, col: 1 }, rect)).toEqual({ row: 2, col: 1 });
  });

  it('ignores other keys and empty grids', () => {
    expect(moveInGrid('a', { row: 0, col: 0 }, rect)).toBeNull();
    expect(moveInGrid('Tab', { row: 0, col: 0 }, rect)).toBeNull();
    expect(moveInGrid('ArrowRight', { row: 0, col: 0 }, { rows: 0, cols: 4 })).toBeNull();
  });

  it('pulls an out-of-range start back inside first', () => {
    expect(moveInGrid('ArrowLeft', { row: 9, col: 9 }, rect)).toEqual({ row: 2, col: 2 });
  });
});

describe('moveInGrid (ragged)', () => {
  const ragged = [3, 0, 1, 5];

  it('skips empty rows and clamps the column to the new row', () => {
    expect(moveInGrid('ArrowDown', { row: 0, col: 2 }, ragged)).toEqual({ row: 2, col: 0 });
    expect(moveInGrid('ArrowUp', { row: 2, col: 0 }, ragged)).toEqual({ row: 0, col: 0 });
    expect(moveInGrid('ArrowDown', { row: 2, col: 0 }, ragged)).toEqual({ row: 3, col: 0 });
  });

  it('End uses the current row length', () => {
    expect(moveInGrid('End', { row: 3, col: 0 }, ragged)).toEqual({ row: 3, col: 4 });
    expect(moveInGrid('End', { row: 0, col: 0 }, ragged, true)).toEqual({ row: 3, col: 4 });
  });

  it('Ctrl+Home skips leading empty rows', () => {
    expect(moveInGrid('Home', { row: 3, col: 3 }, [0, 0, 2, 4], true)).toEqual({ row: 2, col: 0 });
  });
});

describe('clampCell', () => {
  it('keeps valid cells and clamps the rest', () => {
    expect(clampCell({ row: 1, col: 1 }, rect)).toEqual({ row: 1, col: 1 });
    expect(clampCell({ row: -1, col: 10 }, rect)).toEqual({ row: 0, col: 3 });
  });

  it('moves off an empty row', () => {
    expect(clampCell({ row: 1, col: 0 }, [2, 0, 3])).toEqual({ row: 2, col: 0 });
    expect(clampCell({ row: 2, col: 0 }, [2, 0, 0])).toEqual({ row: 0, col: 0 });
  });

  it('returns null for an empty grid', () => {
    expect(clampCell({ row: 0, col: 0 }, [])).toBeNull();
    expect(clampCell({ row: 0, col: 0 }, [0, 0])).toBeNull();
  });
});

describe('small helpers', () => {
  it('isActivateKey', () => {
    expect(isActivateKey('Enter')).toBe(true);
    expect(isActivateKey(' ')).toBe(true);
    expect(isActivateKey('ArrowUp')).toBe(false);
  });

  it('sameCell', () => {
    expect(sameCell({ row: 1, col: 2 }, { row: 1, col: 2 })).toBe(true);
    expect(sameCell({ row: 1, col: 2 }, { row: 2, col: 1 })).toBe(false);
    expect(sameCell(null, { row: 0, col: 0 })).toBe(false);
  });
});

function fakeRoot() {
  const focus = vi.fn();
  const querySelector = vi.fn((sel: string) => (sel === '[data-row="1"][data-col="2"]' ? { focus } : null));
  return { root: { querySelector }, focus, querySelector };
}

function fakeKey(key: string, ctrlKey = false) {
  return { key, ctrlKey, metaKey: false, preventDefault: vi.fn() };
}

describe('focusGridCell', () => {
  it('focuses the cell with matching data attributes', () => {
    const { root, focus } = fakeRoot();
    expect(focusGridCell(root, { row: 1, col: 2 })).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('returns false when the cell or root is missing', () => {
    const { root } = fakeRoot();
    expect(focusGridCell(root, { row: 0, col: 0 })).toBe(false);
    expect(focusGridCell(null, { row: 0, col: 0 })).toBe(false);
  });
});

describe('handleGridKey', () => {
  it('moves, focuses and prevents scrolling on arrow keys', () => {
    const { root, focus } = fakeRoot();
    const e = fakeKey('ArrowRight');
    expect(handleGridKey(e, { row: 1, col: 1 }, rect, root)).toEqual({ row: 1, col: 2 });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it('activates on Enter and Space', () => {
    const activate = vi.fn();
    for (const k of ['Enter', ' ']) {
      const e = fakeKey(k);
      expect(handleGridKey(e, { row: 0, col: 1 }, rect, null, { activate })).toEqual({ row: 0, col: 1 });
      expect(e.preventDefault).toHaveBeenCalled();
    }
    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledWith({ row: 0, col: 1 });
  });

  it('leaves Enter/Space to the browser for native buttons', () => {
    const activate = vi.fn();
    const e = fakeKey('Enter');
    expect(handleGridKey(e, { row: 0, col: 0 }, rect, null, { activate, nativeActivate: true })).toBeNull();
    expect(activate).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores unrelated keys', () => {
    const e = fakeKey('Tab');
    expect(handleGridKey(e, { row: 0, col: 0 }, rect, null)).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('passes Ctrl through for Ctrl+End', () => {
    const e = fakeKey('End', true);
    expect(handleGridKey(e, { row: 0, col: 0 }, rect, null)).toEqual({ row: 2, col: 3 });
  });
});
