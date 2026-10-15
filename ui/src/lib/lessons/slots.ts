// Slots and asserts (plan T1 "Slots and asserts", Settled 14, D8). A slot
// renders the live readout through a formatter; `expect` is only the expected
// value for checks and pytest, never what the learner sees. Asserts gate
// qualitative wording on live slot values, with an `else` line when they fail.

import type { ReadoutDef } from './registry/contract';
import type { AssertItem, Slot } from './format/schema';
import { rowConstant, type RowConstant } from './row-constants';

export const PLACEHOLDER = '(appears after you run it)';

/** What a slot reads through: live readouts (or a capture) and row constants. */
export interface SlotSource {
  read(name: string, args?: Record<string, unknown>, capture?: string): unknown;
  /** A row constant, `{row: <id>.<field>}` (default: the bundled rows.json `constants`). */
  row?(id: string, field: string): RowConstant | undefined;
  readouts?: Record<string, Pick<ReadoutDef, 'type' | 'unit'>>;
}

function rowOf(slot: Slot, row: SlotSource['row'] = rowConstant): RowConstant | undefined {
  const [id, ...field] = slot.row!.split('.');
  return row(id, field.join('.'));
}

/** The authored formats, plus `points`: a change in probability (a delta), never a probability itself. */
export type SlotFormat = NonNullable<Slot['format']> | 'points';

const PERCENT = (p: number) => {
  const pct = p * 100;
  // Under 1%, two significant figures, so a small chance doesn't read as 0.1% or 0%.
  const s = Math.abs(pct) < 1 && pct !== 0 ? String(Number(pct.toPrecision(2))) : pct.toFixed(1).replace(/\.0$/, '');
  return `${s}%`;
};

/** N rounded to two significant figures past 100, with a thousands separator: 1094 -> "1,100". */
const roundN = (n: number) => (n >= 100 ? Number(n.toPrecision(2)) : n).toLocaleString('en-US');

/** "about 1 in N" (or "about k in n" above one half), the natural frequency beside a percentage. Only for 0 < p <= 1. */
export function naturalFrequency(p: number): string {
  if (p <= 0 || p > 1) return '';
  if (p <= 0.5) {
    const n = Math.round(1 / p);
    const rel = Math.abs(1 / n - p) / p;
    if (rel <= 0.1 || p < 0.2) return `about 1 in ${roundN(n)}`;
  }
  if (p > 0.95) {
    const n = Math.min(1000, Math.round(1 / (1 - p)));
    return `about ${(n - 1).toLocaleString('en-US')} in ${n.toLocaleString('en-US')}`;
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

/** A probability with its natural frequency; a value outside (0, 1] is a change, so it prints as points. */
export function formatProbability(p: number): string {
  if (p < 0 || p > 1) return formatPoints(p);
  const nf = naturalFrequency(p);
  return nf ? `${PERCENT(p)} (${nf})` : PERCENT(p);
}

/** A change in probability as signed percentage points: "−12.5 points", "+3.6 points". */
export function formatPoints(d: number): string {
  const pts = Math.abs(d * 100);
  const s = pts < 1 && pts !== 0 ? String(Number(pts.toPrecision(2))) : pts.toFixed(1).replace(/\.0$/, '');
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return `${sign}${s} points`;
}

/** Record fields that hold a logit (Swap test cells, predictions). */
const LOGIT_FIELDS = new Set(['logit', 'clean', 'corrupted', 'patched', 'answer_logit', 'contrast_logit']);

/** A record read out in words: `" Paris" 9.7% (about 1 in 10)`, `L2 at position 10: clean 18.47, ...`. */
function formatRecord(o: Record<string, unknown>, format: SlotFormat): string {
  const head = typeof o.layer === 'number' ? (typeof o.head === 'number' ? `L${o.layer}H${o.head}` : `L${o.layer}`) : null;
  const tok = typeof o.token === 'string' ? `"${o.token}"` : null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || k === 'layer' || k === 'head' || k === 'token') continue;
    if (k === 'prob' || k === 'probability') parts.push(typeof v === 'number' ? formatProbability(v) : String(v));
    else if (k === 'delta') parts.push(typeof v === 'number' ? formatPoints(v) : String(v));
    else if (k === 'share') parts.push(`share ${typeof v === 'number' ? PERCENT(v) : String(v)}`);
    else if (k === 'position' || k === 'rank') parts.push(`${k} ${typeof v === 'number' ? Math.round(v) : String(v)}`);
    else if (LOGIT_FIELDS.has(k)) parts.push(`${k.replace(/_/g, ' ')} ${typeof v === 'number' ? v.toFixed(2) : String(v)}`);
    else if (typeof v === 'number') parts.push(`${k.replace(/_/g, ' ')} ${Number(v.toFixed(3))}`);
    else if (typeof v === 'string') parts.push(`${k.replace(/_/g, ' ')} "${v}"`);
    else if (typeof v === 'boolean') parts.push(`${k.replace(/_/g, ' ')} ${v ? 'yes' : 'no'}`);
    else parts.push(`${k.replace(/_/g, ' ')} ${formatValue(v, format)}`);
  }
  const lead = [head, tok].filter(Boolean).join(' ');
  if (!parts.length) return lead || '';
  return lead ? `${lead}${head && !tok ? ':' : ''} ${parts.join(', ')}` : parts.join(', ');
}

/** Formats one value the way the plan names: probability, logit, layer, count, position, string. */
export function formatValue(v: unknown, format: SlotFormat): string {
  if (v === undefined || v === null) return PLACEHOLDER;
  if (format === 'string' && (typeof v !== 'object' || v === null)) return `"${String(v)}"`;
  if (Array.isArray(v)) return v.map((x) => formatValue(x, format)).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.layer === 'number' && typeof o.head === 'number' && Object.keys(o).length === 2) return `L${o.layer}H${o.head}`;
    return formatRecord(o, format);
  }
  if (typeof v !== 'number') return String(v);
  switch (format) {
    case 'points':
      return formatPoints(v);
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

/** A row constant's unit as a slot format; a head index and list elements without `of` render as numbers. */
function rowFormat(c: RowConstant | undefined): SlotFormat {
  const u = c?.unit === 'list' ? c.of : c?.unit;
  return u === 'probability' || u === 'logit' || u === 'layer' || u === 'count' || u === 'position' || u === 'string' ? u : 'number';
}

/** The format a slot renders with: its own `format`, else from the row constant's or readout's unit and type. */
export function slotFormat(slot: Slot, readouts?: SlotSource['readouts'], src?: SlotSource): SlotFormat {
  // A difference of two probabilities is a change: points, never "about 1 in N".
  if (slot.formula === 'difference' && slot.format === 'probability') return 'points';
  if (slot.format) return slot.format;
  if (slot.row !== undefined) return rowFormat(rowOf(slot, src?.row));
  if (slot.formula === 'share') return 'probability';
  const def = slot.read ? readouts?.[slot.read] : undefined;
  return readoutFormat(slot.read, def, slot.field);
}

/** The format for a readout (or one field of a record readout): a `prob` field is a probability, a `*delta` readout a change in points. */
export function readoutFormat(read: string | undefined, def: Pick<ReadoutDef, 'type' | 'unit'> | undefined, field?: string): SlotFormat {
  if (field === 'prob' || field === 'probability') return 'probability';
  if (field === 'delta') return 'points';
  if (field && LOGIT_FIELDS.has(field)) return 'logit';
  if (field === 'share') return 'probability';
  if (field === 'layer') return 'layer';
  if (field === 'position' || field === 'rank') return 'position';
  if (def?.unit === 'probability' && read && /(^|[._])(top_)?delta$/.test(read)) return 'points';
  if (def?.unit === 'probability' || def?.unit === 'logit' || def?.unit === 'layer' || def?.unit === 'count') return def.unit;
  if (def?.type === 'string' || field === 'token') return 'string';
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
    // P2.4:72: ' Mary' is about 29 times as likely as ' John', a logit difference of about 3.4 (ln 29.4).
    case 'ratio':
      return n[1] === 0 ? undefined : n[0] / n[1];
    case 'ln':
      return n[0] > 0 ? Math.log(n[0]) : undefined;
  }
}

/** A slot's live value (never `expect`). */
export function slotValue(name: string, slots: Record<string, Slot>, src: SlotSource, seen = new Set<string>()): unknown {
  const slot = slots[name];
  if (!slot || seen.has(name)) return undefined;
  seen.add(name);
  if (slot.row !== undefined) return rowOf(slot, src.row)?.value;
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
  return formatValue(v, slotFormat(slot, src.readouts, src));
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
