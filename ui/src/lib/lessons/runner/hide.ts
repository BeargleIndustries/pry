// Hide until predict (plan T1 `predict.hides`, TN-2 / N2; T3 `hide.ts`): a
// predict step's `hides` anchors are hidden (the anchor's `hide(true)`) while
// the learner thinks, and revealed on "Commit" or "Skip, just show me". Leaving
// the section reveals them too, so nothing stays hidden behind the learner.

import type { AnchorDef } from '../registry/contract';

export class HideControl {
  #hidden = new Set<string>();

  constructor(private readonly anchors: () => Record<string, AnchorDef>) {}

  /** Hides each anchor that can be hidden; returns the ones it hid. */
  hide(names: string[]): string[] {
    const done: string[] = [];
    for (const n of names) {
      const def = this.anchors()[n];
      if (!def?.hide) continue;
      def.hide(true);
      this.#hidden.add(n);
      done.push(n);
    }
    return done;
  }

  /** Reveals the given anchors (default: everything this control hid). */
  reveal(names?: string[]): void {
    for (const n of names ?? [...this.#hidden]) {
      if (!this.#hidden.has(n)) continue;
      this.anchors()[n]?.hide?.(false);
      this.#hidden.delete(n);
    }
  }

  isHidden(name: string): boolean {
    return this.#hidden.has(name);
  }

  get hidden(): string[] {
    return [...this.#hidden];
  }
}
