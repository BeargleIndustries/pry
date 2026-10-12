import { describe, it, expect } from 'vitest';
import {
  AUTO_ADVANCE_MS,
  LOADING_TIPS,
  RECENT_KEY,
  buildDeck,
  deckReducer,
  interleave,
  markSeen,
  readRecent,
  shouldAutoAdvance,
  shuffle,
  type DeckCard,
} from './loading-deck';
import { tipsRegistry } from './tips/tips-registry';
import { loadExperiments } from './experiments/experiments';
import { glossary } from './glossary';

/** Deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const experiments = loadExperiments();
const base = { tips: tipsRegistry, experiments, glossary, presetId: 'gpt2-small' };

describe('buildDeck', () => {
  it('uses real tips, experiments and glossary words, with no repeats', () => {
    const deck = buildDeck({ ...base, random: seeded(1) });
    const kinds = new Set(deck.map((c) => c.kind));
    expect(kinds).toEqual(new Set(['tip', 'experiment', 'term']));
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    expect(deck.length).toBe(12);
  });

  it('every curated tip id exists in the registry', () => {
    const ids = new Set(tipsRegistry.map((t) => t.id));
    for (const id of Object.keys(LOADING_TIPS)) expect(ids.has(id)).toBe(true);
  });

  // copy:L1. Loading cards show away from their panel, so "this"/"these" point at nothing.
  it('loading cards do not use deictic openers', () => {
    const deck = buildDeck({ ...base, random: seeded(1), perKind: 99 });
    const bodies = deck.flatMap((c) => (c.kind === 'tip' ? [c.body] : []));
    expect(bodies.length).toBe(Object.keys(LOADING_TIPS).length);
    for (const body of bodies) expect(body).not.toMatch(/^(this|these|toggle|hit|press)\b/i);
  });

  it('never puts the same kind twice in a row', () => {
    for (let seed = 1; seed < 20; seed++) {
      const deck = buildDeck({ ...base, random: seeded(seed) });
      for (let i = 1; i < deck.length; i++) expect(deck[i].kind).not.toBe(deck[i - 1].kind);
    }
  });

  it('shuffles: different seeds give different orders', () => {
    const a = buildDeck({ ...base, random: seeded(1) }).map((c) => c.id);
    const b = buildDeck({ ...base, random: seeded(2) }).map((c) => c.id);
    expect(a).not.toEqual(b);
  });

  it('puts recently seen cards last', () => {
    const allTerms = Object.keys(glossary).map((k) => `term:${k}`);
    const recent = allTerms.slice(0, allTerms.length - 2);
    const deck = buildDeck({ ...base, random: seeded(3), recent });
    const terms = deck.filter((c) => c.kind === 'term').map((c) => c.id);
    // the two unseen terms come first
    expect(terms.slice(0, 2).sort()).toEqual(allTerms.slice(-2).sort());
  });

  it('says when an experiment needs a different model', () => {
    const deck = buildDeck({ ...base, presetId: 'gemma-2-2b', random: seeded(4) });
    const exps = deck.filter((c): c is Extract<DeckCard, { kind: 'experiment' }> => c.kind === 'experiment');
    expect(exps.length).toBeGreaterThan(0);
    expect(exps.every((e) => e.switchesModel === (e.preset !== 'gemma-2-2b'))).toBe(true);
    const same = buildDeck({ ...base, random: seeded(4) }).filter((c) => c.kind === 'experiment');
    expect(same.every((e) => e.kind === 'experiment' && !e.switchesModel)).toBe(true);
  });

  it('copes with empty sources', () => {
    expect(buildDeck({ tips: [], experiments: [], glossary: {}, presetId: 'x' })).toEqual([]);
  });
});

describe('helpers', () => {
  it('shuffle keeps every item', () => {
    const xs = [1, 2, 3, 4, 5, 6];
    expect(shuffle(xs, seeded(9)).sort()).toEqual(xs);
  });

  it('interleave round-robins uneven groups', () => {
    expect(interleave<string>([['1', '2', '3'], ['a'], ['x', 'y']])).toEqual(['1', 'a', 'x', '2', 'y', '3']);
  });
});

describe('navigation', () => {
  const s0 = { index: 0, size: 3, shownAt: 0 };

  it('wraps forwards and backwards', () => {
    expect(deckReducer(s0, { type: 'prev', now: 5 }).index).toBe(2);
    let s = deckReducer(s0, { type: 'next', now: 5 });
    s = deckReducer(s, { type: 'next', now: 6 });
    s = deckReducer(s, { type: 'next', now: 7 });
    expect(s).toEqual({ index: 0, size: 3, shownAt: 7 });
  });

  it('goto ignores out-of-range and same index', () => {
    expect(deckReducer(s0, { type: 'goto', index: 5, now: 1 })).toBe(s0);
    expect(deckReducer(s0, { type: 'goto', index: 0, now: 1 })).toBe(s0);
    expect(deckReducer(s0, { type: 'goto', index: 2, now: 1 }).index).toBe(2);
  });

  it('auto-advances only when not paused and after the interval', () => {
    expect(shouldAutoAdvance(s0, AUTO_ADVANCE_MS - 1, false)).toBe(false);
    expect(shouldAutoAdvance(s0, AUTO_ADVANCE_MS, false)).toBe(true);
    expect(shouldAutoAdvance(s0, AUTO_ADVANCE_MS * 3, true)).toBe(false);
    expect(shouldAutoAdvance({ ...s0, size: 1 }, AUTO_ADVANCE_MS, false)).toBe(false);
  });

  it('an empty deck stays put', () => {
    const e = { index: 0, size: 0, shownAt: 0 };
    expect(deckReducer(e, { type: 'next', now: 1 })).toBe(e);
  });
});

describe('recently seen', () => {
  it('remembers order, de-duplicates and caps', () => {
    const s = memStorage();
    markSeen('a', s);
    markSeen('b', s);
    markSeen('a', s);
    expect(readRecent(s)).toEqual(['b', 'a']);
    for (let i = 0; i < 40; i++) markSeen(`x${i}`, s);
    expect(readRecent(s).length).toBe(24);
    expect(readRecent(s).at(-1)).toBe('x39');
  });

  it('ignores junk and broken storage', () => {
    const s = memStorage();
    s.setItem(RECENT_KEY, '{oops');
    expect(readRecent(s)).toEqual([]);
    const bad = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(readRecent(bad)).toEqual([]);
    expect(() => markSeen('a', bad)).not.toThrow();
  });
});
