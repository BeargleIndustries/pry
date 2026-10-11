// Roving-focus keyboard model for cell grids (T29).
//
// One Tab stop per grid: only the "current" cell has tabindex 0, the rest -1.
// Arrow keys move between cells, Home/End jump to the start/end of the row,
// Ctrl+Home/End to the first/last cell, PageUp/PageDown to the first/last row.
// Enter and Space activate the cell. Moves stop at the edges (no wrapping), so
// a screen-reader user always knows where the grid ends.
//
// Grids may be ragged (rows of different lengths, e.g. Key parts nodes per
// layer). `shape` is either { rows, cols } or an array of row lengths.

export interface GridCell {
  row: number;
  col: number;
}

export type GridShape = { rows: number; cols: number } | readonly number[];

function rowLengths(shape: GridShape): readonly number[] {
  if (Array.isArray(shape)) return shape as readonly number[];
  const { rows, cols } = shape as { rows: number; cols: number };
  return Array.from({ length: Math.max(0, rows) }, () => Math.max(0, cols));
}

/** First and last rows that have at least one cell, or null for an empty grid. */
function rowBounds(lens: readonly number[]): { first: number; last: number } | null {
  const first = lens.findIndex((n) => n > 0);
  if (first < 0) return null;
  let last = lens.length - 1;
  while (lens[last] <= 0) last--;
  return { first, last };
}

/** Nearest non-empty row from `row` stepping by `dir`, or null past the edge. */
function nextRow(lens: readonly number[], row: number, dir: 1 | -1): number | null {
  for (let r = row + dir; r >= 0 && r < lens.length; r += dir) {
    if (lens[r] > 0) return r;
  }
  return null;
}

/**
 * Pull a cell back inside the grid (after the grid shrinks, or for the initial
 * tab stop). Returns null when the grid has no cells.
 */
export function clampCell(cell: GridCell, shape: GridShape): GridCell | null {
  const lens = rowLengths(shape);
  const b = rowBounds(lens);
  if (!b) return null;
  let row = Math.min(Math.max(cell.row, 0), lens.length - 1);
  if (lens[row] <= 0) row = nextRow(lens, row, 1) ?? nextRow(lens, row, -1) ?? b.first;
  const col = Math.min(Math.max(cell.col, 0), lens[row] - 1);
  return { row, col };
}

export function isActivateKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

/**
 * Where a key press moves focus. Returns the new cell (possibly unchanged at an
 * edge, so callers still preventDefault and keep the page from scrolling), or
 * null when the key isn't a grid-navigation key.
 */
export function moveInGrid(
  key: string,
  at: GridCell,
  shape: GridShape,
  ctrl = false,
): GridCell | null {
  const lens = rowLengths(shape);
  const b = rowBounds(lens);
  if (!b) return null;
  const cur = clampCell(at, lens)!;
  const lastCol = (r: number) => lens[r] - 1;
  switch (key) {
    case 'ArrowRight':
      return { row: cur.row, col: Math.min(cur.col + 1, lastCol(cur.row)) };
    case 'ArrowLeft':
      return { row: cur.row, col: Math.max(cur.col - 1, 0) };
    case 'ArrowDown': {
      const r = nextRow(lens, cur.row, 1);
      return r === null ? cur : { row: r, col: Math.min(cur.col, lastCol(r)) };
    }
    case 'ArrowUp': {
      const r = nextRow(lens, cur.row, -1);
      return r === null ? cur : { row: r, col: Math.min(cur.col, lastCol(r)) };
    }
    case 'Home':
      return ctrl ? { row: b.first, col: 0 } : { row: cur.row, col: 0 };
    case 'End':
      return ctrl ? { row: b.last, col: lastCol(b.last) } : { row: cur.row, col: lastCol(cur.row) };
    case 'PageUp':
      return { row: b.first, col: Math.min(cur.col, lastCol(b.first)) };
    case 'PageDown':
      return { row: b.last, col: Math.min(cur.col, lastCol(b.last)) };
    default:
      return null;
  }
}

export function sameCell(a: GridCell | null, b: GridCell | null): boolean {
  return !!a && !!b && a.row === b.row && a.col === b.col;
}

/** Minimal DOM surface so the focus helper is testable without a browser. */
interface QueryRoot {
  querySelector(selector: string): { focus(): void } | null;
}

/**
 * Focus the cell marked with data-row / data-col inside `root`. Returns whether
 * a cell was found. Cells must carry those two attributes.
 */
export function focusGridCell(root: QueryRoot | null | undefined, cell: GridCell): boolean {
  const el = root?.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
  if (!el) return false;
  el.focus();
  return true;
}

/**
 * Shared keydown handling for a roving grid. `activate` runs on Enter/Space
 * unless the cells are native buttons (pass `nativeActivate: true`; the browser
 * clicks them itself). Returns the new current cell, or null if the key was
 * not handled.
 */
export function handleGridKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'preventDefault'>,
  at: GridCell,
  shape: GridShape,
  root: QueryRoot | null | undefined,
  opts: { activate?: (cell: GridCell) => void; nativeActivate?: boolean } = {},
): GridCell | null {
  if (isActivateKey(e.key)) {
    if (opts.nativeActivate || !opts.activate) return null;
    e.preventDefault();
    opts.activate(at);
    return at;
  }
  const next = moveInGrid(e.key, at, shape, e.ctrlKey || e.metaKey);
  if (!next) return null;
  e.preventDefault();
  focusGridCell(root, next);
  return next;
}
