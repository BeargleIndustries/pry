// Tour step targets name an element marked `data-tour="..."` or, to reuse the
// first-time tips' anchors, `data-tip="..."`. anchors.test.ts checks that every
// target is present somewhere in the UI source.

export function anchorSelector(target: string): string {
  const t = CSS.escape(target);
  return `[data-tour="${t}"], [data-tip="${t}"]`;
}

/** First on-screen element for a target (hidden duplicates, e.g. the other layout's copy, are skipped). */
export function findAnchor(target: string, root: ParentNode = document): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>(anchorSelector(target));
  for (const el of all) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

export type AnchorState = 'usable' | 'hidden' | 'disabled' | 'covered';

/**
 * Whether a popup can point at `el` right now: on screen, not inert or
 * disabled, and not covered by something else (the loading screen, a dialog,
 * the experiment guide). `ignore` is a popup that may overlap its own target.
 */
export function anchorState(el: HTMLElement, ignore: Element | null = null): AnchorState {
  if (typeof document === 'undefined') return 'hidden';
  if (!el.isConnected || el.getClientRects().length === 0) return 'hidden';
  if (el.closest('[inert], [aria-hidden="true"]')) return 'hidden';
  if (el.matches('button, input, select, textarea') && (el as HTMLButtonElement).disabled) return 'disabled';
  if (el.getAttribute('aria-disabled') === 'true') return 'disabled';
  // Probe the middle of the part that's on screen: a panel taller than the
  // window still counts as visible when its top half is showing.
  const r = el.getBoundingClientRect();
  const left = Math.max(r.left, 0);
  const top = Math.max(r.top, 0);
  const right = Math.min(r.right, window.innerWidth);
  const bottom = Math.min(r.bottom, window.innerHeight);
  if (right <= left || bottom <= top) return 'hidden';
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  if (!hit) return 'hidden';
  if (ignore?.contains(hit)) return 'usable';
  // Popups and the pointer overlay never count as covering a target.
  if (hit.closest('[data-popup]')) return 'usable';
  if (el === hit || el.contains(hit) || hit.contains(el)) return 'usable';
  return 'covered';
}

export function anchorUsable(el: HTMLElement, ignore: Element | null = null): boolean {
  return anchorState(el, ignore) === 'usable';
}
