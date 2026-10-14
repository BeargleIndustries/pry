// The dispatcher (plan T2b): every action a lesson runs goes through here.
// Tool-neutral: it takes any ToolActionSet.
//
// - Arguments are checked against the action's schema.
// - A link (`url` argument on an `external` action) must be http or https, in
//   every lesson.
// - User lessons: a gated effect (download, network, external, cost) runs only
//   when the learner granted that effect + scope at install (grants.ts). An
//   `external` scope is a host and matches a granted host exactly or as a
//   subdomain, after lower-casing and IDNA normalisation (`evilarxiv.org`
//   never matches `arxiv.org`): T1's lint rule, repeated at run time.
//   Bundled lessons are trusted and skip grants.
// - Replay (the section fold) runs only view and compute actions.
// - Runner-issued calls go through the memo: the dispatcher hands each action
//   a `call` that looks its sidecar request up first. Calls made outside the
//   dispatcher (the learner's own buttons, everything with Lessons off) never
//   see the memo.

import { FREE_EFFECTS, type ActionContext, type Effect, type ToolActionSet } from './contract';
import type { RequestMemo } from './memo';
import type { KeyedRequest } from './request-key';
import { grantStatus, type GrantStore, type LessonManifest } from '../grants';
import { hostMatches } from '../format/lint';

/** Runs one runner-issued request through the memo. */
export type MemoCaller = <T>(
  req: KeyedRequest & { modelRevision?: string | null },
  fetcher: () => Promise<T>,
) => Promise<T>;

/** What an action's `run` receives from the dispatcher. */
export interface RunnerActionContext extends ActionContext {
  /** Present on runner-issued calls: send sidecar requests through the memo. */
  call?: MemoCaller;
}

export type LessonSource =
  | { kind: 'bundled' }
  | { kind: 'user'; manifest: LessonManifest; grants: () => GrantStore };

/** Where `$earlier` and `$row` argument bindings get their values. */
export interface BindingSources {
  /** The learner's recorded answer for a `remember` key; undefined when skipped. */
  earlier(key: string): unknown | undefined;
  /** A constant from rows.json (`$row.<id>.<field>`). */
  row(id: string, field: string): unknown | undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Replaces `{ $earlier: key, fallback }` with the learner's answer (or the
 * fallback when they skipped), `"$earlier.key"` with the answer, and
 * `"$row.<id>.<field>"` with the rows.json constant.
 */
export function resolveBindings(v: unknown, src: BindingSources): unknown {
  if (typeof v === 'string') {
    const e = /^\$earlier\.(.+)$/.exec(v);
    if (e) return src.earlier(e[1]);
    const r = /^\$row\.([^.]+)\.(.+)$/.exec(v);
    if (r) return src.row(r[1], r[2]);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => resolveBindings(x, src));
  if (isObj(v)) {
    if (typeof v.$earlier === 'string') {
      const got = src.earlier(v.$earlier.replace(/^\$earlier\./, ''));
      return got === undefined ? v.fallback : got;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveBindings(x, src)]));
  }
  return v;
}

export interface DispatchOptions {
  signal: AbortSignal;
  /** Resolves `$earlier` / `$row` arguments; without it they pass through unresolved. */
  bindings?: BindingSources;
  wait?(msg: string): void;
  /** The section fold replaying earlier do steps: only view and compute run. */
  replay?: boolean;
  /** A `fresh: true` do step the learner pressed: skip the memo lookup, store the new result. */
  fresh?: boolean;
}

export type DispatchResult =
  | { status: 'done' }
  | { status: 'skipped'; reason: 'replay' }
  | { status: 'blocked'; reason: 'scheme' | 'grant'; effect: Effect; scope: string }
  | { status: 'aborted' };

export class DispatchError extends Error {}

function isGranted(source: LessonSource, effect: Effect, scope: string): boolean {
  if (source.kind === 'bundled' || FREE_EFFECTS.includes(effect)) return true;
  const granted = grantStatus(source.grants(), source.manifest).granted;
  const list = (granted as Record<string, string[] | undefined>)[effect] ?? [];
  return effect === 'external' ? list.some((h) => hostMatches(scope, h)) : list.includes(scope);
}

function linkSchemeOk(args: unknown): boolean {
  const url = (args as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return true;
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

export function createDispatcher(set: ToolActionSet<any>, memo: RequestMemo, source: LessonSource) {
  return {
    /** Runs one action. Throws DispatchError for an unknown action or bad arguments. */
    async dispatch(name: string, args: unknown, opts: DispatchOptions): Promise<DispatchResult> {
      const action = set.actions[name];
      if (!action) throw new DispatchError(`Unknown action: ${name}`);
      const resolved = opts.bindings ? resolveBindings(args ?? {}, opts.bindings) : (args ?? {});
      const parsed = action.args.safeParse(resolved);
      if (!parsed.success) throw new DispatchError(`Bad arguments for ${name}: ${parsed.error.message}`);
      const a = parsed.data;
      if (opts.replay && !FREE_EFFECTS.includes(action.effect)) return { status: 'skipped', reason: 'replay' };
      const scope = action.scope ? action.scope(a) : '';
      if (action.effect === 'external' && !linkSchemeOk(a)) {
        return { status: 'blocked', reason: 'scheme', effect: action.effect, scope };
      }
      if (!isGranted(source, action.effect, scope)) {
        return { status: 'blocked', reason: 'grant', effect: action.effect, scope };
      }
      if (opts.signal.aborted) return { status: 'aborted' };
      const ctx: RunnerActionContext = {
        signal: opts.signal,
        wait: opts.wait ?? (() => {}),
        call: (req, fetcher) => memo.call({ ...req, memoContext: set.memoContext(), fresh: opts.fresh }, fetcher),
      };
      await action.run(a, ctx);
      return { status: 'done' };
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
