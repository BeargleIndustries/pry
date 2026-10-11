import { describe, expect, it } from 'vitest';
import {
  RING_MIN_SCORE,
  demoFromParams,
  headKey,
  ringedHeads,
  ringedList,
  scoreGrid,
  scorePercent,
  splitRepeat,
} from './head-scores';
import type { HeadScore, HeadScoresResponse } from './types';

function hs(layer: number, head: number, induction: number, previous_token: number): HeadScore {
  return { layer, head, induction, previous_token };
}

// 2 layers x 3 heads.
const SCORES = [
  hs(0, 0, 0.01, 0.9), // strong previous-word head
  hs(0, 1, 0.02, 0.3),
  hs(0, 2, 0.0, 0.1),
  hs(1, 0, 0.92, 0.05), // strong copying head
  hs(1, 1, 0.49, 0.0), // just under the ring cutoff
  hs(1, 2, 0.6, 0.7), // qualifies as both
];

function fake(): HeadScoresResponse {
  const by = (k: 'induction' | 'previous_token') => [...SCORES].sort((a, b) => b[k] - a[k]).slice(0, 4);
  return {
    preset_id: 'gpt2-small',
    n_layers: 2,
    n_heads: 3,
    repeat_len: 2,
    sequence_tokens: [' a', ' b', ' a', ' b'],
    previous_token_source: 'repeated_sequence',
    scores: SCORES,
    top_induction: by('induction'),
    top_previous_token: by('previous_token'),
    timing_ms: {},
  };
}

describe('ringedHeads', () => {
  it('rings only heads at or above the cutoff, copying wins ties', () => {
    const rings = ringedHeads(fake());
    expect(RING_MIN_SCORE).toBe(0.5);
    expect(Object.fromEntries(rings)).toEqual({
      '1.0': 'induction',
      '1.2': 'induction',
      '0.0': 'previous',
    });
    expect(rings.has(headKey(1, 1))).toBe(false);
  });

  it('is empty without a response', () => {
    expect(ringedHeads(null).size).toBe(0);
    expect(ringedList(null, 'induction')).toEqual([]);
  });

  it('lists each kind highest first, without the head claimed by the other kind', () => {
    const r = fake();
    expect(ringedList(r, 'induction').map((s) => headKey(s.layer, s.head))).toEqual(['1.0', '1.2']);
    expect(ringedList(r, 'previous').map((s) => headKey(s.layer, s.head))).toEqual(['0.0']);
  });

  it('rings nothing on a model with no strong heads', () => {
    const r = fake();
    r.top_induction = r.top_induction.map((s) => ({ ...s, induction: 0.2 }));
    r.top_previous_token = r.top_previous_token.map((s) => ({ ...s, previous_token: 0.2 }));
    expect(ringedHeads(r).size).toBe(0);
  });
});

describe('scoreGrid', () => {
  it('lays scores out [layer][head]', () => {
    expect(scoreGrid(fake(), 'induction')).toEqual([
      [0.01, 0.02, 0.0],
      [0.92, 0.49, 0.6],
    ]);
    expect(scoreGrid(fake(), 'previous')[0]).toEqual([0.9, 0.3, 0.1]);
  });
});

describe('formatting', () => {
  it('scorePercent rounds to whole percent', () => {
    expect(scorePercent(0.936)).toBe('94%');
    expect(scorePercent(0)).toBe('0%');
  });

  it('splitRepeat returns the two copies', () => {
    expect(splitRepeat(fake())).toEqual({ first: [' a', ' b'], second: [' a', ' b'] });
  });
});

describe('demoFromParams', () => {
  it('recognizes the two demos and ignores anything else', () => {
    expect(demoFromParams(new URLSearchParams('demo=tour'))).toBe('tour');
    expect(demoFromParams(new URLSearchParams('demo=induction-heads'))).toBe('induction-heads');
    expect(demoFromParams(new URLSearchParams('demo=other'))).toBeNull();
    expect(demoFromParams(new URLSearchParams(''))).toBeNull();
  });
});
