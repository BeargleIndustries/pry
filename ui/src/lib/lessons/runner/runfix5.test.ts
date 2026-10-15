// Rubric round-4 fixes: an observe whose predict sits in an earlier section
// isn't held back by it. A section entered directly (or passed without an
// answer) shows the result once its own do step runs; only a predict in the
// same section still waits.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonFile, lessonSource, makeKit, send, type Kit } from './test-kit';
import { plainText, type RenderedBlock } from '../render';
import { lessonsCopy } from '../copy';
import { PLACEHOLDER } from '../slots';

afterEach(() => vi.unstubAllGlobals());

function block(kit: Kit, key: string): RenderedBlock {
  const flat = (bs: RenderedBlock[]): RenderedBlock[] => bs.flatMap((b) => [b, ...flat(b.children)]);
  const b = flat(kit.runner.render().blocks).find((x) => x.key === key || x.stepId === key);
  if (!b) throw new Error(`no block ${key}`);
  return b;
}
const text = (kit: Kit, key: string) => plainText(block(kit, key).body);

const LESSON = `---
format: 1
id: pry.fixture-runfix5
title: "Runfix 5 fixture"
tool: pry
summary: "Runner fixture."
minutes: 1
model: gpt2-small
baseline: { prompt: "The capital of France is" }
slots:
  now: { read: prediction, args: { token: " now" }, field: prob, format: probability, expect: 0.047506 }
---

## Guess {id=one}

:::predict{id=pick checks=obs}
Top word?

\`\`\`yaml
choices:
  - { text: "\\" Paris\\"" }
  - { text: "something else" }
remember: pick
\`\`\`
:::

## The reveal {id=two}

:::do{id=run2}
The lesson runs it.

\`\`\`actions
- run: {}
\`\`\`
:::

:::observe{id=obs}
You picked :earlier{key="pry.fixture-runfix5.pick"}[nothing]. ' now' got {now}.

\`\`\`yaml
check: { read: top_guess.token, op: equals, value: " now" }
\`\`\`
:::

## Same section {id=three}

:::predict{id=pick3 checks=obs3}
Top word again?

\`\`\`yaml
choices:
  - { text: "\\" now\\"" }
  - { text: "something else" }
\`\`\`
:::

:::observe{id=obs3}
' now' got {now}.

\`\`\`yaml
check: { read: top_guess.token, op: equals, value: " now" }
\`\`\`
:::
`;

describe('runfix5', () => {
  it('› entered directly, an observe whose predict is in an earlier section shows once its do step runs', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(LESSON), { source: { kind: 'bundled' }, sectionId: 'two' });
    expect(block(kit, 'obs').observe?.waiting).toBe(true);
    expect(text(kit, 'obs')).toContain(PLACEHOLDER);
    await send(kit, { type: 'do', step: 'run2' });
    expect(block(kit, 'obs').observe?.waiting).toBe(false);
    const t = text(kit, 'obs');
    expect(t).toContain('4.8% (about 1 in 21)');
    expect(t).toContain(`You picked ${lessonsCopy.notAnswered}`);
    await send(kit, { type: 'show', step: 'obs' });
    expect(block(kit, 'obs').observe?.revealed).toBe(true);
  });

  it('› P1.6 entered at "Same text, then gone": Sam fills after Do it, and a later do step run past the observe takes the pointer', async () => {
    const lesson = lessonFile('../../lessons/pry.p1-6/lesson.md');
    const kit = makeKit();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-2' });
    await send(kit, { type: 'do', step: 'sam-compare' });
    expect(block(kit, 'sam-obs').observe?.waiting).toBe(false);
    expect(text(kit, 'sam-obs')).not.toContain(PLACEHOLDER);
    expect(text(kit, 'sam-obs')).toContain(`You said ${lessonsCopy.notAnswered}`);
    await send(kit, { type: 'do', step: 'jordan-again' });
    expect(kit.runner.activeLooks(kit.runner.render())).toEqual([{ anchor: 'predictions-panel' }]);
  });

  it('› P2.5 entered at the label section: the label shows on cold entry', async () => {
    const lesson = lessonFile('../../lessons/pry.p2-5/lesson.md');
    const kit = makeKit();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-6' });
    expect(block(kit, 'label-obs').observe?.waiting).toBe(false);
    expect(text(kit, 'label-obs')).not.toContain(PLACEHOLDER);
  });

  it('› a predict in the same section still holds its observe back until it is answered', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(LESSON), { source: { kind: 'bundled' }, sectionId: 'three' });
    expect(block(kit, 'obs3').observe?.waiting).toBe(true);
    await send(kit, { type: 'answer', step: 'pick3', choice: 0 });
    expect(block(kit, 'obs3').observe?.waiting).toBe(false);
  });
});
