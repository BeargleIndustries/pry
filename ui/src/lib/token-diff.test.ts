import { describe, expect, it } from 'vitest';
import { diffTokens, wordTokens, type DiffToken } from './token-diff';

const join = (ts: DiffToken[]) => ts.map((t) => t.text).join('');
const changed = (ts: DiffToken[]) => ts.filter((t) => t.changed).map((t) => t.text);

describe('wordTokens', () => {
  it('preserves whitespace so tokens rejoin to the original', () => {
    const s = '  the  cat\nsat ';
    expect(wordTokens(s)).toEqual(['  ', 'the', '  ', 'cat', '\n', 'sat', ' ']);
    expect(wordTokens(s).join('')).toBe(s);
  });
});

describe('diffTokens', () => {
  it('identical text has no changes', () => {
    const d = diffTokens(' the mat.', ' the mat.');
    expect(changed(d.left)).toEqual([]);
    expect(changed(d.right)).toEqual([]);
    expect(join(d.left)).toBe(' the mat.');
  });

  it('marks an insertion on the right only', () => {
    const d = diffTokens(' the mat', ' the red mat');
    expect(changed(d.left)).toEqual([]);
    expect(changed(d.right)).toEqual(['red', ' ']);
    expect(join(d.right)).toBe(' the red mat');
  });

  it('marks a deletion on the left only', () => {
    const d = diffTokens(' the big red mat', ' the mat');
    expect(changed(d.right)).toEqual([]);
    expect(changed(d.left).filter((t) => t.trim())).toEqual(['big', 'red']);
    expect(join(d.left)).toBe(' the big red mat');
  });

  it('a mid-sentence insertion does not mark the shifted tail as changed', () => {
    // The old positional diff flagged everything after the insertion.
    const d = diffTokens('a b c d', 'a X b c d');
    expect(changed(d.right).filter((t) => t.trim())).toEqual(['X']);
    expect(d.right.filter((t) => t.text === 'd')[0].changed).toBe(false);
  });

  it('handles a substitution', () => {
    const d = diffTokens('on the mat', 'on the floor');
    expect(changed(d.left)).toEqual(['mat']);
    expect(changed(d.right)).toEqual(['floor']);
  });

  it('handles empty inputs', () => {
    expect(diffTokens('', '')).toEqual({ left: [], right: [] });
    const ins = diffTokens('', 'hi there');
    expect(ins.left).toEqual([]);
    expect(ins.right.every((t) => t.changed)).toBe(true);
    expect(join(ins.right)).toBe('hi there');
    const del = diffTokens('hi there', '');
    expect(del.right).toEqual([]);
    expect(del.left.every((t) => t.changed)).toBe(true);
  });
});
