// Check items (plan T1 "Checks", T3 `checks.ts`): an observe's `check`, a
// task's `target` / `constraint`, a step's `when`. Operators: equals, in,
// changed_from, gt, lt, increased, decreased, within, contains, starts_with,
// each negatable with `not: true`; a list of items must all hold.
//
// The operators (compareOp) are shared with lesson-walk.ts, which checks every
// bundled lesson's authored checks against the recorded responses.
//
// Values: a constant, `$prediction`, `$before.<readout>`, `$baseline.<readout>`,
// `$capture.<name>.<readout>`, `$earlier.<key>`, `$read.<readout>` (with
// `value_args`), `$row.<id>.<field>`, `$slot.<name>` (the slot's expect), or,
// with no value, the item's own `expect`. Messages name the binding: "The app
// agrees with your prediction" / "The app shows what the lesson expected" /
// "...something different...: X". `prose` readouts are never checked.

import type { ReadoutDef, ToolActionSet } from '../registry/contract';
import type { CheckItem } from '../format/schema';
import { formatValue, type SlotFormat } from '../slots';
import { lessonsCopy } from '../copy';

export type Binding = 'prediction' | 'lesson' | 'run' | 'before' | 'baseline' | 'earlier' | 'other';

export interface CheckEnv {
  set: Pick<ToolActionSet<unknown>, 'readouts'>;
  /** Reads a readout live, or from the named capture. Args are already resolved. */
  read(readout: string, args: Record<string, unknown> | undefined, from?: string): unknown;
  /** The committed prediction's value (choice text with quotes removed, free text, or a pick). */
  prediction?: unknown;
  /** `$before.<readout>`: the reading taken before this visit's first do step. */
  before?(readout: string, args: Record<string, unknown> | undefined): unknown;
  /** `$baseline.<readout>`: the reading at the lesson's starting scene. */
  baseline?(readout: string, args: Record<string, unknown> | undefined): unknown;
  earlier?(key: string): unknown;
  row?(id: string, field: string): unknown;
  /** `$slot.<name>`: the slot's expected value (or its row constant). */
  slot?(name: string): unknown;
  /** Resolves `$row` / `$earlier` bindings inside `args`. */
  resolveArgs?(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
  /** The lesson's model when another model is loaded: checks add the caveat. */
  mismatch?: { model: string } | null;
}

export interface CheckOutcome {
  /** true: holds; false: doesn't; null: a readout isn't there yet. */
  agrees: boolean | null;
  binding: Binding;
  bindingName?: string;
  actual: unknown;
  expected: unknown;
  text: string;
  item: CheckItem;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Choice text written in quotes (`"\" Paris\""`) compares as the token inside them. */
export function predictionValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const m = /^\s*["“'‘](.*)["”'’]\s*$/s.exec(v);
  return m ? m[1] : v;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** Numbers within `tol`; everything else structurally equal. */
function near(a: unknown, b: unknown, tol: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  return deepEqual(a, b);
}

/**
 * Every field the expected record names equals the same field in `got`; extra
 * fields in `got` are ignored (a head `{layer, head}` against a map part, or
 * against a `head_scores.top` entry that also carries `induction`).
 */
export function subsetMatch(got: unknown, want: Record<string, unknown>, tol = 0): boolean {
  return isObj(got) && Object.entries(want).every(([k, w]) => near(got[k], w, tol));
}

function matches(item: unknown, needle: unknown, tol = 0): boolean {
  return isObj(needle) ? subsetMatch(item, needle, tol) : near(item, needle, tol);
}

function pickField(v: unknown, field?: string): unknown {
  if (!field || !isObj(v)) return v;
  return v[field];
}

/** Default `within` / float `equals` tolerance by unit (the drift tolerances in test_lessons.py). */
export function defaultTolerance(def: ReadoutDef | undefined): number {
  return def?.unit === 'probability' ? 0.02 : 0.05;
}

export function compareOp(op: string, actual: unknown, value: unknown, tolerance: number): boolean {
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  switch (op) {
    case 'equals':
      if (num(actual) && num(value)) {
        if (Number.isInteger(actual) && Number.isInteger(value)) return actual === value;
        return Math.abs(actual - value) <= tolerance;
      }
      return deepEqual(actual, value);
    case 'in':
      return Array.isArray(value) ? value.some((v) => deepEqual(actual, v)) : isObj(value) ? Object.keys(value).includes(String(actual)) : false;
    case 'changed_from':
      return !deepEqual(actual, value);
    case 'gt':
    case 'increased':
      return num(actual) && num(value) && actual > value;
    case 'lt':
    case 'decreased':
      return num(actual) && num(value) && actual < value;
    case 'within':
      return num(actual) && num(value) && Math.abs(actual - value) <= tolerance;
    case 'contains':
      if (typeof actual === 'string') {
        if (Array.isArray(value)) return value.some((w) => typeof w === 'string' && actual.includes(w));
        return typeof value === 'string' && actual.includes(value);
      }
      if (Array.isArray(actual)) {
        if (Array.isArray(value)) return value.length > 0 && value.every((n) => actual.some((x) => matches(x, n, tolerance)));
        return actual.some((x) => matches(x, value, tolerance));
      }
      // A record matches on the fields the expected record names.
      return isObj(actual) && isObj(value) && subsetMatch(actual, value, tolerance);
    case 'starts_with':
      return typeof actual === 'string' && typeof value === 'string' && actual.startsWith(value);
    default:
      return false;
  }
}

function formatFor(def: ReadoutDef | undefined): SlotFormat {
  if (def?.unit === 'probability' || def?.unit === 'logit' || def?.unit === 'layer' || def?.unit === 'count') return def.unit;
  if (def?.type === 'string') return 'string';
  return 'number';
}

/** A reading for a message: "9.7% (about 1 in 10)", `" Paris"`, `L9H9`. */
export function formatReading(v: unknown, def: ReadoutDef | undefined, field?: string): string {
  if (v === undefined || v === null) return 'nothing yet';
  const fieldType = field ? def?.fields?.[field] : undefined;
  const fmt = fieldType === 'string' ? 'string' : field && fieldType === 'number' && field === 'prob' ? 'probability' : formatFor(def);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? `"${x}"` : formatValue(x, fmt === 'string' ? 'number' : fmt))).join(', ');
  return formatValue(v, fmt);
}

/** Splits `$kind.rest`. */
function ref(v: unknown): { kind: string; rest: string } | null {
  if (typeof v !== 'string') return null;
  const m = /^\$(prediction|before|baseline|capture|earlier|read|row|slot)(?:\.(.+))?$/.exec(v);
  return m ? { kind: m[1], rest: m[2] ?? '' } : null;
}

function expectUsable(e: unknown): boolean {
  return e !== undefined && e !== 'pending' && e !== 'learner';
}

/** The value an item compares against, and what it's bound to. */
export function resolveValue(item: CheckItem, env: CheckEnv): { value: unknown; binding: Binding; name?: string; missing: boolean } {
  const r = ref(item.value);
  const vArgs = env.resolveArgs ? env.resolveArgs(item.value_args) : item.value_args;
  const field = (v: unknown) => pickField(v, item.value_field);
  if (!r) {
    if (item.value === undefined && expectUsable(item.expect)) return { value: item.expect, binding: 'lesson', missing: false };
    return { value: item.value, binding: 'lesson', missing: false };
  }
  switch (r.kind) {
    case 'prediction': {
      const v = predictionValue(env.prediction);
      return { value: v, binding: 'prediction', missing: v === undefined };
    }
    case 'before': {
      const v = field(env.before?.(r.rest, vArgs));
      return { value: v, binding: 'before', missing: v === undefined };
    }
    case 'baseline': {
      const v = field(env.baseline?.(r.rest, vArgs));
      return { value: v, binding: 'baseline', missing: v === undefined };
    }
    case 'capture': {
      const dot = r.rest.indexOf('.');
      const name = dot < 0 ? r.rest : r.rest.slice(0, dot);
      const readout = dot < 0 ? item.read : r.rest.slice(dot + 1);
      const v = field(env.read(readout, vArgs, name));
      return { value: v, binding: 'run', name, missing: v === undefined };
    }
    case 'earlier': {
      const v = env.earlier?.(r.rest);
      return { value: v, binding: 'earlier', missing: v === undefined };
    }
    case 'read': {
      const v = field(env.read(r.rest, vArgs));
      return { value: v, binding: 'other', missing: v === undefined };
    }
    case 'row': {
      const dot = r.rest.indexOf('.');
      const v = env.row?.(r.rest.slice(0, dot), r.rest.slice(dot + 1));
      return { value: v, binding: 'lesson', missing: v === undefined };
    }
    case 'slot': {
      const v = env.slot?.(r.rest);
      return { value: v, binding: 'lesson', missing: v === undefined };
    }
  }
  return { value: item.value, binding: 'lesson', missing: false };
}

function tolerance(item: CheckItem, env: CheckEnv, def: ReadoutDef | undefined): number {
  const t = item.tolerance;
  if (typeof t === 'number') return t;
  const r = ref(t);
  if (r?.kind === 'slot') {
    const v = env.slot?.(r.rest);
    if (typeof v === 'number') return v;
  }
  if (r?.kind === 'row') {
    const dot = r.rest.indexOf('.');
    const v = env.row?.(r.rest.slice(0, dot), r.rest.slice(dot + 1));
    if (typeof v === 'number') return v;
  }
  return defaultTolerance(def);
}

function message(o: Omit<CheckOutcome, 'text'>, def: ReadoutDef | undefined, env: CheckEnv): string {
  if (o.agrees === null) return lessonsCopy.missingReadout;
  const shows = formatReading(o.actual, def, o.item.field);
  if (env.mismatch) return lessonsCopy.modelCaveat(env.mismatch.model, shows);
  const c = lessonsCopy;
  switch (o.binding) {
    case 'prediction':
      return o.agrees ? c.agreesPrediction : c.differsPrediction(shows);
    case 'run':
      return o.agrees ? c.agreesRun(o.bindingName ?? '') : c.differsRun(o.bindingName ?? '', shows);
    case 'before':
    case 'baseline':
      return o.agrees ? c.agreesBefore : c.differsBefore(shows);
    case 'earlier':
      return o.agrees ? c.agreesEarlier : c.differsEarlier(shows);
    case 'other':
      return o.agrees ? c.agreesOther : c.differsOther(shows);
    default:
      return o.agrees ? c.agreesLesson : c.differsLesson(shows);
  }
}

/** Evaluates one item. A missing readout (or binding value) gives `agrees: null`. */
export function evaluateCheck(item: CheckItem, env: CheckEnv): CheckOutcome {
  const def = env.set.readouts[item.read];
  const args = env.resolveArgs ? env.resolveArgs(item.args) : item.args;
  const base = { item, actual: undefined as unknown, expected: undefined as unknown, binding: 'lesson' as Binding };
  if (!def || def.type === 'prose') {
    const o = { ...base, agrees: null };
    return { ...o, text: lessonsCopy.missingReadout };
  }
  const actual = pickField(env.read(item.read, args, item.from), item.field);
  const v = resolveValue(item, env);
  const o0 = { item, actual, expected: v.value, binding: v.binding, bindingName: v.name };
  if (actual === undefined || v.missing) {
    const o = { ...o0, agrees: null };
    return { ...o, text: message(o, def, env) };
  }
  const held = compareOp(item.op, actual, v.value, tolerance(item, env, def));
  const o = { ...o0, agrees: item.not ? !held : held };
  return { ...o, text: message(o, def, env) };
}

/** A list of items: all must hold. Reports the first that doesn't (or the last one when all do). */
export function evaluateChecks(items: CheckItem | CheckItem[], env: CheckEnv): CheckOutcome {
  const list = Array.isArray(items) ? items : [items];
  let last: CheckOutcome | null = null;
  for (const it of list) {
    const o = evaluateCheck(it, env);
    if (o.agrees !== true) return o;
    last = o;
  }
  return last!;
}

/** A plain-words name for an item (task messages): its readout's doc, first clause. */
export function itemWords(item: CheckItem, set: Pick<ToolActionSet<unknown>, 'readouts'>): string {
  const doc = set.readouts[item.read]?.doc ?? item.read;
  return doc.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
}
