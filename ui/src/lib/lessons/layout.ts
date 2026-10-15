// Lessons layout (plan D2, T3 "Layout", "Widen window to fit").
//
// Two values replace 0.3.8's one `isWide`:
//   windowWide     - the 0.3.8 media query (window >= 1280); drives only where the
//                    prompt sits (header row or its own row below)
//   workspaceSplit - both panels side by side vs one tabbed main area; with
//                    Lessons off it equals windowWide (no observer at all); with
//                    Lessons on it's the measured workspace >= 760
// The proof (handle 6px): at 1280 with the sidebar at its 40% max (512) the
// workspace is 762, so 1280+ splits for every legal width; at 1024 the widest
// workspace (sidebar 320) is 698, so 1024 is tabbed for every legal width.
// Default width = clamp(320, 380, window - 640 - 6): 378 at 1024, leaving
// exactly 640, so opening at 1024x700 never rails. Dragging clamps at
// window - 640 - 6; the sidebar collapses to the 44px rail only when a window
// resize leaves the workspace below 640 (strict). Never `setMinSize`, never a
// new `minWidth`: the 1024x700 minimum stays (Settled 7).

export const WINDOW_WIDE = 1280;
export const SPLIT_AT = 760;
export const HANDLE = 6;
export const MIN_SIDEBAR = 320;
export const DEFAULT_SIDEBAR = 380;
export const MAX_SIDEBAR_FRACTION = 0.4;
export const MIN_WORKSPACE = 640;
export const RAIL = 44;
/** Slack added to the widen target so OS pixel rounding at any scale can't leave 759.x. */
export const WIDEN_SLACK = 2;

export type Side = 'left' | 'right';

/** The 0.3.8 media query, as a number. */
export function windowWide(windowWidth: number): boolean {
  return windowWidth >= WINDOW_WIDE;
}

/** The widest the sidebar may be at this window width (40%, and never leaving under 640). */
export function maxSidebar(windowWidth: number): number {
  return Math.max(MIN_SIDEBAR, Math.min(Math.floor(windowWidth * MAX_SIDEBAR_FRACTION), windowWidth - MIN_WORKSPACE - HANDLE));
}

/** The width Lessons opens at. */
export function defaultSidebar(windowWidth: number): number {
  return Math.max(MIN_SIDEBAR, Math.min(DEFAULT_SIDEBAR, windowWidth - MIN_WORKSPACE - HANDLE));
}

/** A dragged (or remembered) width, clamped to this window. */
export function clampSidebar(width: number, windowWidth: number): number {
  return Math.max(MIN_SIDEBAR, Math.min(Math.round(width), maxSidebar(windowWidth)));
}

export interface LayoutInput {
  /** Lessons open. */
  on: boolean;
  windowWidth: number;
  /** The width the learner chose (or null: the default). */
  sidebarWidth: number | null;
  /** The learner collapsed it to the rail. */
  collapsed: boolean;
  /** The measured workspace width (on: ResizeObserver); null computes it. */
  measuredWorkspace?: number | null;
}

export interface Layout {
  windowWide: boolean;
  workspaceSplit: boolean;
  /** The prompt sits in the header row (else in its own row below). Depends only on the window. */
  promptInHeader: boolean;
  /** The sidebar's width in px (the rail's when railed, 0 when off). */
  sidebar: number;
  railed: boolean;
  workspace: number;
}

/** Off = 0.3.8 exactly. On = sidebar + handle beside a workspace that splits at 760. */
export function layoutFor(i: LayoutInput): Layout {
  const wide = windowWide(i.windowWidth);
  if (!i.on) return { windowWide: wide, workspaceSplit: wide, promptInHeader: wide, sidebar: 0, railed: false, workspace: i.windowWidth };
  const width = i.sidebarWidth === null ? defaultSidebar(i.windowWidth) : clampSidebar(i.sidebarWidth, i.windowWidth);
  const open = i.windowWidth - width - HANDLE;
  const railed = i.collapsed || open < MIN_WORKSPACE;
  const workspace = i.measuredWorkspace ?? (railed ? i.windowWidth - RAIL : open);
  return { windowWide: wide, workspaceSplit: workspace >= SPLIT_AT, promptInHeader: wide, sidebar: railed ? RAIL : width, railed, workspace };
}

export interface WidenInput {
  on: boolean;
  workspaceSplit: boolean;
  maximized: boolean;
  /** Current logical window size. */
  window: { width: number; height: number };
  sidebar: number;
  /** The monitor's work area in physical pixels, and its scale factor. */
  workArea: { width: number; height: number } | null;
  scale: number;
}

/** The logical width that fits sidebar + handle + a split workspace, with slack. */
export function widenWidth(sidebar: number): number {
  return sidebar + HANDLE + SPLIT_AT + WIDEN_SLACK;
}

/** "Widen window" shows only with Lessons on, the workspace tabbed, the window not maximised, and room on the monitor. */
export function widenShown(i: WidenInput): boolean {
  if (!i.on || i.workspaceSplit || i.maximized || !i.workArea) return false;
  const room = i.workArea.width / i.scale;
  return room >= widenWidth(i.sidebar) - WIDEN_SLACK && widenWidth(i.sidebar) - WIDEN_SLACK > i.window.width;
}

/** The logical size "Widen window" asks for (capped to the work area). Height is kept. */
export function widenTarget(i: WidenInput): { width: number; height: number } {
  const room = i.workArea ? i.workArea.width / i.scale : Infinity;
  return { width: Math.min(widenWidth(i.sidebar), Math.floor(room)), height: i.window.height };
}

/** What the window ends up as: the OS rounds a logical size to whole physical pixels (down, at worst). */
export function afterOsRounding(logicalWidth: number, scale: number): number {
  return Math.floor(logicalWidth * scale) / scale;
}

// ---------------------------------------------------------------------------
// Remembered: open, width, side, collapsed (localStorage, try/catch).
// ---------------------------------------------------------------------------

export const LAYOUT_KEYS = {
  open: 'pry:lessons:open',
  width: 'pry:lessons:width',
  side: 'pry:lessons:side',
  collapsed: 'pry:lessons:collapsed',
} as const;

export interface LayoutPrefs {
  open: boolean;
  width: number | null;
  side: Side;
  collapsed: boolean;
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function store(): KV | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readPrefs(kv: KV | undefined = store()): LayoutPrefs {
  const get = (k: string) => {
    try {
      return kv?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const w = Number(get(LAYOUT_KEYS.width));
  return {
    open: get(LAYOUT_KEYS.open) === 'true',
    width: Number.isFinite(w) && w > 0 ? w : null,
    side: get(LAYOUT_KEYS.side) === 'left' ? 'left' : 'right',
    collapsed: get(LAYOUT_KEYS.collapsed) === 'true',
  };
}

export function writePref(key: keyof LayoutPrefs, value: string, kv: KV | undefined = store()): void {
  try {
    kv?.setItem(LAYOUT_KEYS[key], value);
  } catch {
    /* storage unavailable */
  }
}
