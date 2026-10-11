import { describe, expect, it } from 'vitest';
import {
  alignedPositions,
  attentionBuckets,
  compareSummary,
  CORRELATION_NOTE,
  diffAttention,
  diffFeatures,
  diffPredictions,
  featureName,
  featuresAt,
  points,
} from './compare';
import type { FeatureHit, GenerateResponse, TokenFeatures, TopPrediction } from './types';

// --- fixtures shaped like real /generate responses --------------------------

const pred = (token: string, probability: number, rank: number): TopPrediction => ({ token, probability, rank });
const hit = (id: number, activation: number, description: string | null = null): FeatureHit => ({
  id,
  activation,
  description,
  label_detail: description ? 'detailed' : 'none',
});

/** A causal attention row for query `q` over `n` keys, from weights for keys 0..q. */
function row(n: number, weights: number[]): number[] {
  return Array.from({ length: n }, (_, k) => weights[k] ?? 0);
}

/** Every head/query gets `uniformRow`, except overrides keyed "layer:head". */
function attention(n: number, nLayers: number, nHeads: number, lastRows: Record<string, number[]> = {}) {
  return Array.from({ length: nLayers }, (_, layer) => ({
    layer,
    heads: Array.from({ length: nHeads }, (_, head) =>
      Array.from({ length: n }, (_, q) => {
        if (q === n - 1 && lastRows[`${layer}:${head}`]) return row(n, lastRows[`${layer}:${head}`]);
        return row(n, Array.from({ length: q + 1 }, () => 1 / (q + 1)));
      }),
    ),
  }));
}

function response(
  prompt: string,
  tokens: string[],
  opts: {
    preds?: TopPrediction[];
    features?: FeatureHit[][];
    lastRows?: Record<string, number[]>;
    nLayers?: number;
    nHeads?: number;
    saeLayer?: number;
    truncated?: boolean;
  } = {},
): GenerateResponse {
  const n = tokens.length;
  return {
    preset_id: 'gpt2-small',
    prompt,
    tokens: tokens.map((text, index) => ({ index, text })),
    attention: attention(n, opts.nLayers ?? 2, opts.nHeads ?? 2, opts.lastRows),
    attention_truncated: opts.truncated ?? false,
    sae_features: tokens.map((_, i): TokenFeatures => ({ token_index: i, top_k: opts.features?.[i] ?? [] })),
    sae_layer_used: opts.saeLayer ?? 8,
    top_predictions: opts.preds ?? [],
    timing_ms: { total: 10 },
    generation: null,
  };
}

const DOCTOR = ['<|endoftext|>', 'The', ' doctor', ' said', ' that'];
const NURSE = ['<|endoftext|>', 'The', ' nurse', ' said', ' that'];

// --- predictions -------------------------------------------------------------

describe('diffPredictions', () => {
  const a = [pred(' he', 0.4, 1), pred(' the', 0.2, 2), pred(' she', 0.1, 3), pred(' it', 0.05, 4)];
  const b = [pred(' she', 0.45, 1), pred(' the', 0.2, 2), pred(' he', 0.08, 3), pred(' they', 0.06, 4)];

  it('computes B minus A for words in both lists, biggest change first', () => {
    const d = diffPredictions(a, b);
    expect(d.rows[0].token).toBe(' she');
    expect(d.rows[0].change).toBeCloseTo(0.35);
    expect(d.rows[0].approximate).toBe(false);
    expect(d.rows[1].token).toBe(' he');
    expect(d.rows[1].change).toBeCloseTo(-0.32);
    expect(d.topA?.token).toBe(' he');
    expect(d.topB?.token).toBe(' she');
    expect(d.gained.map((r) => r.token)).toEqual([' she', ' they']);
    expect(d.lost.map((r) => r.token)).toEqual([' he']);
  });

  it('bounds a word missing from one list by that list’s cutoff, never treating it as 0', () => {
    const d = diffPredictions(a, b);
    // " it": 5% in A, missing from B whose lowest listed is 6% -> sign unknown.
    const it_ = d.rows.find((r) => r.token === ' it')!;
    expect(it_.probB).toBeNull();
    expect(it_.change).toBe(0);
    expect(it_.approximate).toBe(true);
    // " they": 6% in B, missing from A whose lowest listed is 5% -> gained at least 1 pt.
    const they = d.rows.find((r) => r.token === ' they')!;
    expect(they.probA).toBeNull();
    expect(they.change).toBeCloseTo(0.01);
    expect(they.approximate).toBe(true);
    expect(d.cutoffA).toBeCloseTo(0.05);
    expect(d.cutoffB).toBeCloseTo(0.06);
  });

  it('a big word dropping out of the other list is a loss of at least (prob − cutoff)', () => {
    const d = diffPredictions([pred(' X', 0.5, 1)], [pred(' Y', 0.9, 1), pred(' Z', 0.02, 2)]);
    const x = d.rows.find((r) => r.token === ' X')!;
    expect(x.change).toBeCloseTo(-0.48);
    expect(x.approximate).toBe(true);
  });

  it('sorts by rank and copes with empty / missing lists', () => {
    const d = diffPredictions(undefined, [pred(' b', 0.1, 2), pred(' a', 0.5, 1)]);
    expect(d.topA).toBeNull();
    expect(d.topB?.token).toBe(' a');
    expect(d.cutoffA).toBe(0);
    expect(diffPredictions(null, null).rows).toEqual([]);
  });
});

describe('points', () => {
  it('formats signed percentage points', () => {
    expect(points(0.3)).toBe('+30 pts');
    expect(points(-0.04)).toBe('−4 pts');
    expect(points(0.01)).toBe('+1 pt');
    expect(points(0.001)).toBe('+<1 pt');
    expect(points(0)).toBe('0 pts');
  });
});

// --- features ----------------------------------------------------------------

describe('diffFeatures', () => {
  const fa: TokenFeatures = {
    token_index: 4,
    top_k: [hit(1, 5, 'medical words'), hit(2, 3, 'male pronouns coming'), hit(3, 1), hit(9, 0)],
  };
  const fb: TokenFeatures = {
    token_index: 4,
    top_k: [hit(1, 4, 'medical words'), hit(4, 6, 'female pronouns coming'), hit(3, 2.5), hit(8, 0)],
  };

  it('splits into only-A, only-B and both, ignoring zero activations', () => {
    const d = diffFeatures(fa, fb);
    expect(d.onlyA.map((f) => f.id)).toEqual([2]);
    expect(d.onlyB.map((f) => f.id)).toEqual([4]);
    expect(d.both.map((f) => f.id)).toEqual([3, 1]); // |+1.5| before |−1|
    expect(d.both[0].change).toBeCloseTo(1.5);
    expect(d.onlyA[0].actB).toBeNull();
    expect(d.cutoffA).toBe(1);
    expect(d.cutoffB).toBe(2.5);
    expect(d.listedA).toBe(4);
  });

  it('handles a missing side', () => {
    const d = diffFeatures(null, fb);
    expect(d.onlyB).toHaveLength(3);
    expect(d.onlyA).toEqual([]);
    expect(d.both).toEqual([]);
  });

  it('names features like the readouts do', () => {
    expect(featureName(hit(4, 1, 'female pronouns coming'))).toBe('#4 ("female pronouns coming")');
    expect(featureName(hit(5, 1))).toBe('#5 (no label yet)');
  });
});

// --- positions ---------------------------------------------------------------

describe('alignedPositions / featuresAt', () => {
  it('offers every position (last first) when the token counts match', () => {
    const p = alignedPositions(response('a', DOCTOR), response('b', NURSE));
    expect(p).toHaveLength(5);
    expect(p[0]).toMatchObject({ posA: 4, posB: 4, label: 'last word: "·that"' });
    expect(p[2].label).toBe('word 3: "·doctor" / "·nurse"');
  });

  it('only offers the last word when the token counts differ', () => {
    const p = alignedPositions(response('a', DOCTOR), response('b', ['<|endoftext|>', 'A', ' nurse', ' that']));
    expect(p).toEqual([{ posA: 4, posB: 3, label: 'last word: "·that"' }]);
  });

  it('finds features by token index', () => {
    const r = response('a', DOCTOR, { features: [[], [], [], [], [hit(7, 2)]] });
    expect(featuresAt(r, 4)?.top_k[0].id).toBe(7);
  });
});

// --- attention ---------------------------------------------------------------

describe('diffAttention', () => {
  it('same length: total variation distance between the last word’s rows, per head', () => {
    const a = response('a', DOCTOR, { lastRows: { '1:0': [0.5, 0, 0.5, 0, 0] } });
    const b = response('b', NURSE, { lastRows: { '1:0': [0.5, 0, 0, 0, 0.5] } });
    const d = diffAttention(a, b);
    if (!d.ok) throw new Error(d.reason);
    expect(d.mode).toBe('positions');
    expect(d.grid[1][0]).toBeCloseTo(0.5);
    expect(d.grid[0][0]).toBe(0); // identical uniform rows
    expect(d.ranked[0]).toEqual({ layer: 1, head: 0, distance: 0.5 });
    expect(d.mean).toBeCloseTo(0.5 / 4);
    expect(d.nLayers).toBe(2);
    expect(d.nHeads).toBe(2);
  });

  it('identical prompts give zero everywhere', () => {
    const d = diffAttention(response('a', DOCTOR), response('a', DOCTOR));
    expect(d.ok && d.ranked.every((h) => h.distance === 0)).toBe(true);
  });

  it('different lengths: compares [first token, in between, itself] shares', () => {
    const a = response('a', DOCTOR, { lastRows: { '0:1': [0.6, 0.1, 0.1, 0.1, 0.1] } }); // [0.6, 0.3, 0.1]
    const b = response('b', ['<|endoftext|>', 'A', ' nurse', ' that'], { lastRows: { '0:1': [0.2, 0.2, 0.2, 0.4] } }); // [0.2, 0.4, 0.4]
    const d = diffAttention(a, b);
    if (!d.ok) throw new Error(d.reason);
    expect(d.mode).toBe('buckets');
    expect(d.grid[0][1]).toBeCloseTo(0.4); // 0.5 * (0.4 + 0.1 + 0.3)
  });

  it('a chosen earlier position in equal-length prompts compares that word’s rows', () => {
    const d = diffAttention(response('a', DOCTOR), response('b', NURSE), 2, 2);
    expect(d.ok && d.mode).toBe('positions');
  });

  it('refuses truncated attention or mismatched head counts, with a reason', () => {
    const t = diffAttention(response('a', DOCTOR, { truncated: true }), response('b', NURSE));
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toMatch(/64 tokens/);
    const m = diffAttention(response('a', DOCTOR, { nHeads: 3 }), response('b', NURSE));
    expect(m.ok).toBe(false);
  });

  it('attentionBuckets handles the first word', () => {
    expect(attentionBuckets([1], 0)).toEqual([0, 0, 1]);
    expect(attentionBuckets([0.5, 0.25, 0.25], 2)).toEqual([0.5, 0.25, 0.25]);
  });
});

// --- summary -----------------------------------------------------------------

describe('compareSummary', () => {
  const a = response('The doctor said that', DOCTOR, {
    preds: [pred(' he', 0.4, 1), pred(' the', 0.2, 2), pred(' she', 0.1, 3)],
    features: [[], [], [], [], [hit(1, 5, 'medical words'), hit(2, 3, 'male pronouns coming')]],
    lastRows: { '1:1': [0.9, 0, 0.1, 0, 0] },
  });
  const b = response('The nurse said that', NURSE, {
    preds: [pred(' she', 0.45, 1), pred(' the', 0.2, 2), pred(' he', 0.08, 3)],
    features: [[], [], [], [], [hit(1, 4, 'medical words'), hit(4, 6, 'female pronouns coming')]],
    lastRows: { '1:1': [0.3, 0, 0.7, 0, 0] },
  });

  it('doctor vs nurse golden: top guess shift, gain/loss, feature, head, and the correlation caveat', () => {
    const text = compareSummary(
      diffPredictions(a.top_predictions, b.top_predictions),
      diffFeatures(featuresAt(a, 4), featuresAt(b, 4)),
      diffAttention(a, b),
    );
    expect(text).toBe(
      'The top guess changes from "·he" (40%) with A to "·she" (45%) with B. ' +
        '"·she" gains the most (+35 pts) and "·he" loses the most (−32 pts). ' +
        'The strongest feature found only with B is #4 ("female pronouns coming"). ' +
        'The head whose attention from this word differs most is layer 1, head 1 (60% different). ' +
        CORRELATION_NOTE,
    );
  });

  it('never claims causation', () => {
    const text = compareSummary(diffPredictions(a.top_predictions, b.top_predictions), null, null);
    expect(text.endsWith(CORRELATION_NOTE)).toBe(true);
    const claims = text.slice(0, -CORRELATION_NOTE.length);
    expect(claims).not.toMatch(/\bbecause\b|\bcaus|\bmakes the model\b|\bleads? to\b/i);
  });

  it('says "at least" for cutoff-bounded changes and handles a shared top guess', () => {
    const text = compareSummary(
      diffPredictions([pred(' X', 0.5, 1), pred(' W', 0.1, 2)], [pred(' X', 0.6, 1), pred(' Z', 0.3, 2)]),
      null,
      null,
    );
    expect(text).toContain('Both prompts have the same top guess, "·X" (50% with A, 60% with B).');
    expect(text).toContain('"·Z" gains the most (at least +20 pts)');
  });

  it('falls back when nothing is known', () => {
    expect(compareSummary(diffPredictions([], []), null, null)).toBe('Run both prompts to compare them.');
  });
});
