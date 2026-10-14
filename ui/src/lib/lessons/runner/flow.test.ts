import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonFile, lessonSource, makeKit, rowValues, send, type Kit } from './test-kit';
import { EARLIER } from './fixtures';
import { lessonsCopy } from '../copy';
import { plainText, type RenderedBlock } from '../render';

afterEach(() => vi.unstubAllGlobals());

const IOI = 'When Mary and John went to the store, John gave a drink to';

function block(kit: Kit, key: string): RenderedBlock {
  const flat = (bs: RenderedBlock[]): RenderedBlock[] => bs.flatMap((b) => [b, ...flat(b.children)]);
  const b = flat(kit.runner.render().blocks).find((x) => x.key === key || x.stepId === key);
  if (!b) throw new Error(`no block ${key}`);
  return b;
}

const QUESTION = `---
format: 1
id: pry.fixture-question
title: "Question fixture"
tool: pry
summary: "Runner fixture."
minutes: 1
---

## Ask {id=ask}

:::question{id=q1}
Pick one.

\`\`\`yaml
choices:
  - { text: "a", feedback: "Here's why a." }
  - { text: "b", feedback: "Here's why b.", reveal: false }
\`\`\`
:::
`;

describe('flow', () => {
  async function p12(answers: [number, number, number]) {
    const kit = makeKit();
    await kit.runner.open(lessonFile('fixtures/outline-coverage/P1.2.md'), { source: { kind: 'bundled' }, sectionId: 's3-1' });
    await send(kit, { type: 'answer', step: 'pieces-unbelievable', choice: answers[0] });
    await send(kit, { type: 'answer', step: 'pieces-leclerc', choice: answers[1] });
    await send(kit, { type: 'answer', step: 'pieces-why', choice: answers[2] });
    return kit;
  }

  it('› skip_check jumps on the matching answer only', async () => {
    const match = await p12([0, 2, 1]);
    await send(match, 'next');
    expect(match.runner.section?.id).toBe('s3-3');
    const miss = await p12([1, 2, 1]); // ' unbelievable' -> "2"
    await send(miss, 'next');
    expect(miss.runner.section?.id).toBe('s3-2');
  });

  it('› compound skip_check (P1.2: two picks + reason) skips 3.2 and 3.4', async () => {
    const kit = await p12([0, 2, 1]);
    expect([...kit.runner.skippedSections()].sort()).toEqual(['s3-2', 's3-4']);
    await send(kit, 'next');
    expect(kit.runner.section?.id).toBe('s3-3');
    await send(kit, 'next');
    expect(kit.runner.section?.id).toBe('s3-5');
    // The fold still includes the skipped sections: state depends only on the section and journal.
    await send(kit, 'back');
    expect(kit.runner.section?.id).toBe('s3-3');
  });

  it('› question feedback shows straight after commit; reveal: false shows none', async () => {
    const a = makeKit();
    await a.runner.open(lessonSource(QUESTION), { source: { kind: 'bundled' } });
    expect(block(a, 'q1').ask!.feedback).toBeNull();
    await send(a, { type: 'answer', step: 'q1', choice: 0 });
    expect(plainText(block(a, 'q1').ask!.feedback!)).toBe("Here's why a.");
    const b = makeKit();
    await b.runner.open(lessonSource(QUESTION), { source: { kind: 'bundled' } });
    await send(b, { type: 'answer', step: 'q1', choice: 1 });
    expect(block(b, 'q1').ask!.locked).toBe(true);
    expect(block(b, 'q1').ask!.feedback).toBeNull();
  });

  it('› on_skip text shows only after skip', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonFile('fixtures/outline-coverage/P1.2.md'), { source: { kind: 'bundled' }, sectionId: 's3-5' });
    expect(block(kit, 'same-start').ask!.onSkip).toBeNull();
    await send(kit, { type: 'skip', step: 'same-start' });
    expect(plainText(block(kit, 'same-start').ask!.onSkip!)).toBe('Stub: reveals the next section directly.');
    // A committed answer never shows it.
    const k2 = makeKit();
    await k2.runner.open(lessonFile('fixtures/outline-coverage/P1.2.md'), { source: { kind: 'bundled' }, sectionId: 's3-5' });
    await send(k2, { type: 'answer', step: 'same-start', choice: 1 });
    expect(block(k2, 'same-start').ask!.onSkip).toBeNull();
  });

  it('› when step swaps with its sibling (P2.5 skeleton with features.has_snippets false)', async () => {
    const texts = (kit: Kit) =>
      kit.runner
        .render()
        .blocks.filter((b) => b.kind === 'explain')
        .map((b) => plainText(b.body));
    const lesson = lessonFile('fixtures/outline-coverage/P2.5.md');
    // Feature 7 has no snippets in the stub; feature 101 has one.
    const none = makeKit({ useRecorded: false, rows: (id) => (id === '1' ? { ...(rowValues(id) as object), fid: 7 } : rowValues(id)) });
    await none.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-5' });
    await send(none, { type: 'do', step: 'open-card' });
    expect(texts(none)).toContain("Stub: the snippets haven't loaded; guess from the activations instead.");
    expect(texts(none)).not.toContain('Stub: the snippets have loaded.');
    const some = makeKit({ useRecorded: false, rows: (id) => (id === '1' ? { ...(rowValues(id) as object), fid: 101 } : rowValues(id)) });
    await some.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-5' });
    await send(some, { type: 'do', step: 'open-card' });
    if (!some.host.analysis.state.response) await some.host.analysis.generate(some.host.page.prompt);
    expect(texts(some)).toContain('Stub: the snippets have loaded.');
    expect(texts(some)).not.toContain("Stub: the snippets haven't loaded; guess from the activations instead.");
  });

  it('› P3.1 task rejects a two-word change', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonFile('fixtures/outline-coverage/P3.1.md'), { source: { kind: 'bundled' }, sectionId: 's5' });
    expect(block(kit, 'make-pair').task!.changeArgs?.map((a) => a.name)).toEqual(['a', 'b']);
    await send(kit, { type: 'task-args', step: 'make-pair', args: { b: 'When Mary and John went to the park, Mary gave a drink to' } });
    await send(kit, { type: 'task-run', step: 'make-pair' });
    const t = block(kit, 'make-pair').task!;
    expect(t.met).toBe(false);
    expect(t.message).toBe(lessonsCopy.constraintFails('how many words differ between the two Compare prompts'));
    // One word changed: the change is allowed (this stub's top guess doesn't move, so the target isn't met).
    await send(kit, { type: 'task-args', step: 'make-pair', args: { b: 'When Mary and John went to the store, Mary gave a drink to' } });
    await send(kit, { type: 'task-run', step: 'make-pair' });
    expect(block(kit, 'make-pair').task!.message).toBe(lessonsCopy.targetNotMet);
    expect(kit.sidecar.calls.filter((c) => c.endpoint === '/generate').some((c) => c.body.prompt.includes('Mary gave'))).toBe(true);
  });

  it('› P3.2 task rejects a run with two heads and accepts swapping A for B', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonFile('fixtures/outline-coverage/P3.2.md'), { source: { kind: 'bundled' }, sectionId: 's3-9' });
    const s = kit.host.analysis.state;
    const ablations = () => kit.sidecar.calls.filter((c) => c.endpoint === '/ablate-head').length;
    const before = ablations();
    s.headAblations = [{ layer: 9, head: 9 }, { layer: 9, head: 6 }];
    await send(kit, { type: 'task-predict', step: 'find-head', text: 'drops a lot' });
    await send(kit, { type: 'task-run', step: 'find-head' });
    expect(block(kit, 'find-head').task!.message).toBe(lessonsCopy.constraintFails('how many heads are knocked out'));
    expect(ablations()).toBe(before);
    s.headAblations = [{ layer: 9, head: 9 }];
    await send(kit, { type: 'task-run', step: 'find-head' });
    expect(ablations()).toBe(before + 1);
    s.headAblations = [{ layer: 9, head: 6 }]; // swap A for B
    await send(kit, { type: 'task-predict', step: 'find-head', text: 'drops less' });
    await send(kit, { type: 'task-run', step: 'find-head' });
    expect(ablations()).toBe(before + 2);
    expect(block(kit, 'find-head').task!.runs).toBe(2);
  });

  it('› cold_entry shows only without prerequisites', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(EARLIER), { source: { kind: 'bundled' } });
    expect(plainText(kit.runner.render().coldEntry!)).toContain('What you need from before');
    kit.progress.visitSection('pry.p2-1', 's3-1');
    expect(kit.runner.render().coldEntry).toBeNull();
    // Only on the first section.
    kit.progress.all['pry.p2-1'].sections = [];
    await kit.runner.goto(1);
    expect(kit.runner.render().coldEntry).toBeNull();
  });

  it('› explain-chain nudges once', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonFile('fixtures/outline-coverage/P3.2.md'), { source: { kind: 'bundled' }, sectionId: 's6' });
    const key = kit.runner.render().blocks.find((b) => b.kind === 'explain-chain')!.key;
    expect(block(kit, key).chain!.modelAnswer).toEqual([]);
    await send(kit, { type: 'chain-skip', step: key });
    expect(block(kit, key).chain!.nudging).toBe(true);
    expect(block(kit, key).chain!.skipped).toBe(false);
    await send(kit, { type: 'chain-skip', step: key });
    const c = block(kit, key).chain!;
    expect(c.nudging).toBe(false);
    expect(c.skipped).toBe(true);
    expect(plainText(c.modelAnswer)).toContain('Attention shows where a head drew from');
    expect(lessonsCopy.chainNudge).toBe('Writing it down is what makes it stick. Skip anyway?');
  });

  async function earlierTask() {
    const kit = makeKit();
    await kit.runner.open(lessonSource(EARLIER), { source: { kind: 'bundled' }, sectionId: 'task' });
    kit.host.analysis.state.headAblations = [{ layer: 3, head: 3 }];
    return kit;
  }

  it('› task checks its constraint list and offers reset', async () => {
    const kit = await earlierTask();
    kit.host.analysis.state.headAblations = [{ layer: 3, head: 3 }, { layer: 4, head: 4 }];
    await send(kit, { type: 'task-check', step: 'find' });
    expect(block(kit, 'find').task!.message).toBe(lessonsCopy.constraintFails('how many heads are knocked out'));
    expect(block(kit, 'find').task!.canReset).toBe(true);
    await send(kit, { type: 'task-reset', step: 'find' });
    expect(kit.host.analysis.state.headAblations).toEqual([]);
  });

  it('› task blocks a fifth run', async () => {
    const kit = await earlierTask();
    for (let i = 0; i < 4; i++) {
      await send(kit, { type: 'task-predict', step: 'find', text: `guess ${i}` });
      await send(kit, { type: 'task-run', step: 'find' });
    }
    expect(block(kit, 'find').task!.runs).toBe(4);
    await send(kit, { type: 'task-predict', step: 'find', text: 'one more' });
    await send(kit, { type: 'task-run', step: 'find' });
    expect(block(kit, 'find').task!.runs).toBe(4);
    expect(block(kit, 'find').task!.message).toBe(lessonsCopy.noRunsLeft(4));
    expect(block(kit, 'find').task!.canRun).toBe(false);
  });

  it('› task asks for a prediction before each run', async () => {
    const kit = await earlierTask();
    await send(kit, { type: 'task-run', step: 'find' });
    expect(block(kit, 'find').task!.message).toBe(lessonsCopy.predictFirst);
    expect(block(kit, 'find').task!.runs).toBe(0);
    await send(kit, { type: 'task-predict', step: 'find', text: 'it drops' });
    await send(kit, { type: 'task-run', step: 'find' });
    expect(block(kit, 'find').task!.runs).toBe(1);
    await send(kit, { type: 'task-run', step: 'find' }); // the prediction was for the last run
    expect(block(kit, 'find').task!.message).toBe(lessonsCopy.predictFirst);
    expect(block(kit, 'find').task!.runs).toBe(1);
  });

  it("› task remember writes the learner's head", async () => {
    const kit = await earlierTask();
    await send(kit, { type: 'task-predict', step: 'find', text: 'it drops' });
    await send(kit, { type: 'task-run', step: 'find' });
    await send(kit, 'next'); // moving on stores it (the stub's target isn't met)
    const e = kit.runner.journal.earlier('pry.fixture-earlier.found-head');
    expect(e?.value).toEqual([{ layer: 3, head: 3 }]);
    expect(kit.journal.entries.filter((x) => x.remember === 'pry.fixture-earlier.found-head')).toHaveLength(1);
    expect(IOI.length).toBeGreaterThan(0);
  });
});
