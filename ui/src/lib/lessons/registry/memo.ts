// Runner-issued request memo (plan T2 "Memo", C3-1).
//
// Used only for runner-issued calls: `apply` (scene and cumulative replay) and
// lesson do steps, through the dispatcher. Learner-pressed Run / Write / any
// panel button and every call with Lessons off go straight through sidecar.ts,
// which has no cache.
//
// Key = request key + model_revision (when known) + memoContext().
// LRU, 64 entries or 256 MB. Cleared on model load. Unseeded sampling
// (temperature > 0 and no seed) is never memoised. A `fresh` call bypasses the
// lookup and stores its new result.

import { requestKey, type KeyedRequest } from './request-key';

export const MEMO_MAX_ENTRIES = 64;
export const MEMO_MAX_BYTES = 256 * 1024 * 1024;

export function memoKey(reqKey: string, modelRevision: string | null | undefined, memoContext: string): string {
  return JSON.stringify([reqKey, modelRevision ?? null, memoContext]);
}

/** temperature > 0 with no seed: every call should differ, so never memoised. */
export function isUnseededSampling(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.temperature === 'number' && b.temperature > 0 && (b.seed === undefined || b.seed === null);
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}

export interface MemoOptions {
  maxEntries?: number;
  maxBytes?: number;
  /** Size of a stored value in bytes (default: UTF-8 length of its JSON). */
  sizeOf?: (value: unknown) => number;
}

export interface MemoCall extends KeyedRequest {
  modelRevision?: string | null;
  memoContext: string;
  /** A `fresh: true` do step pressed by the learner: skip the lookup, store the result. */
  fresh?: boolean;
}

export class RequestMemo {
  readonly maxEntries: number;
  readonly maxBytes: number;
  private readonly sizeOf: (value: unknown) => number;
  private readonly entries = new Map<string, { value: unknown; bytes: number }>();
  private total = 0;

  constructor(opts: MemoOptions = {}) {
    this.maxEntries = opts.maxEntries ?? MEMO_MAX_ENTRIES;
    this.maxBytes = opts.maxBytes ?? MEMO_MAX_BYTES;
    this.sizeOf = opts.sizeOf ?? jsonBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.total;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): unknown | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: unknown): void {
    const bytes = this.sizeOf(value);
    this.delete(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.total += bytes;
    while (this.entries.size > this.maxEntries || this.total > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string;
      this.delete(oldest);
    }
  }

  delete(key: string): void {
    const hit = this.entries.get(key);
    if (!hit) return;
    this.entries.delete(key);
    this.total -= hit.bytes;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  /** Call on every model load: memoised results belong to the old weights. */
  onModelLoad(): void {
    this.clear();
  }

  /** Runs a runner-issued call through the memo. */
  async call<T>(req: MemoCall, fetcher: () => Promise<T>): Promise<T> {
    if (isUnseededSampling(req.body)) return fetcher();
    const key = memoKey(await requestKey(req), req.modelRevision, req.memoContext);
    if (!req.fresh && this.entries.has(key)) return this.get(key) as T;
    const value = await fetcher();
    this.set(key, value);
    return value;
  }
}
