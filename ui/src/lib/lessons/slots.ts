// Slots and asserts (plan T1 "Slots and asserts", Settled 14, D8). A slot
// renders the live readout through a formatter; `expect` is only the expected
// value for checks and pytest, never what the learner sees. Asserts gate
// qualitative wording on live slot values, with an `else` line when they fail.

import type { ReadoutDef } from './registry/contract';
import type { AssertItem, Slot } from './format/schema';

export const PLACEHOLDER = '(appears after you run it)';

/** What a slot reads through: live readouts (or a capture) and row constants. */
export interface SlotSource {
  read(name: string, args?: Record<string, unknown>, capture?: string): unknown;
  row?(id: string): unknown;
  readouts?: Record<string, Pick<ReadoutDef, 'type' | 'unit'>>;
}

export type SlotFormat = NonNullable<Slot['format']>;

const PERCENT = (p: number) => `${(p * 100).toFixed(1).replace(/\.0$/, '')}%`;

/** "about 1 in N" (or "about k in n" above one half), the natural frequency beside a percentage. */
export function naturalFrequency(p: number): string {
  if (p <= 0) return 'about 0 in 1';
  if (p <= 0.5) {
    const n = Math.round(1 / p);
    const rel = Math.abs(1 / n - p) / p;
    if (rel <= 0.1 || p < 0.2) return `about 1 in ${n}`;
  }
  if (p > 0.95) {
    const n = Math.round(1 / (1 - p));
    return `about ${n - 1} in ${n}`;
  }
  let best = { k: 1, n: 2, err: Infinity };
  for (let n = 2; n <= 10; n++) {
    for (let k = 1; k < n; k++) {
      const err = Math.abs(k / n - p);
      if (err < best.err - 1e-9) best = { k, n, err };
    }
  }
  return `about ${best.k} in ${best.n}`;
}

export function formatProbability(p: number): string {
  return `${PERCENT(p)} (${naturalFrequency(p)})`;
}

/** Formats one value the way the plan names: probability, logit, layer, count, position, string. */
export function formatValue(v: unknown, format: SlotFormat): string {
  if (v === undefined || v === null) return PLACEHOLDER;
  if (format === 'string') return `"${String(v)}"`;
  if (Array.isArray(v)) return v.map((x) => formatValue(x, format)).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.layer === 'number' && typeof o.head === 'number') return `L${o.layer}H${o.head}`;
    return JSON.stringify(v);
  }
  if (typeof v !== 'number') return String(v);
  switch (format) {
    case 'probability':
      return formatProbability(v);
    case 'logit':
      return v.toFixed(2);
    case 'layer':
      return `L${Math.round(v)}`;
    case 'count':
    case 'position':
      return String(Math.round(v));
    default:
      return String(Number(v.toFixed(3)));
  }
}

/** The format a slot renders with: its own `format`, else from the readout's unit and type. */
export function slotFormat(slot: Slot, readouts?: SlotSource['readouts']): SlotFormat {
  if (slot.format) return slot.format;
  if (slot.formula === 'share') return 'probability';
  const def = slot.read ? readouts?.[slot.read] : undefined;
  if (def?.unit === 'probability' || def?.unit === 'logit' || def?.unit === 'layer' || def?.unit === 'count') return def.unit;
  if (def?.type === 'string') return 'string';
  return 'number';
}

function pick(v: unknown, field?: string): unknown {
  if (!field || v === undefined || v === null || typeof v !== 'object') return v;
  return (v as Record<string, unknown>)[field];
}

/** Derived formulas. share = (patched - corrupted) / (clean - corrupted), `from: [clean, corrupted, patched]`. */
export function derive(formula: NonNullable<Slot['formula']>, xs: (number | undefined)[]): number | undefined {
  if (xs.some((x) => typeof x !== 'number' || Number.isNaN(x))) return undefined;
  const n = xs as number[];
  switch (formula) {
    case 'share': {
      const [clean, corrupted, patched] = n;
      const span = clean - corrupted;
      // Clean and corrupted nearly equal: the share means nothing, so show only the logits.
      if (Math.abs(span) < 1e-6) return undefined;
      return (patched - corrupted) / span;
    }
    case 'difference':
      return n[0] - n[1];
    case 'sum':
      return n.reduce((a, b) => a + b, 0);
    case 'abs':
      return Math.abs(n[0]);
  }
}

/** A slot's live value (never `expect`). */
export function slotValue(name: string, slots: Record<string, Slot>, src: SlotSource, seen = new Set<string>()): unknown {
  const slot = slots[name];
  if (!slot || seen.has(name)) return undefined;
  seen.add(name);
  if (slot.row !== undefined) {
    const [id, ...rest] = slot.row.split('.');
    return pick(src.row?.(id), rest.join('.') || undefined);
  }
  if (slot.formula && slot.from) {
    const xs = slot.from.map((f) => {
      const v = slotValue(f, slots, src, new Set(seen));
      return typeof v === 'number' ? v : undefined;
    });
    return derive(slot.formula, xs);
  }
  if (!slot.read) return undefined;
  return pick(src.read(slot.read, slot.args, slot.from_capture), slot.field);
}

export function renderSlot(name: string, slots: Record<string, Slot>, src: SlotSource): string {
  const slot = slots[name];
  if (!slot) return `{${name}}`;
  const v = slotValue(name, slots, src);
  if (slot.formula === 'share' && typeof v === 'number' && (v < 0 || v > 1)) return PERCENT(v);
  return formatValue(v, slotFormat(slot, src.readouts));
}

/** Replaces every `{slot}` in a text with its rendered live value. */
export function renderText(text: string, slots: Record<string, Slot>, src: SlotSource): string {
  return text.replace(/\{([a-z_][a-z0-9_]*)\}/g, (m, name: string) => (name in slots ? renderSlot(name, slots, src) : m));
}

export interface AssertLog {
  (entry: { message: string; slot: string; say: string; else: string }): void;
}

function compare(a: unknown, op: string, b: unknown): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return op === 'equals' ? a === b : false;
  switch (op) {
    case 'gt':
      return a > b;
    case 'lt':
      return a < b;
    case 'equals':
      return a === b;
    default:
      return false;
  }
}

/**
 * The line an assert shows: `say` when its requirement holds on the live
 * slots, else `else` (logged, since the lesson's wording fell back).
 */
export function evaluateAssert(a: AssertItem, slots: Record<string, Slot>, src: SlotSource, log?: AssertLog): string {
  const r = a.require;
  const abs = (v: unknown) => (r.abs && typeof v === 'number' ? Math.abs(v) : v);
  const left = abs(slotValue(r.slot, slots, src));
  const right = r.slot2 !== undefined ? abs(slotValue(r.slot2, slots, src)) : r.value;
  if (left !== undefined && compare(left, r.op, right)) return a.say;
  log?.({ message: 'assert fallback taken', slot: r.slot, say: a.say, else: a.else });
  return a.else;
}
