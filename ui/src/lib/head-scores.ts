// Induction-heads demo (T20): pure helpers for the "Find copying heads" view
// in PanelA. Plain TS so vitest can run it without the Svelte compiler.
import type { HeadScore, HeadScoresResponse } from './types';

export type HeadKind = 'induction' | 'previous';

/** Plain labels shown next to ringed heads. */
export const HEAD_KIND_LABEL: Record<HeadKind, string> = {
  induction: 'copies what came next last time',
  previous: 'looks at the previous word',
};

/**
 * A head is ringed only if, on average, at least half its attention went to
 * the word its job predicts. Keeps weak "best of a bad lot" heads unringed on
 * models that don't have strong ones.
 */
export const RING_MIN_SCORE = 0.5;

export function headKey(layer: number, head: number): string {
  return `${layer}.${head}`;
}

export function scoreOf(s: HeadScore, kind: HeadKind): number {
  return kind === 'induction' ? s.induction : s.previous_token;
}

/**
 * Heads to ring in the grid, keyed by `headKey`. Taken from the sidecar's top
 * lists, so at most `top_k` of each kind. A head that qualifies as both is
 * shown as a copying head.
 */
export function ringedHeads(resp: HeadScoresResponse | null): Map<string, HeadKind> {
  const rings = new Map<string, HeadKind>();
  if (!resp) return rings;
  for (const s of resp.top_induction) {
    if (s.induction >= RING_MIN_SCORE) rings.set(headKey(s.layer, s.head), 'induction');
  }
  for (const s of resp.top_previous_token) {
    const key = headKey(s.layer, s.head);
    if (s.previous_token >= RING_MIN_SCORE && !rings.has(key)) rings.set(key, 'previous');
  }
  return rings;
}

/** The ringed heads of one kind, highest score first. */
export function ringedList(resp: HeadScoresResponse | null, kind: HeadKind): HeadScore[] {
  if (!resp) return [];
  const rings = ringedHeads(resp);
  const top = kind === 'induction' ? resp.top_induction : resp.top_previous_token;
  return top.filter((s) => rings.get(headKey(s.layer, s.head)) === kind);
}

/** n_layers x n_heads grid of one score (0 where a head is missing). */
export function scoreGrid(resp: HeadScoresResponse, kind: HeadKind): number[][] {
  const grid = Array.from({ length: resp.n_layers }, () => new Array<number>(resp.n_heads).fill(0));
  for (const s of resp.scores) {
    if (s.layer < resp.n_layers && s.head < resp.n_heads) grid[s.layer][s.head] = scoreOf(s, kind);
  }
  return grid;
}

export function scorePercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** The test sequence's two copies (they are identical by construction). */
export function splitRepeat(resp: HeadScoresResponse): { first: string[]; second: string[] } {
  const n = resp.repeat_len;
  return {
    first: resp.sequence_tokens.slice(0, n),
    second: resp.sequence_tokens.slice(n, 2 * n),
  };
}

export type DemoParam = 'tour' | 'induction-heads';

/** The `?demo=` value the main page understands, or null. */
export function demoFromParams(params: URLSearchParams): DemoParam | null {
  const d = params.get('demo');
  return d === 'tour' || d === 'induction-heads' ? d : null;
}
