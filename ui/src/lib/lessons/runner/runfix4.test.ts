// Rubric round-3 fixes, runtime half: a result shows only once its own step
// has run this visit, a cold entry reads the replayed run, and an earlier pick
// that a direct entry skipped reads "(not answered yet)", not "another lesson".

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonSource, makeKit, send, type Kit } from './test-kit';
import { plainText, type RenderedBlock } from '../render';
import { lessonsCopy } from '../copy';

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
id: pry.fixture-runfix4
title: "Runfix 4 fixture"
tool: pry
summary: "Runner fixture."
minutes: 1
model: gpt2-small
baseline: { prompt: "The capital of France is" }
slots:
  now1: { read: prediction, args: { token: " now" }, field: prob, format: probability, from_capture: first, expect: 0.047506 }
  now3: { read: prediction, args: { token: " now" }, field: prob, format: probability, from_capture: third, expect: 0.047506 }
---

## Guess and run {id=one}

:::predict{id=pick checks=obs1}
Top word?

\`\`\`yaml
choices:
  - { text: "\\" Paris\\"" }
  - { text: "something else" }
remember: pick
hides: [predictions-panel]
\`\`\`
:::

:::do{id=run1}
The lesson runs it.

\`\`\`actions
- run: {}
\`\`\`

\`\`\`yaml
capture: first
\`\`\`
:::

:::observe{id=obs1}
\`\`\`yaml
check: { read: top_guess.token, from: first, op: equals, value: " now" }
\`\`\`
:::

## What it showed {id=two}

:::explain-result{id=why}
You picked :earlier{key="pry.fixture-runfix4.pick"}[nothing], and in P9.9 you said :earlier{key="pry.p9-9.other"}[nothing]. ' now' got {now1}.

\`\`\`yaml
supports: "One run."
leaves_open: "One run only."
\`\`\`
:::

## Again, and a task {id=three}

:::do{id=run3}
Run it again.

\`\`\`actions
- run: {}
\`\`\`

\`\`\`yaml
capture: third
\`\`\`
:::

:::explain{id=read3}
This time ' now' got {now3}.

\`\`\`yaml
assert:
  - require: { slot: now3, op: lt, value: 0.1 }
    say: "Nothing is far ahead."
    else: "' now' leads."
\`\`\`
:::

:::task{id=write}
Write it in the app, then press **Check my result**.

\`\`\`yaml
target:
  - { read: write_it.text, op: contains, value: "zzz" }
learner_actions: [write_it]
\`\`\`
:::

:::observe{id=after-task}
What did it write?

\`\`\`yaml
journal: true
\`\`\`
:::
`;

describe('runfix4', () => {
  it("› a cold entry reads the replayed run's capture without journaling it, and a skipped pick in this lesson reads (not answered yet)", async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(LESSON), { source: { kind: 'bundled' }, sectionId: 'two' });
    const t = text(kit, 'why');
    expect(t).toContain('4.8% (about 1 in 21)');
    expect(t).toContain(`You picked ${lessonsCopy.notAnswered}`);
    expect(t).toContain(`you said ${lessonsCopy.notYet}`);
    expect(kit.journal.entries.filter((e) => e.capture)).toEqual([]);
  });

  it('› a capture this section takes stays out of sight until its own do step runs this visit, and so does its assert line', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(LESSON), { source: { kind: 'bundled' }, sectionId: 'three' });
    await send(kit, { type: 'do', step: 'run3' });
    expect(text(kit, 'read3')).toContain('4.8%');
    expect(plainText((block(kit, 'read3').asserts ?? []).flat())).toContain('Nothing is far ahead.');
    // Leave and come back: the journal has the capture, but this visit hasn't run the step.
    await kit.runner.goto(1);
    await kit.runner.idle();
    await kit.runner.goto(2);
    await kit.runner.idle();
    expect(kit.journal.entries.some((e) => e.capture?.name === 'third')).toBe(true);
    expect(text(kit, 'read3')).not.toContain('4.8%');
    expect(block(kit, 'read3').asserts ?? []).toEqual([]);
    await send(kit, { type: 'do', step: 'run3' });
    expect(text(kit, 'read3')).toContain('4.8%');
  });

  it("› an observe after a task waits until the task is run or checked", async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(LESSON), { source: { kind: 'bundled' }, sectionId: 'three' });
    await send(kit, { type: 'do', step: 'run3' });
    expect(block(kit, 'after-task').observe?.waiting).toBe(true);
    await send(kit, { type: 'task-check', step: 'write' });
    expect(block(kit, 'after-task').observe?.waiting).toBe(false);
  });

  it('› after the answer, a predict names what it had hidden as showing now', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(LESSON), { source: { kind: 'bundled' } });
    expect(block(kit, 'pick').ask?.hidden.length).toBe(1);
    expect(block(kit, 'pick').ask?.shown).toEqual([]);
    await send(kit, { type: 'answer', step: 'pick', choice: 1 });
    expect(block(kit, 'pick').ask?.hidden).toEqual([]);
    expect(block(kit, 'pick').ask?.shown?.length).toBe(1);
  });
});
