// Captures (plan T1 `do` step `capture`, T3 "Captures are stored per (lesson,
// capture name) in runner state and the journal, restored on replay").
//
// A capture is the tool's generic `result` readout taken when a do step's
// actions finish (Pry: a plain copy of everything its readouts read). A
// readout reads a capture when the runner passes it as `args.from_capture`.
// Captures live in runner state for this session and in the journal, so a
// later visit (or a restart) reads the learner's own run. A replayed step
// reads the stored capture and never writes one (R4-6).

import type { ToolActionSet } from '../registry/contract';
import type { RunnerJournal } from './types';

export const CAPTURE_READOUT = 'result';

export class CaptureStore {
  #mem = new Map<string, unknown>();

  constructor(
    private readonly journal: RunnerJournal,
    private readonly lessonId: () => string,
  ) {}

  #key(name: string): string {
    return `${this.lessonId()}\u0000${name}`;
  }

  /** The stored capture: this session's, else the journal's; undefined when none. */
  get(name: string): unknown | undefined {
    const k = this.#key(name);
    if (this.#mem.has(k)) return this.#mem.get(k);
    const j = this.journal.capture(this.lessonId(), name);
    if (j && CAPTURE_READOUT in j.readouts) {
      this.#mem.set(k, j.readouts[CAPTURE_READOUT]);
      return j.readouts[CAPTURE_READOUT];
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Stores a capture in runner state (the caller journals learner-run ones). */
  set(name: string, value: unknown): void {
    this.#mem.set(this.#key(name), value);
  }

  /** Every capture of the current lesson known this session, by name (views over captured runs). */
  all(names: Iterable<string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const n of names) {
      const v = this.get(n);
      if (v !== undefined) out[n] = v;
    }
    return out;
  }

  clear(): void {
    this.#mem.clear();
  }
}

/** Takes a capture now: the tool's `result` readout. */
export function takeCapture(set: ToolActionSet<any>): unknown | undefined {
  return set.readouts[CAPTURE_READOUT]?.read();
}

/** Reads `readout` (with `args`) from a capture, or live when `capture` is undefined. */
export function readFrom(
  set: ToolActionSet<any>,
  readout: string,
  args: Record<string, unknown> | undefined,
  capture?: unknown,
): unknown | undefined {
  const def = set.readouts[readout];
  if (!def) return undefined;
  if (capture === undefined) return def.read(args && Object.keys(args).length ? args : undefined);
  return def.read({ ...(args ?? {}), from_capture: capture });
}

/** Every capture name the lesson's do steps and tasks declare. */
export function captureNames(steps: { kind: string; fields: Record<string, any>; children: any[] }[]): string[] {
  const out: string[] = [];
  const walk = (ss: typeof steps) => {
    for (const s of ss) {
      if (typeof s.fields.capture === 'string') out.push(s.fields.capture);
      walk(s.children);
    }
  };
  walk(steps);
  return out;
}
