// Lane T4a closure checks for the experiment guide copy (copy:E5-E16, E18,
// cav:feature-labels-exp, the Swap test rename). copy-closure.test.ts refers to
// some of these tests by name.
import { describe, expect, it } from 'vitest';
import raw from './experiments.json';

type Exp = (typeof raw.experiments)[number];
const prose = (e: Exp): string[] => [e.title, e.hook, e.why, ...e.lookFor, e.found.summary, e.next.reset, e.next.try];
const all = raw.experiments.flatMap(prose);
const visible = all.join('\n');
const byId = (id: string) => raw.experiments.find((e) => e.id === id)!;
const textOf = (id: string) => prose(byId(id)).join('\n');

describe('experiment copy closure (T4a)', () => {
  it.each([
    ['copy:E5', 'ioi-swap', ['rows are layers 0 to 11', 'Blue squares'], []],
    ['copy:E6', 'logit-lens', ['Read the last column', 'Indigo'], []],
    ['copy:E7', 'greater-than', ['8 to 11', 'bar at the top'], []],
    ['copy:E8', 'he-or-she', ['press Compare', 'Run both'], ['in the prompt box and press Run again']],
    ['copy:E9', 'fact-recall', ['That big layer 0 bar is expected'], []],
    ['copy:E10', 'fact-recall', [], ['feed-forward']],
    ['copy:E11', 'ioi-swap', ['raises the score'], ['how much of the']],
    ['copy:E12', 'greater-than', ['Pry tracks only the single year'], []],
    ['copy:E14', 'ioi-knockout', ['layer 9, head 9', 'Original top-5'], ['normal top-5']],
    ['copy:E15', 'features-steering', ['# number', 'Run Steered'], []],
    ['copy:E16', 'induction', ['to see its whole pattern'], []],
    ['copy:E18', 'ioi-knockout', ['Knock out (switch off)'], []],
    ['cav:feature-labels-exp', 'features-steering', ['written by an AI', 'Another AI wrote the labels'], ['written from examples']],
  ])('%s', (_id, id, must, mustNot) => {
    const t = textOf(id);
    for (const m of must) expect(t, m).toContain(m);
    for (const m of mustNot) expect(t, m).not.toContain(m);
  });

  it('copy:E11/E10 hold across every experiment', () => {
    expect(visible).not.toContain('how much of the');
    expect(visible).not.toContain('feed-forward');
  });

  it('copy:E13 no quoted token with a leading space, and the dot is explained', () => {
    // An opening quote (start, space or paren before it) followed by a space.
    expect(all.filter((s) => /(^|[\s(])"\s\w/.test(s))).toEqual([]);
    expect(visible).toContain('the dot means the word starts with a space');
  });

  it('rename: Swap test, never Swap & Compare', () => {
    expect(visible).not.toContain('Swap & Compare');
    expect(visible).toContain('Swap test');
  });

  it('fact-recall says why layer 0 wins here when the paper found middle layers', () => {
    expect(textOf('fact-recall')).toMatch(/doesn't mean the fact lives there/);
    expect(textOf('fact-recall')).toMatch(/middle layers/);
  });

  it('every experiment ends with a next step and Back to normal', () => {
    for (const e of raw.experiments) {
      expect(e.next.try, e.id).toMatch(/^Next/);
      expect(`${e.next.reset} ${e.next.try}`, e.id).toContain("Back to normal");
    }
  });
});
