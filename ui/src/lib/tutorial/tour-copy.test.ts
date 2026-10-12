// Lane T4a closure checks for the tour copy (copy:T1-T8, the Swap test rename,
// and the last step pointing at Experiments). T4e folds these into
// copy-closure.test.ts.
import { describe, expect, it } from 'vitest';
import { targetLabels, tourChapters } from './tour-steps';

const steps = tourChapters.flatMap((c) => c.steps);
const text = (s: (typeof steps)[number]) => `${s.blurb} ${s.why ?? ''}`;
const visible = [...steps.map(text), ...Object.values(targetLabels)].join('\n');
const byId = (id: string) => steps.find((s) => s.id === id)!;

describe('tour copy closure (T4a)', () => {
  it.each([
    ['copy:T1', ['Brighter'], ['Darker line']],
    ['copy:T2', ['token and feature'], ['logit and feature all have one']],
    ['copy:T3', ['Original top-5', 'round x'], ['normal top five', 'tick the features']],
    ['copy:T4', ['The top bar always fills the row'], []],
    ['copy:T5', ['Nobody wrote its rules by hand'], []],
    ['copy:T6', ['press Find key parts'], []],
    ['copy:T7', ['After one write above 0'], []],
    ['rename', ['Swap test'], ['Swap & Compare', 'Agg menu']],
  ])('%s', (_id, must, mustNot) => {
    for (const m of must) expect(visible, m).toContain(m);
    for (const m of mustNot) expect(visible, m).not.toContain(m);
  });

  it('copy:T8 every chapter\'s last step has a "Next up:" pointer', () => {
    const missing = tourChapters.filter((c) => !text(c.steps.at(-1)!).includes('Next up:')).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('models.done points at the experiment gallery', () => {
    const done = byId('models.done');
    expect(done.target).toBe('experiments-button');
    expect(text(done)).toMatch(/Experiments/);
  });

  it('steps with a run name the button the user presses', () => {
    const missing = steps.filter((s) => s.run && !text(s).includes(s.run.label)).map((s) => s.id);
    expect(missing).toEqual([]);
  });
});
