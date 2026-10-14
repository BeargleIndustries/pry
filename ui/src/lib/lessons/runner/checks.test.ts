import { describe, expect, it } from 'vitest';
import { compareOp, evaluateCheck, evaluateChecks, predictionValue, type CheckEnv } from './checks';
import type { ReadoutDef } from '../registry/contract';
import type { CheckItem } from '../format/schema';
import { lessonsCopy } from '../copy';

// A small tool: live readouts, one capture, one earlier answer.
const live: Record<string, unknown> = {
  'top.token': ' Paris',
  'top.prob': 0.42,
  text: ' was a great friend of mine',
  tokens: [' the', ' cat', ' sat'],
  heads: [
    { layer: 9, head: 9, importance: 0.8 },
    { layer: 10, head: 0, importance: 0.4 },
  ],
  pred: { prob: 0.3, logit: 12.5, rank: 2 },
};
const captured: Record<string, Record<string, unknown>> = { a: { text: ' the same words' }, b: { text: ' the same words' } };
const sides: Record<string, number> = { a: 9, b: 9 };

const readouts: Record<string, ReadoutDef> = {
  'top.token': { type: 'string', doc: 'The top prediction.', read: () => live['top.token'] },
  'top.prob': { type: 'number', unit: 'probability', doc: 'The top prediction\'s probability.', read: () => live['top.prob'] },
  text: { type: 'string', doc: 'The written text.', read: () => live.text },
  tokens: { type: 'list', doc: 'The tokens.', read: () => live.tokens },
  heads: { type: 'list', doc: 'The parts in the map.', read: () => live.heads },
  pred: { type: 'record', fields: { prob: 'number', logit: 'number', rank: 'number' }, doc: 'One token.', read: () => live.pred },
  count: { type: 'number', unit: 'count', doc: 'How many tokens one side became.', read: (a?: { side: string }) => sides[a?.side ?? 'a'] },
  missing: { type: 'number', doc: 'Nothing yet.', read: () => undefined },
  words: { type: 'prose', doc: 'A sentence.', read: () => 'hello' },
};

function env(over: Partial<CheckEnv> = {}): CheckEnv {
  return {
    set: { readouts },
    read: (r, args, from) => (from ? captured[from]?.[r] : readouts[r]?.read(args)),
    earlier: (k) => (k === 'pry.p2-1.word-pick' ? ' Paris' : undefined),
    row: (id, f) => (id === '1' && f === 'p' ? 0.42 : undefined),
    slot: (n) => (n === 'bar' ? 0.05 : undefined),
    ...over,
  };
}

const check = (item: Partial<CheckItem>, e: CheckEnv = env()) => evaluateCheck({ read: 'top.token', op: 'equals', ...item } as CheckItem, e);

describe('checks', () => {
  it('› each operator', () => {
    expect(compareOp('equals', 3, 3, 0)).toBe(true);
    expect(compareOp('equals', 0.42, 0.43, 0.02)).toBe(true);
    expect(compareOp('equals', 3, 4, 0.5)).toBe(false); // integers are exact
    expect(compareOp('in', ' a', [' a', ' b'], 0)).toBe(true);
    expect(compareOp('changed_from', ' a', ' b', 0)).toBe(true);
    expect(compareOp('changed_from', [1], [1], 0)).toBe(false);
    expect(compareOp('gt', 2, 1, 0)).toBe(true);
    expect(compareOp('lt', 2, 1, 0)).toBe(false);
    expect(compareOp('increased', 0.5, 0.3, 0)).toBe(true);
    expect(compareOp('decreased', 0.5, 0.3, 0)).toBe(false);
    expect(compareOp('within', 1.04, 1, 0.05)).toBe(true);
    expect(compareOp('within', 1.2, 1, 0.05)).toBe(false);
  });

  it('› contains and starts_with', () => {
    expect(check({ read: 'text', op: 'contains', value: 'great' }).agrees).toBe(true);
    expect(check({ read: 'text', op: 'contains', value: ['ocean', 'friend'] }).agrees).toBe(true); // any word of a recorded list
    expect(check({ read: 'tokens', op: 'contains', value: ' cat' }).agrees).toBe(true);
    expect(check({ read: 'heads', op: 'contains', value: [{ layer: 9, head: 9 }] }).agrees).toBe(true); // a head among the map's parts
    expect(check({ read: 'heads', op: 'contains', value: { layer: 2, head: 3 } }).agrees).toBe(false);
    expect(check({ read: 'text', op: 'starts_with', value: ' was a great' }).agrees).toBe(true);
    expect(check({ read: 'text', op: 'starts_with', value: 'great' }).agrees).toBe(false);
  });

  it('› contains on a record matches only the fields the expected record names', () => {
    expect(compareOp('contains', { layer: 1, head: 4, induction: 0.93 }, { layer: 1, head: 4 }, 0)).toBe(true);
    expect(compareOp('contains', [{ layer: 1, head: 4, induction: 0.93 }], { layer: 1, head: 4 }, 0)).toBe(true);
    expect(compareOp('contains', { layer: 1, head: 4 }, { layer: 2, head: 4 }, 0)).toBe(false);
  });

  it('› not contains', () => {
    expect(check({ read: 'text', op: 'contains', value: 'ocean', not: true }).agrees).toBe(true);
    expect(check({ read: 'text', op: 'contains', value: 'great', not: true }).agrees).toBe(false);
  });

  it('› two conditions both required', () => {
    const items: CheckItem[] = [
      { read: 'top.token', op: 'equals', value: ' Paris' },
      { read: 'top.prob', op: 'gt', value: 0.5 },
    ];
    const o = evaluateChecks(items, env());
    expect(o.agrees).toBe(false);
    expect(o.item.read).toBe('top.prob');
    expect(evaluateChecks([items[0], { read: 'top.prob', op: 'gt', value: 0.4 }], env()).agrees).toBe(true);
  });

  it('› token counts equal across sides', () => {
    const item: CheckItem = { read: 'count', args: { side: 'b' }, op: 'equals', value: '$read.count', value_args: { side: 'a' } };
    expect(evaluateCheck(item, env()).agrees).toBe(true);
    sides.b = 10;
    const o = evaluateCheck(item, env());
    expect(o.agrees).toBe(false);
    expect(o.text).toBe(lessonsCopy.differsOther('10'));
    sides.b = 9;
  });

  it('› $capture and $earlier values', () => {
    const cap = evaluateCheck({ read: 'text', from: 'a', op: 'equals', value: '$capture.b.text' }, env());
    expect(cap).toMatchObject({ agrees: true, binding: 'run', bindingName: 'b', text: lessonsCopy.agreesRun('b') });
    const ear = evaluateCheck({ read: 'top.token', op: 'equals', value: '$earlier.pry.p2-1.word-pick' }, env());
    expect(ear).toMatchObject({ agrees: true, binding: 'earlier', text: lessonsCopy.agreesEarlier });
    expect(check({ read: 'top.prob', op: 'equals', value: '$row.1.p' }).agrees).toBe(true);
    expect(check({ read: 'top.prob', op: 'gt', value: '$slot.bar' }).agrees).toBe(true);
    expect(check({ read: 'pred', field: 'logit', op: 'gt', value: 12 }).agrees).toBe(true);
  });

  it('› binding wording', () => {
    expect(check({ value: '$prediction' }, env({ prediction: predictionValue('" Paris"') })).text).toBe('The app agrees with your prediction.');
    expect(check({ value: '$prediction' }, env({ prediction: ' London' })).text).toBe(
      'The app shows something different from your prediction: " Paris".',
    );
    expect(check({ value: ' Paris' }).text).toBe('The app shows what the lesson expected.');
    expect(check({ read: 'top.prob', op: 'equals', expect: 0.1 }).text).toBe(
      'The app shows something different from what the lesson expected: 42% (about 3 in 7).',
    );
  });

  it('› missing readout', () => {
    const o = check({ read: 'missing', op: 'gt', value: 1 });
    expect(o.agrees).toBeNull();
    expect(o.text).toBe(lessonsCopy.missingReadout);
    expect(check({ read: 'words', op: 'equals', value: 'hello' }).agrees).toBeNull(); // prose is never checked
    expect(check({ read: 'no.such', op: 'equals', value: 1 }).agrees).toBeNull();
  });

  it('› model mismatch', () => {
    const o = check({ value: ' London' }, env({ mismatch: { model: 'GPT-2 small' } }));
    expect(o.text).toBe('Written for GPT-2 small; your model may differ. The app shows " Paris".');
  });
});
