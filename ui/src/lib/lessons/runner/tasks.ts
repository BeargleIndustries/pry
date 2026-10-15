// Task rules (plan T1 `task`, T3 "task rules are enforced by the runner";
// critic C5-1). A task has `target` and `constraint` check lists plus runner
// rules from a fixed set:
//   max_runs: n               - the learner's runs are counted; run n+1 is refused
//   predict_before_each_run   - each run needs a fresh prediction first
//   one_change: <action>      - between runs exactly one argument value of that
//                               action changes (set_compare: one word of one
//                               prompt, read from compare.word_diff_count on
//                               the learner's next prompts)
// The one_change rule and constraint items on readouts marked `state` (the
// learner's settings, e.g. ablation.head_count) are checked before each
// learner run, refusing it like max_runs and predict_before_each_run. Every
// constraint item is checked again after the run (items reading results only
// mean something there) and on demand. `remember` writes on target met or on
// leaving; `capture` stores the learner's last run the same way.

import type { CheckItem } from '../format/schema';
import type { ToolActionSet } from '../registry/contract';
import { lessonsCopy } from '../copy';
import { evaluateCheck, itemWords, type CheckEnv, type CheckOutcome } from './checks';

export interface TaskFields {
  target: CheckItem[];
  constraint?: CheckItem[];
  max_runs?: number;
  predict_before_each_run?: boolean;
  one_change?: string;
  learner_actions?: string[];
  capture?: string;
  reset?: unknown;
  remember?: { key: string; read: string; args?: Record<string, unknown> };
}

export interface TaskState {
  runs: number;
  /** The prediction written for the next run ('' = none yet). */
  prediction: string;
  /** one_change: the arguments the learner has typed for the next run. */
  pendingArgs: Record<string, unknown> | null;
  /** one_change: the arguments of the last run. */
  lastArgs: Record<string, unknown> | null;
  met: boolean;
  message: string | null;
  /** Set once remember / capture were written for this visit. */
  stored: boolean;
}

export function newTaskState(): TaskState {
  return { runs: 0, prediction: '', pendingArgs: null, lastArgs: null, met: false, message: null, stored: false };
}

export type Refusal = { ok: false; reason: 'max-runs' | 'predict' | 'one-change' | 'constraint'; message: string; outcome?: CheckOutcome };
export type RunGate = { ok: true } | Refusal;

/** Words in a string value that differ position by position (one_change on text). */
export function wordChanges(a: unknown, b: unknown): number {
  if (typeof a !== 'string' || typeof b !== 'string') return JSON.stringify(a) === JSON.stringify(b) ? 0 : 1;
  const wa = a.trim().split(/\s+/).filter(Boolean);
  const wb = b.trim().split(/\s+/).filter(Boolean);
  let d = 0;
  for (let i = 0; i < Math.max(wa.length, wb.length); i++) if (wa[i] !== wb[i]) d++;
  return d;
}

/** How many argument values changed between two runs of the one_change action. */
export function argChanges(prev: Record<string, unknown> | null, next: Record<string, unknown> | null): number {
  if (!prev || !next) return 0;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  let n = 0;
  for (const k of keys) if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) n++;
  return n;
}

/** Checks a constraint list; the first item that doesn't hold, or null. Missing readouts don't refuse. */
export function failingConstraint(items: CheckItem[] | undefined, env: CheckEnv): CheckOutcome | null {
  for (const it of items ?? []) {
    const o = evaluateCheck(it, env);
    if (o.agrees === false) return o;
  }
  return null;
}

/**
 * one_change actions whose rule is a readout of the learner's next arguments
 * (plan: `set_compare` is one word of one prompt, read from compare.word_diff_count).
 */
const ONE_CHANGE_READOUT: Record<string, { read: string; of(args: Record<string, unknown>): number }> = {
  set_compare: { read: 'compare.word_diff_count', of: (a) => wordChanges(a.a, a.b) },
};

/** May the learner make the next run? (C5-1: the one_change rule and settings constraints checked before each run.) */
export function gateRun(task: TaskFields, st: TaskState, env: CheckEnv, set: Pick<ToolActionSet<unknown>, 'readouts'>): RunGate {
  if (task.max_runs !== undefined && st.runs >= task.max_runs) {
    return { ok: false, reason: 'max-runs', message: lessonsCopy.noRunsLeft(task.max_runs) };
  }
  if (task.predict_before_each_run && !st.prediction.trim()) {
    return { ok: false, reason: 'predict', message: lessonsCopy.predictFirst };
  }
  const refuse = (o: CheckOutcome): Refusal => ({ ok: false, reason: 'constraint', message: lessonsCopy.constraintFails(itemWords(o.item, set)), outcome: o });
  const spec = task.one_change ? ONE_CHANGE_READOUT[task.one_change] : undefined;
  if (spec) {
    const next = spec.of(st.pendingArgs ?? {});
    const item = (task.constraint ?? []).find((it) => it.read === spec.read && !it.from);
    if (item) {
      const o = evaluateCheck(item, { ...env, read: (r, a, from) => (r === spec.read && !from ? next : env.read(r, a, from)) });
      if (o.agrees === false) return refuse(o);
    } else if (next !== 1) {
      return { ok: false, reason: 'one-change', message: lessonsCopy.oneChange };
    }
  } else if (task.one_change && st.lastArgs && argChanges(st.lastArgs, st.pendingArgs ?? st.lastArgs) !== 1) {
    return { ok: false, reason: 'one-change', message: lessonsCopy.oneChange };
  }
  const bad = failingConstraint((task.constraint ?? []).filter((it) => set.readouts[it.read]?.state), env);
  return bad ? refuse(bad) : { ok: true };
}

/** After a run, or on demand: constraint list, then target. */
export function judgeTask(
  task: TaskFields,
  env: CheckEnv,
  set: Pick<ToolActionSet<unknown>, 'readouts'>,
): { met: boolean; message: string; outcome: CheckOutcome | null } {
  const bad = failingConstraint(task.constraint, env);
  if (bad) return { met: false, message: lessonsCopy.constraintFails(itemWords(bad.item, set)), outcome: bad };
  for (const it of task.target) {
    const o = evaluateCheck(it, env);
    if (o.agrees !== true) return { met: false, message: lessonsCopy.targetNotMet, outcome: o };
  }
  return { met: true, message: lessonsCopy.targetMet, outcome: null };
}

/**
 * The actions "Run it" dispatches: the one_change action with the learner's
 * arguments, then the task's compute `learner_actions` in order. With none
 * listed, the one_change action's run partner (`set_x` -> `run_x`) or, for a
 * task that names no learner_actions at all, the generic `run`. Empty when
 * the task is done with the app's own controls.
 */
export function runActions(
  task: TaskFields,
  set: Pick<ToolActionSet<unknown>, 'actions'>,
  pendingArgs: Record<string, unknown> | null,
): { name: string; args: Record<string, unknown> }[] {
  const out: { name: string; args: Record<string, unknown> }[] = [];
  if (task.one_change && pendingArgs) out.push({ name: task.one_change, args: pendingArgs });
  // An action that needs arguments only the app's own controls give (write_it's
  // temperature, run_patching's two prompts) can't be sent from "Run it"; nor can
  // a view action (clicking a cell). Such a task is done in the app.
  const sendable = (n: string) => !set.actions[n].args || set.actions[n].args.safeParse({}).success;
  const listed = (task.learner_actions ?? []).filter((n) => set.actions[n] && set.actions[n].effect !== 'view');
  const compute = listed.filter(sendable);
  if (compute.length) for (const n of compute) out.push({ name: n, args: {} });
  else if (task.one_change && set.actions[task.one_change.replace(/^set_/, 'run_')]) out.push({ name: task.one_change.replace(/^set_/, 'run_'), args: {} });
  else if (!task.learner_actions?.length && set.actions.run) out.push({ name: 'run', args: {} });
  return out;
}
