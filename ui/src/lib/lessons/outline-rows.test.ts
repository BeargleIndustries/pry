import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { findOutlines, scanOutline, scanOutlines, splitItems } from '../../../scripts/outline-rows';

// The outlines live in the main checkout's gitignored .omc folder; a worktree finds them up the tree.
const dir = findOutlines(fileURLToPath(new URL('../../..', import.meta.url)));

// T6a's hand list (plan T6a "Row list").
const HAND_LIST: [string, number, number?][] = [
  ['P2.1', 63], ['P2.1', 78], ['P2.1', 108],
  ['P2.4', 79, 80], ['P2.4', 97],
  ['P2.5', 96],
  ['P3.2', 72], ['P3.2', 82],
  ['P3.6', 42, 43], ['P3.6', 52],
  ['P1.2', 126],
  ['P1.5', 101],
  ['P3.7', 73],
];

describe('outline-rows', () => {
  it('splits on semicolons outside brackets and quotes', () => {
    expect(splitItems('(a) one; (b) two (x; y); "c; d"')).toEqual(['(a) one', '(b) two (x; y)', '"c; d"']);
    const items = scanOutline('X.md', '- **To verify through the sidecar:**\n  1. first; second\n  2. third\n- unrelated\n');
    expect(items.map((i) => [i.line, i.text])).toEqual([[2, 'first'], [2, 'second'], [3, 'third']]);
  });

  it.skipIf(!dir)('› finds body-only items (P3.2:51) and splits semicolon bullets', () => {
    const { raw, unique } = scanOutlines(dir!);
    expect(raw.some((i) => i.file === 'P3.2.md' && i.line === 51)).toBe(true);
    const p21 = raw.filter((i) => i.file === 'P2.1.md' && i.line === 108);
    expect(p21.map((i) => i.text.slice(0, 3))).toEqual(['**T', '(b)', '(c)']);
    expect(unique.length).toBeLessThanOrEqual(raw.length);
  });

  it.skipIf(!dir)('› every outline line in T6a\'s hand list is among the scanner\'s items', () => {
    const { raw } = scanOutlines(dir!);
    for (const [name, from, to = from] of HAND_LIST) {
      const file = `${name}.md`;
      // An item counts for a line when it sits on it, or the line is in the item's step block
      // (P3.6:52 is the control line of the step whose "to verify" is on 53).
      const found = raw.some((i) => i.file === file && ((i.line >= from && i.line <= to) || (i.block[0] <= to && i.block[1] >= from)));
      expect(found, `${name}:${from}${to !== from ? `-${to}` : ''}`).toBe(true);
    }
  });
});
