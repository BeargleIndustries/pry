// Compare mode (T25): pure diff functions for two runs of the same model on two
// prompts ("A" and "B"). No fetching here; see compare-run.ts.
//
// Honesty rules (same spirit as readouts.ts):
// - The sidecar only returns the top 10 next-word guesses and the top-k features
//   per word. A word or feature missing from one list is not "zero" there, only
//   "below that list's cutoff". Changes that rely on a cutoff are marked
//   `approximate` and are the smallest change the data allows ("at least").
// - A difference between the two runs goes along with the prompt change. It is
//   not proof of what causes the model's answer. Never say "because" or "causes".
import type { FeatureHit, GenerateResponse, TokenFeatures, TopPrediction } from './types';
import { isNamedFeature } from './feature-label';
import { pct, quoteToken } from './readouts';

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export interface PredictionChange {
  token: string;
  /** Probability under prompt A; null when the word isn't in A's top list. */
  probA: number | null;
  /** Probability under prompt B; null when the word isn't in B's top list. */
  probB: number | null;
  /**
   * B minus A (0–1 scale). When one side is missing, that side is bounded by its
   * list's lowest probability, and this is the smallest change consistent with
   * that bound (0 when the sign is unknown).
   */
  change: number;
  /** True when `change` relies on a cutoff bound ("at least this much"). */
  approximate: boolean;
}

export interface PredictionDiff {
  /** Every word in either list, biggest |change| first. */
  rows: PredictionChange[];
  /** Words that gained probability under B, biggest first. */
  gained: PredictionChange[];
  /** Words that lost probability under B, biggest loss first. */
  lost: PredictionChange[];
  topA: TopPrediction | null;
  topB: TopPrediction | null;
  /** Lowest listed probability on each side (0 when the list is empty). */
  cutoffA: number;
  cutoffB: number;
}

function cutoff(values: number[]): number {
  return values.length ? Math.min(...values) : 0;
}

function byRank(list: TopPrediction[] | undefined | null): TopPrediction[] {
  return [...(list ?? [])].sort((x, y) => x.rank - y.rank);
}

export function diffPredictions(
  a: TopPrediction[] | undefined | null,
  b: TopPrediction[] | undefined | null,
): PredictionDiff {
  const listA = byRank(a);
  const listB = byRank(b);
  const cutoffA = cutoff(listA.map((p) => p.probability));
  const cutoffB = cutoff(listB.map((p) => p.probability));
  const mapA = new Map(listA.map((p) => [p.token, p.probability]));
  const mapB = new Map(listB.map((p) => [p.token, p.probability]));

  const tokens = [...new Set([...listA.map((p) => p.token), ...listB.map((p) => p.token)])];
  const rows: PredictionChange[] = tokens.map((token) => {
    const probA = mapA.get(token) ?? null;
    const probB = mapB.get(token) ?? null;
    if (probA !== null && probB !== null) {
      return { token, probA, probB, change: probB - probA, approximate: false };
    }
    if (probA !== null) {
      // B's probability is somewhere in [0, cutoffB].
      return { token, probA, probB, change: Math.min(0, cutoffB - probA), approximate: true };
    }
    // A's probability is somewhere in [0, cutoffA].
    return { token, probA, probB, change: Math.max(0, (probB as number) - cutoffA), approximate: true };
  });
  rows.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));

  return {
    rows,
    gained: rows.filter((r) => r.change > 0),
    lost: rows.filter((r) => r.change < 0),
    topA: listA[0] ?? null,
    topB: listB[0] ?? null,
    cutoffA,
    cutoffB,
  };
}

/** A change on the 0–1 scale as signed percentage points: "+30 pts", "−4 pts", "<1 pt". */
export function points(change: number): string {
  const r = Math.round(Math.abs(change) * 100);
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  if (r === 0) return change === 0 ? '0 pts' : `${sign}<1 pt`;
  return `${sign}${r} pt${r === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// SAE features
// ---------------------------------------------------------------------------

export interface FeatureChange {
  id: number;
  /** The hit used for the label (A's if present, else B's). */
  hit: FeatureHit;
  /** Activation under A; null when the feature isn't in A's top-k on this word. */
  actA: number | null;
  actB: number | null;
  /** B minus A; only set when the feature is in both lists. */
  change: number | null;
}

export interface FeatureDiff {
  /** In A's top-k but not B's, strongest first. */
  onlyA: FeatureChange[];
  /** In B's top-k but not A's, strongest first. */
  onlyB: FeatureChange[];
  /** In both lists, biggest |change| first. */
  both: FeatureChange[];
  /** Lowest listed activation on each side: a missing feature is at most this. */
  cutoffA: number;
  cutoffB: number;
  /** How many features each side listed (the "top k"). */
  listedA: number;
  listedB: number;
}

/**
 * Feature differences on one word. The two lists must come from the same SAE
 * layer: feature ids mean different things on different layers.
 */
export function diffFeatures(a: TokenFeatures | null | undefined, b: TokenFeatures | null | undefined): FeatureDiff {
  // A feature with activation 0 isn't active; drop it so it can't show up as "only in A".
  const hitsA = (a?.top_k ?? []).filter((h) => h.activation > 0);
  const hitsB = (b?.top_k ?? []).filter((h) => h.activation > 0);
  const mapA = new Map(hitsA.map((h) => [h.id, h]));
  const mapB = new Map(hitsB.map((h) => [h.id, h]));

  const onlyA: FeatureChange[] = [];
  const onlyB: FeatureChange[] = [];
  const both: FeatureChange[] = [];
  for (const h of hitsA) {
    const other = mapB.get(h.id);
    if (other) {
      both.push({ id: h.id, hit: h, actA: h.activation, actB: other.activation, change: other.activation - h.activation });
    } else {
      onlyA.push({ id: h.id, hit: h, actA: h.activation, actB: null, change: null });
    }
  }
  for (const h of hitsB) {
    if (!mapA.has(h.id)) onlyB.push({ id: h.id, hit: h, actA: null, actB: h.activation, change: null });
  }
  onlyA.sort((x, y) => (y.actA ?? 0) - (x.actA ?? 0));
  onlyB.sort((x, y) => (y.actB ?? 0) - (x.actB ?? 0));
  both.sort((x, y) => Math.abs(y.change ?? 0) - Math.abs(x.change ?? 0));

  return {
    onlyA,
    onlyB,
    both,
    cutoffA: cutoff(hitsA.map((h) => h.activation)),
    cutoffB: cutoff(hitsB.map((h) => h.activation)),
    listedA: a?.top_k.length ?? 0,
    listedB: b?.top_k.length ?? 0,
  };
}

/** `#123 ("female pronouns")` or `#123 (no label yet)`, as in readouts.ts. */
export function featureName(hit: FeatureHit): string {
  const label = hit.description?.trim();
  return isNamedFeature(hit) && label ? `#${hit.id} ("${label}")` : `#${hit.id} (no label yet)`;
}

// ---------------------------------------------------------------------------
// Aligned positions
// ---------------------------------------------------------------------------

export interface AlignedPosition {
  posA: number;
  posB: number;
  label: string;
}

/**
 * Word positions that can be compared. Always the last word of each prompt.
 * When both prompts have the same number of tokens, every position lines up,
 * so each one is offered too (same index in both).
 */
export function alignedPositions(a: GenerateResponse, b: GenerateResponse): AlignedPosition[] {
  const nA = a.tokens.length;
  const nB = b.tokens.length;
  if (nA === 0 || nB === 0) return [];
  const words = (tA: string, tB: string) => (tA === tB ? quoteToken(tA) : `${quoteToken(tA)} / ${quoteToken(tB)}`);
  if (nA !== nB) {
    return [{ posA: nA - 1, posB: nB - 1, label: `last word: ${words(a.tokens[nA - 1].text, b.tokens[nB - 1].text)}` }];
  }
  const out: AlignedPosition[] = [];
  for (let i = nA - 1; i >= 0; i--) {
    const w = words(a.tokens[i].text, b.tokens[i].text);
    out.push({ posA: i, posB: i, label: i === nA - 1 ? `last word: ${w}` : `word ${i + 1}: ${w}` });
  }
  return out;
}

/** The feature row for an array position (matched by token_index, falling back to array order). */
export function featuresAt(resp: GenerateResponse, pos: number): TokenFeatures | null {
  const tokenIndex = resp.tokens[pos]?.index;
  return (
    resp.sae_features.find((f) => f.token_index === tokenIndex) ??
    resp.sae_features[pos] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Attention: per-head delta for one word
// ---------------------------------------------------------------------------

/**
 * - `positions`: same token count. Per head, the total variation distance between
 *   the word's two attention rows, key position by key position:
 *   0.5 × Σ|a_k − b_k|. 0 = identical, 1 = no overlap.
 * - `buckets`: token counts differ, so key positions don't line up. Each row is
 *   reduced to three shares that exist in any prompt: the first token, the
 *   words in between, and the word itself. The distance is the same formula
 *   over those three shares. Coarser: it can miss changes inside "in between".
 */
export type AttentionCompareMode = 'positions' | 'buckets';

export interface HeadDelta {
  layer: number;
  head: number;
  /** Total variation distance, 0–1. */
  distance: number;
}

export type AttentionDiff =
  | {
      ok: true;
      mode: AttentionCompareMode;
      /** grid[layer][head] = distance */
      grid: number[][];
      /** Every head, biggest distance first. */
      ranked: HeadDelta[];
      mean: number;
      nLayers: number;
      nHeads: number;
    }
  | { ok: false; reason: string };

function tvd(p: number[], q: number[]): number {
  let s = 0;
  const n = Math.max(p.length, q.length);
  for (let k = 0; k < n; k++) s += Math.abs((p[k] ?? 0) - (q[k] ?? 0));
  return Math.min(1, s / 2);
}

/** [first token, in between, itself] shares of one attention row for the word at `pos`. */
export function attentionBuckets(row: number[], pos: number): [number, number, number] {
  if (pos === 0) return [0, 0, row[0] ?? 0];
  let middle = 0;
  for (let k = 1; k < pos; k++) middle += row[k] ?? 0;
  return [row[0] ?? 0, middle, row[pos] ?? 0];
}

export function diffAttention(
  a: GenerateResponse,
  b: GenerateResponse,
  posA: number = a.tokens.length - 1,
  posB: number = b.tokens.length - 1,
): AttentionDiff {
  if (a.attention.length === 0 || b.attention.length === 0) {
    return { ok: false, reason: 'There is no attention data for one of the prompts.' };
  }
  if (a.attention_truncated || b.attention_truncated) {
    return { ok: false, reason: 'One prompt is too long: Pry only keeps attention for the first 64 tokens. Try shorter prompts.' };
  }
  if (a.attention.length !== b.attention.length || a.attention[0].heads.length !== b.attention[0].heads.length) {
    return { ok: false, reason: 'The two runs have different numbers of layers or heads (different models?), so heads can’t be matched.' };
  }
  const mode: AttentionCompareMode = a.tokens.length === b.tokens.length && posA === posB ? 'positions' : 'buckets';
  const nLayers = a.attention.length;
  const nHeads = a.attention[0].heads.length;
  const grid: number[][] = [];
  const ranked: HeadDelta[] = [];
  let sum = 0;
  for (let l = 0; l < nLayers; l++) {
    const row: number[] = [];
    for (let h = 0; h < nHeads; h++) {
      const rA = a.attention[l]?.heads[h]?.[posA];
      const rB = b.attention[l]?.heads[h]?.[posB];
      if (!rA || !rB) return { ok: false, reason: `Attention for layer ${l}, head ${h} is missing for the chosen word.` };
      const d = mode === 'positions'
        ? tvd(rA.slice(0, posA + 1), rB.slice(0, posB + 1))
        : tvd(attentionBuckets(rA, posA), attentionBuckets(rB, posB));
      row.push(d);
      ranked.push({ layer: l, head: h, distance: d });
      sum += d;
    }
    grid.push(row);
  }
  ranked.sort((x, y) => y.distance - x.distance);
  return { ok: true, mode, grid, ranked, mean: sum / (nLayers * nHeads), nLayers, nHeads };
}

// ---------------------------------------------------------------------------
// Plain-language summary
// ---------------------------------------------------------------------------

export const CORRELATION_NOTE =
  'These differences go along with the change you made to the prompt. On their own they don’t show what causes the model’s answer.';

/** One short paragraph: top guess shift, biggest gain/loss, standout feature, most-changed head. */
export function compareSummary(
  preds: PredictionDiff,
  feats: FeatureDiff | null,
  attn: AttentionDiff | null,
): string {
  const parts: string[] = [];
  const { topA, topB } = preds;
  if (topA && topB) {
    if (topA.token === topB.token) {
      parts.push(`Both prompts have the same top guess, ${quoteToken(topA.token)} (${pct(topA.probability)} with A, ${pct(topB.probability)} with B).`);
    } else {
      parts.push(`The top guess changes from ${quoteToken(topA.token)} (${pct(topA.probability)}) with A to ${quoteToken(topB.token)} (${pct(topB.probability)}) with B.`);
    }
  }
  const gain = preds.gained[0];
  const loss = preds.lost[0];
  const atLeast = (r: PredictionChange) => (r.approximate ? 'at least ' : '');
  const moves: string[] = [];
  if (gain) moves.push(`${quoteToken(gain.token)} gains the most (${atLeast(gain)}${points(gain.change)})`);
  if (loss) moves.push(`${quoteToken(loss.token)} loses the most (${atLeast(loss)}${points(loss.change)})`);
  if (moves.length) parts.push(`${moves.join(' and ')}.`);

  if (feats) {
    const fB = feats.onlyB[0];
    const fA = feats.onlyA[0];
    if (fB) parts.push(`The strongest feature found only with B is ${featureName(fB.hit)}.`);
    else if (fA) parts.push(`The strongest feature found only with A is ${featureName(fA.hit)}.`);
    else if (feats.both[0] && feats.both[0].change !== 0) {
      const f = feats.both[0];
      parts.push(`Both prompts light up the same top features; ${featureName(f.hit)} changes strength the most.`);
    }
  }

  if (attn?.ok && attn.ranked[0] && attn.ranked[0].distance > 0) {
    const top = attn.ranked[0];
    parts.push(`The head whose attention from this word differs most is layer ${top.layer}, head ${top.head} (${pct(top.distance)} different).`);
  }

  if (parts.length === 0) return 'Run both prompts to compare them.';
  parts.push(CORRELATION_NOTE);
  return parts.join(' ');
}
