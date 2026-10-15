// Walks a bundled lesson through the real Pry registry (tests only; plan T6,
// plan:543). Sections run in order: the scene from `baseline` + each `:::enter`
// (cumulative, `reset: true` restarts), then every step: do steps dispatch
// their actions, observe checks, slot expects and asserts evaluate against the
// readouts. The sidecar is a fake fetch that answers from
// `__generated__/responses/<key>.json`; a request with no recording gets the
// test host's canned answer and is reported as missing.
//
// Used by lesson-checks.test.ts (every check evaluates as authored), by
// lessons-compile.test.ts (expectations.json: every request, check and slot
// expect), and by the lesson checker CLI (scripts/lessons-lint.ts), which
// holds a user lesson's expects to the responses recorded beside its set.
// No vitest here: the walk swaps the global fetch itself and puts it back.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pryToolSet } from './registry/pry-set';
import { createDispatcher, resolveBindings } from './registry/dispatcher';
import { RequestMemo } from './registry/memo';
import { requestKey } from './registry/request-key';
import { answer, makeWalkHost } from './registry/pry-walk-host';
import { evaluateAssert, slotValue, type SlotSource } from './slots';
import { compareOp } from './runner/checks';
import type { AssertItem, CheckItem, Lesson, Slot, Step } from './format/schema';

export interface WalkRequest {
  endpoint: string;
  model: string;
  body: unknown;
  key: string;
}

export interface WalkCheck {
  /** `section/step` where it evaluated. */
  where: string;
  kind: 'check' | 'slot' | 'assert';
  name: string;
  ok: boolean;
  /** Not evaluable here (learner input); listed, not failed. */
  skipped?: string;
  detail: string;
  /** The prompt in the box when it evaluated (expectations.json). */
  prompt?: string;
  check?: CheckItem;
  expect?: unknown;
}

export interface WalkResult {
  lessonId: string;
  requests: WalkRequest[];
  missing: WalkRequest[];
  checks: WalkCheck[];
  errors: string[];
}

export type Recorded = Map<string, unknown[]>;

/** Recorded responses by request key: r1, r2, ... in order (offline variants left out). */
export function loadRecorded(dir: string): Recorded {
  const out: Recorded = new Map();
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { key: string; variant: string; response: unknown };
    const m = /^r(\d+)$/.exec(doc.variant);
    if (!m) continue;
    const list = out.get(doc.key) ?? [];
    list[Number(m[1]) - 1] = doc.response;
    out.set(doc.key, list);
  }
  return out;
}

/**
 * rows.json by row id, for `$row.<id>.<field>`: the row's `constants` (their
 * values) first, then its recorded `values` for any field without a constant.
 */
export function loadRows(file: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!existsSync(file)) return out;
  const doc = JSON.parse(readFileSync(file, 'utf8')) as {
    rows: { id: number; values: Record<string, unknown>; constants?: Record<string, { value: unknown }> }[];
  };
  for (const r of doc.rows) {
    const constants = Object.fromEntries(Object.entries(r.constants ?? {}).map(([k, c]) => [k, c.value]));
    out.set(String(r.id), { ...(r.values ?? {}), ...constants });
  }
  return out;
}

/**
 * Recordings keep only each head's last query row of attention (test_lessons.py
 * `_trim`). Put that row back at the last token's index so readouts that read
 * the last token's row find it; earlier rows stay empty (not recorded).
 */
function untrim(resp: unknown): unknown {
  const r = resp as { tokens?: unknown[]; attention?: { heads: number[][][] }[] } | undefined;
  const n = r?.tokens?.length ?? 0;
  if (!r?.attention || n < 2 || r.attention[0]?.heads?.[0]?.length !== 1) return resp;
  return {
    ...r,
    attention: r.attention.map((l) => ({ ...l, heads: l.heads.map((h) => [...Array.from({ length: n - 1 }, () => []), h[0]]) })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick(v: unknown, field?: string): unknown {
  if (!field) return v;
  let cur = v;
  for (const k of field.split('.')) cur = isObj(cur) ? cur[k] : undefined;
  return cur;
}

function deepEqual(a: unknown, b: unknown, tol?: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (tol ?? 1e-9);
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A recorded expect against a live value: numbers within `tol` (default 1e-3,
 * or 0.1% of the value), at any depth in lists and records, so a list of parts
 * authored with rounded contributions still matches.
 */
function approxEqual(live: unknown, want: unknown, tol?: number): boolean {
  if (typeof live === 'number' && typeof want === 'number') return Math.abs(live - want) <= (tol ?? Math.max(1e-3, Math.abs(want) * 1e-3));
  if (Array.isArray(live) && Array.isArray(want)) return live.length === want.length && want.every((w, i) => approxEqual(live[i], w, tol));
  if (isObj(live) && isObj(want)) {
    const keys = new Set([...Object.keys(live), ...Object.keys(want)]);
    return [...keys].every((k) => approxEqual(live[k], want[k], tol));
  }
  return live === want;
}

/** `value` held by a record: every field it names matches. */
const holdsFields = (got: unknown, want: unknown, tol?: number) =>
  isObj(got) && isObj(want) && Object.entries(want).every(([k, w]) => approxEqual(got[k], w, tol));

/** Default tolerance for a slot's live value against its authored expect. */
function slotTolerance(expect: number, slot: Slot): number {
  return slot.tolerance ?? Math.max(1e-3, Math.abs(expect) * 1e-3);
}

const fmt = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? 'undefined');

export async function walkLesson(
  lesson: Lesson,
  opts: { recorded: Recorded; rows?: Map<string, Record<string, unknown>> },
): Promise<WalkResult> {
  const set = pryToolSet;
  const res: WalkResult = { lessonId: lesson.meta.id, requests: [], missing: [], checks: [], errors: [] };
  const seen = new Map<string, number>();
  const host = makeWalkHost('');

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const endpoint = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const model = (isObj(body) && typeof body.preset_id === 'string' ? body.preset_id : undefined) ?? lesson.meta.model ?? 'gpt2-small';
    const key = await requestKey({ endpoint, model, body });
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const req = { endpoint, model, body, key };
    if (n === 0) res.requests.push(req);
    const list = opts.recorded.get(key);
    let out: unknown = untrim(list?.[n] ?? list?.[0]);
    if (out === undefined) {
      if (n === 0) res.missing.push(req);
      out = answer(endpoint, body);
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const signal = new AbortController().signal;
  const ctx = { signal, wait: () => {} };
  const dispatcher = createDispatcher(set, new RequestMemo(), { kind: 'bundled' });
  const readouts = set.readouts;
  const captures = new Map<string, unknown>();
  let before: unknown;
  let baseline: unknown;

  // Slots in scope: the front matter's plus the current section's own `:::slots`
  // (a section's slots are its own; P3.1 reuses a name across sections).
  let slots: Record<string, Slot> = { ...(lesson.meta.slots ?? {}) };

  const read = (name: string, args?: Record<string, unknown>, capture?: unknown) => {
    const def = readouts[name];
    if (!def) return undefined;
    // `$row` inside readout arguments (slot and check args, P3.3's patch.cell) resolves first.
    const a = args === undefined ? undefined : (resolveBindings(args, bindings) as Record<string, unknown>);
    return def.read(capture !== undefined ? { ...(a ?? {}), from_capture: capture } : a);
  };
  const src: SlotSource = {
    read: (name, args, capture) => read(name, args, capture !== undefined ? captures.get(capture) : undefined),
    // The walker compares values, so the unit only matters for rendering.
    row: (id, field) => {
      const value = pick(opts.rows?.get(id), field);
      return value === undefined ? undefined : { value, unit: 'number' };
    },
    readouts,
  };
  const bindings = { earlier: () => undefined, row: (id: string, field: string) => pick(opts.rows?.get(id), field) };

  /** A check's right-hand side; `skip` when it needs the learner. */
  function rhs(item: CheckItem): { value?: unknown; skip?: string } {
    const v = item.value;
    // `$row` inside a record or list value (P3.3: contains { layer: $row.27.peak_layer }).
    if (typeof v !== 'string') return { value: v !== null && typeof v === 'object' ? resolveBindings(v, bindings) : v };
    if (!v.startsWith('$')) return { value: v };
    let m: RegExpExecArray | null;
    if (v === '$prediction') return { skip: 'compares with the learner\'s prediction' };
    if ((m = /^\$slot\.(.+)$/.exec(v))) return { value: slots[m[1]]?.expect };
    if ((m = /^\$row\.([^.]+)\.(.+)$/.exec(v))) return { value: pick(opts.rows?.get(m[1]), m[2]) };
    if ((m = /^\$read\.(.+)$/.exec(v))) return { value: pick(read(m[1], item.value_args), item.value_field) };
    if ((m = /^\$before\.(.+)$/.exec(v))) return { value: pick(read(m[1], item.value_args, before), item.value_field) };
    if ((m = /^\$baseline\.(.+)$/.exec(v))) return { value: pick(read(m[1], item.value_args, baseline), item.value_field) };
    if ((m = /^\$capture\.([^.]+)\.(.+)$/.exec(v))) return { value: pick(read(m[2], item.value_args, captures.get(m[1])), item.value_field) };
    if (v.startsWith('$earlier.')) return { skip: 'compares with the learner\'s earlier answer' };
    return { value: v };
  }

  function tolOf(item: CheckItem): number | undefined {
    const t = item.tolerance;
    if (typeof t === 'number') return t;
    if (typeof t === 'string') {
      const m = /^\$slot\.(.+)$/.exec(t);
      if (m) return Number(slots[m[1]]?.expect);
      const r = /^\$row\.([^.]+)\.(.+)$/.exec(t);
      if (r) return Number(pick(opts.rows?.get(r[1]), r[2]));
    }
    return undefined;
  }

  /** Evaluates one check item; undefined result = not evaluable. */
  function evalCheck(item: CheckItem): { ok?: boolean; got: unknown; want: unknown; skip?: string } {
    if (item.expect === 'learner') return { got: undefined, want: undefined, skip: 'learner-produced readout' };
    const cap = item.from !== undefined ? captures.get(item.from) : undefined;
    const got = pick(read(item.read, item.args, cap), item.field);
    const r = rhs(item);
    if (r.skip) return { got, want: undefined, skip: r.skip };
    const want = r.value;
    const tol = tolOf(item);
    // The runner's operators (runner/checks.ts), with this walker's tolerances: exact unless the
    // item names one; `contains` on records matches the fields `value` names, within the recorded tolerance.
    let ok: boolean;
    if (item.op === 'changed_from' && got === undefined) ok = false;
    else if (item.op === 'contains' && !(typeof got === 'string'))
      ok = Array.isArray(got)
        ? got.some((g) => deepEqual(g, want) || holdsFields(g, want, tol))
        : isObj(got) && isObj(want) && Object.entries(want).every(([k, w]) => deepEqual(got[k], w, tol));
    else ok = compareOp(item.op, got, want, tol ?? (item.op === 'within' ? 0 : 1e-9));
    if (item.not) ok = !ok;
    // A check's `expect` is the readout's recorded value (AUTHORING.md): the live
    // readout must match it too. `absent` = the readout has no value (a token
    // outside the top ten); a record matches on the fields `expect` names.
    if (ok && item.expect !== undefined && item.expect !== 'pending') {
      const e = item.expect;
      ok =
        e === 'absent'
          ? got === undefined
          : typeof e === 'number' && typeof got === 'number'
            ? Math.abs(got - e) <= (tol ?? Math.max(1e-3, Math.abs(e) * 1e-3))
            : isObj(e) && isObj(got)
              ? holdsFields(got, e, tol)
              : approxEqual(got, e, tol);
      if (!ok) return { ok, got, want: `${fmt(want)} (recorded ${fmt(e)})` };
    }
    return { ok, got, want };
  }

  const prompt = () => host.page.prompt;

  function checkSlot(name: string, where: string, done: Set<string>) {
    const key = `${where}|${name}`;
    if (done.has(key)) return;
    done.add(key);
    if (learnerGap && slots[name] && !slots[name].from_capture) {
      res.checks.push({ where, kind: 'slot', name, ok: true, skipped: learnerGap, detail: '', prompt: prompt() });
      return;
    }
    const slot = slots[name];
    if (!slot) return;
    for (const f of slot.from ?? []) checkSlot(f, where, done);
    if (slot.expect === undefined || slot.formula) return;
    if (slot.expect === 'learner' || slot.expect === 'pending') {
      res.checks.push({ where, kind: 'slot', name, ok: true, skipped: String(slot.expect), detail: `live ${fmt(slotValue(name, slots, src))}`, expect: slot.expect, prompt: prompt() });
      return;
    }
    const got = slotValue(name, slots, src);
    const want = slot.expect;
    const ok = typeof want === 'number' && typeof got === 'number' ? Math.abs(got - want) <= slotTolerance(want, slot) : approxEqual(got, want, slot.tolerance);
    res.checks.push({ where, kind: 'slot', name, ok, detail: `live ${fmt(got)}, expect ${fmt(want)}`, expect: want, prompt: prompt() });
  }

  const SLOT_RE = /\{([a-z_][a-z0-9_]*)\}/g;
  function slotsIn(texts: unknown[]): string[] {
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') {
        for (const m of v.matchAll(SLOT_RE)) if (m[1] in slots) out.push(m[1]);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (isObj(v)) Object.values(v).forEach(walk);
    };
    texts.forEach(walk);
    return out;
  }

  function runAsserts(list: AssertItem[] | undefined, where: string, done: Set<string>) {
    for (const a of list ?? []) {
      if (learnerGap) {
        res.checks.push({ where, kind: 'assert', name: a.require.slot, ok: true, skipped: learnerGap, detail: '', prompt: prompt() });
        continue;
      }
      for (const s of [a.require.slot, a.require.slot2].filter((x): x is string => !!x)) checkSlot(s, where, done);
      for (const s of slotsIn([a.say, a.else])) checkSlot(s, where, done);
      let fell = false;
      const line = evaluateAssert(a, slots, src, () => (fell = true));
      res.checks.push({
        where,
        kind: 'assert',
        name: `${a.require.slot} ${a.require.op} ${a.require.slot2 ?? fmt(a.require.value)}`,
        ok: !fell,
        detail: `live ${fmt(slotValue(a.require.slot, slots, src))}; shows "${line}"`,
        prompt: prompt(),
      });
    }
  }

  function runCheckItems(items: CheckItem | CheckItem[] | undefined, where: string) {
    const list = items === undefined ? [] : Array.isArray(items) ? items : [items];
    for (const item of list) {
      if (learnerGap) {
        res.checks.push({ where, kind: 'check', name: item.read, ok: true, skipped: learnerGap, detail: '', prompt: prompt(), check: item });
        continue;
      }
      const r = evalCheck(item);
      res.checks.push({
        where,
        kind: 'check',
        name: `${item.read}${item.field ? '.' + item.field : ''} ${item.not ? 'not ' : ''}${item.op} ${fmt(item.value)}`,
        ok: r.skip ? true : !!r.ok,
        skipped: r.skip,
        detail: `got ${fmt(r.got)}, want ${fmt(r.want)}`,
        prompt: prompt(),
        check: item,
      });
    }
  }

  /** Predict feedback is shown at the reveal: evaluated at the observe it `checks`, or at section end. */
  const pendingFeedback = new Map<string, { texts: unknown[]; scope: Record<string, Slot> }>();
  /** Checks feedback slots in the scope of the section that holds the predict. */
  function checkFeedback(fb: { texts: unknown[]; scope: Record<string, Slot> }, at: string, done: Set<string>) {
    const here = slots;
    slots = fb.scope;
    for (const s of slotsIn(fb.texts)) checkSlot(s, at, done);
    slots = here;
  }
  /**
   * Inside a transfer, a faded do step leaves Run to the learner (P1.3:5 "the
   * learner presses Run"). With no action that runs anything, the walk plays
   * the learner: the transfer's prompt in the box, then Run.
   */
  let learnerPrompt: string | undefined;
  /** Set after a learner task the walk can't play: later reads in its transfer or section are the learner's. */
  let learnerGap: string | undefined;
  /** Learner actions a task asks for, with the settings its prose tells the learner to use (P1.5:5 "sets temperature 0 and presses Write"). */
  const LEARNER_PLAY: Record<string, Record<string, unknown>> = { write_it: { temperature: 0 }, run: {} };
  const RUNS = ['run', 'ensure_run', 'run_compare', 'write_it', 'run_logit_lens', 'run_dla', 'run_head_ablation', 'run_patching', 'run_feature_ablation', 'run_steer', 'steer_across', 'run_circuit', 'show_embedding'];

  async function walkStep(step: Step, where: string, done: Set<string>) {
    const at = `${where}/${step.id ?? step.kind}`;
    const f = step.fields;
    if (f.when) {
      const w = evalCheck(f.when as CheckItem);
      if (!w.skip && !w.ok) return;
    }
    switch (step.kind) {
      case 'do': {
        // A do step's prose often reports what the run gives: its slots are read after the actions.
        before = read('result');
        for (const a of step.actions) {
          try {
            const r = await dispatcher.dispatch(a.name, a.args, { signal, bindings, fresh: f.fresh === true });
            if (r.status !== 'done') res.errors.push(`${at}: ${a.name} ${r.status}`);
          } catch (e) {
            res.errors.push(`${at}: ${a.name} threw ${String(e)}`);
          }
        }
        if (learnerPrompt !== undefined && !step.actions.some((a) => RUNS.includes(a.name))) {
          for (const [name, args] of [['set_prompt', { text: learnerPrompt }], ['run', {}]] as const) {
            const r = await dispatcher.dispatch(name, args, { signal, bindings });
            if (r.status !== 'done') res.errors.push(`${at}: learner ${name} ${r.status}`);
          }
        }
        if (typeof f.capture === 'string') captures.set(f.capture, read('result'));
        for (const s of slotsIn([step.prose.map((p) => p.text)])) checkSlot(s, at, done);
        break;
      }
      case 'observe':
        for (const s of slotsIn([step.prose.map((p) => p.text)])) checkSlot(s, at, done);
        runCheckItems(f.check, at);
        runAsserts(f.assert, at, done);
        if (step.id && pendingFeedback.has(step.id)) {
          checkFeedback(pendingFeedback.get(step.id)!, at, done);
          pendingFeedback.delete(step.id);
        }
        break;
      case 'predict':
        pendingFeedback.set(typeof f.checks === 'string' ? f.checks : `__end:${at}`, { texts: [f.choices], scope: slots });
        for (const s of slotsIn([step.prose.map((p) => p.text)])) checkSlot(s, at, done);
        break;
      case 'task': {
        // Learner-driven. When every learner action is one the walk can play the
        // way the task tells the learner to (LEARNER_PLAY), it plays them and checks
        // the target; otherwise the target is the learner's to reach.
        const acts = (f.learner_actions as string[] | undefined) ?? [];
        if (acts.length && acts.every((a) => a in LEARNER_PLAY)) {
          for (const a of acts) {
            const r = await dispatcher.dispatch(a, LEARNER_PLAY[a], { signal, bindings });
            if (r.status !== 'done') res.errors.push(`${at}: learner ${a} ${r.status}`);
          }
          runCheckItems(f.target, at);
          if (typeof f.capture === 'string') captures.set(f.capture, read('result'));
        } else if (acts.length) {
          // The learner's run decides what the rest of this transfer (or section) reads.
          learnerGap = `after task ${step.id ?? at}, which the walk can't play (${acts.join(', ')})`;
        }
        break;
      }
      default: {
        // Prose and fields (feedback, supports, leaves_open, ...); assert lines are checked by runAsserts.
        const { assert: _assert, ...rest } = f;
        for (const s of slotsIn([step.prose.map((p) => p.text), rest])) checkSlot(s, at, done);
        runAsserts(f.assert, at, done);
      }
    }
    const outer = learnerPrompt;
    if (step.kind === 'transfer') learnerPrompt = f.prompt as string;
    for (const c of step.children) await walkStep(c, at, done);
    learnerPrompt = outer;
    if (step.kind === 'transfer') learnerGap = undefined;
  }

  let state: unknown;
  for (const section of lesson.sections) {
    const where = section.id;
    const overlay = section.enter?.value as Record<string, unknown> | undefined;
    state = !state || overlay?.reset ? set.target(lesson.meta.baseline, overlay ?? {}) : set.target(lesson.meta.baseline, overlay ?? {}, state as any);
    try {
      await set.apply(state as any, ctx);
    } catch (e) {
      res.errors.push(`${where}: apply threw ${String(e)}`);
    }
    if (baseline === undefined) baseline = read('result');
    slots = { ...(lesson.meta.slots ?? {}), ...(section.slots ?? {}) };
    learnerGap = undefined;
    const done = new Set<string>();
    for (const step of section.steps) await walkStep(step, where, done);
    for (const [k, fb] of pendingFeedback) {
      // A predict whose reveal is an observe in a later section waits for it.
      if (!k.startsWith('__end:')) continue;
      checkFeedback(fb, `${where}/feedback`, done);
      pendingFeedback.delete(k);
    }
    state = set.snapshot();
  }
  for (const fb of pendingFeedback.values()) checkFeedback(fb, 'end/feedback', new Set());
  globalThis.fetch = realFetch;
  return res;
}
