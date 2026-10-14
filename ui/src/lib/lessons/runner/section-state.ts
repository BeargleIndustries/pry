// Section state and Back semantics (plan "Section state and Back semantics",
// D9, R4-1, C4-1, R5-5). Entering section N folds the path section by section,
// setup then steps, over every section (optional and test-out-skipped ones
// too), so the state depends only on N and the journal:
//
//   s = target(baseline, {})
//   for k = 1..N:
//     if enter_k.reset: s = target(baseline, {})
//     s = target(baseline, enter_k, s); apply(s)
//     if k < N: replay do_k (its actions in order); s = snapshot()
//
// A later section's `enter` always beats an earlier do step; nothing before a
// `reset: true` replays; a section with no `enter` opens on the previous
// section's after-do state. Replay runs only view and compute actions (the
// dispatcher skips the rest), with one exception: a replayed `switch_model` to
// the model already loaded is a no-op, and to any other model the fold stops
// and the model banner shows, so later compute steps never run on the wrong
// model. Replayed requests go through the memo. A replayed `fresh` step uses
// its seeded request through the memo; no replayed step stores a capture.
//
// Overlay lessons (the quick tour) have no baseline: a section applies only
// its own `enter` delta on top of snapshot() and never resets anything.

import type { Lesson, Section, Step } from '../format/schema';
import type { ActionContext, ToolActionSet } from '../registry/contract';
import type { RequestMemo } from '../registry/memo';
import { resolveBindings, type BindingSources, type Dispatcher, type RunnerActionContext } from '../registry/dispatcher';
import { allSteps } from '../format/normalise';
import type { CaptureStore } from './captures';

export interface FoldDeps<VS> {
  set: ToolActionSet<VS>;
  dispatcher: Dispatcher;
  memo: RequestMemo;
  bindings: BindingSources;
  captures: CaptureStore;
  /** The model the tool holds now (switch_model replay). */
  currentModel(): string | null;
  /** Shows a waiting message (the runner shows it only past 300ms). */
  wait?(msg: string): void;
  /** True when a step's `when` holds now (steps without one always hold). */
  when?(step: Step): boolean;
  /** Called with the scene right after the first section's setup (the `$baseline` reading). */
  onBaseline?(): void;
  /** Debug builds: reconcile snapshot() after each replayed step and log any that isn't idempotent. */
  debug?: boolean;
  log?(msg: string, step?: Step): void;
}

export type FoldResult<VS> =
  | { status: 'done'; state: VS }
  | { status: 'aborted' }
  | { status: 'model'; model: string; section: number }
  | { status: 'error'; error: unknown; section: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An `apply` context whose sidecar calls go through the runner memo. */
export function applyContext(set: ToolActionSet<unknown>, memo: RequestMemo, signal: AbortSignal, wait?: (m: string) => void): ActionContext {
  const ctx: RunnerActionContext = {
    signal,
    wait: wait ?? (() => {}),
    call: (req, fetcher) => memo.call({ ...req, memoContext: set.memoContext() }, fetcher),
  };
  return ctx;
}

/** The do steps of one section, in document order (inside folds and transfers too). */
export function doSteps(section: Section): Step[] {
  return allSteps(section.steps).filter((s) => s.kind === 'do');
}

function enterOf(section: Section, bindings: BindingSources): { overlay: Record<string, unknown>; reset: boolean } {
  const raw = section.enter?.value ?? {};
  const { reset, ...rest } = raw as Record<string, unknown>;
  const overlay = resolveBindings(rest, bindings);
  return { overlay: isObj(overlay) ? overlay : {}, reset: reset === true };
}

function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

/** Replays one do step's actions (view and compute only). */
export async function replayStep<VS>(step: Step, deps: FoldDeps<VS>, signal: AbortSignal): Promise<'done' | 'aborted' | { model: string }> {
  for (const a of step.actions) {
    if (a.name === 'switch_model' || deps.set.actions[a.name] === deps.set.actions.switch_model) {
      const args = resolveBindings(a.args, deps.bindings) as { preset?: string };
      if (args?.preset && args.preset === deps.currentModel()) continue; // already loaded: a no-op
      return { model: String(args?.preset ?? '') };
    }
    try {
      const r = await deps.dispatcher.dispatch(a.name, a.args, { signal, bindings: deps.bindings, replay: true, wait: deps.wait });
      if (r.status === 'aborted') return 'aborted';
    } catch (e) {
      if (isAbort(e) || aborted(signal)) return 'aborted';
      // One action that can't replay (a token this run doesn't have) doesn't stop the section.
      deps.log?.(`replay of ${a.name} failed: ${e instanceof Error ? e.message : String(e)}`, step);
    }
    if (aborted(signal)) return 'aborted';
  }
  // A replayed result is never stored as a capture: captures come only from
  // the learner's own "Do it" (kept in runner state and the journal, and read
  // back on every later visit). Storing one here would make a section look
  // different on Back than it did going forward.
  return 'done';
}

/** Folds the path to section `n` (1-based) and drives the tool there. */
export async function foldTo<VS>(lesson: Lesson, n: number, deps: FoldDeps<VS>, signal: AbortSignal): Promise<FoldResult<VS>> {
  const { set } = deps;
  const baseline = lesson.meta.baseline ?? {};
  const ctx = applyContext(set as ToolActionSet<unknown>, deps.memo, signal, deps.wait);
  const overlayLesson = lesson.meta.presentation === 'overlay';
  try {
    if (overlayLesson) {
      // The tour: this section's delta on top of the app as it is.
      const sec = lesson.sections[n - 1];
      const { overlay } = enterOf(sec, deps.bindings);
      const s = set.target(undefined, overlay, set.snapshot());
      await set.apply(s, ctx);
      return aborted(signal) ? { status: 'aborted' } : { status: 'done', state: s };
    }
    let s = set.target(baseline, {});
    for (let k = 1; k <= n; k++) {
      const sec = lesson.sections[k - 1];
      const { overlay, reset } = enterOf(sec, deps.bindings);
      if (reset) s = set.target(baseline, {});
      s = set.target(baseline, overlay, s);
      await set.apply(s, ctx);
      if (aborted(signal)) return { status: 'aborted' };
      if (k === 1) deps.onBaseline?.();
      if (k < n) {
        for (const step of doSteps(sec)) {
          if (deps.when && !deps.when(step)) continue;
          const r = await replayStep(step, deps, signal);
          if (r === 'aborted') return { status: 'aborted' };
          if (typeof r === 'object') return { status: 'model', model: r.model, section: k };
          if (deps.debug) {
            const once = JSON.stringify(set.snapshot());
            await replayStep(step, deps, signal);
            if (once !== JSON.stringify(set.snapshot())) deps.log?.(`replay of step ${step.id ?? `line ${step.line}`} isn't idempotent`, step);
          }
        }
        s = set.snapshot();
      }
    }
    return { status: 'done', state: s };
  } catch (e) {
    if (isAbort(e) || aborted(signal)) return { status: 'aborted' };
    return { status: 'error', error: e, section: 0 };
  }
}
