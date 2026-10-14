// Navigation control (plan T3 "Runner"): newest navigation wins. Each entry
// bumps a generation counter and aborts the previous entry's controller, so a
// slow scene (an SAE layer switch, a model download) can't land after the
// learner has moved on. Results that arrive for an old generation are dropped.

export interface NavTicket {
  gen: number;
  signal: AbortSignal;
}

export class NavControl {
  #gen = 0;
  #ctl: AbortController | null = null;

  /** Starts a new navigation: aborts the one in flight and returns its ticket. */
  begin(): NavTicket {
    this.#ctl?.abort(new DOMException('A newer navigation started', 'AbortError'));
    this.#ctl = new AbortController();
    this.#gen += 1;
    return { gen: this.#gen, signal: this.#ctl.signal };
  }

  /** True while `t` is the newest navigation. */
  current(t: NavTicket): boolean {
    return t.gen === this.#gen && !t.signal.aborted;
  }

  get generation(): number {
    return this.#gen;
  }

  /** Stops whatever is in flight (closing the lesson). */
  cancel(): void {
    this.#ctl?.abort(new DOMException('Lesson closed', 'AbortError'));
    this.#ctl = null;
    this.#gen += 1;
  }
}

export function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}
