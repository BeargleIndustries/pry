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
