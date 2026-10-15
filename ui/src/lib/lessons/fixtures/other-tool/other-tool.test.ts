import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLessonSource } from '../../format/normalise';
import { lintLesson } from '../../format/lint';
import { createDispatcher } from '../../registry/dispatcher';
import { RequestMemo } from '../../registry/memo';
import { otherApp, otherTool, resetOtherApp } from './tool';
import { createRunner } from '../../runner/runner.svelte';
import { memoryJournal } from '../../runner/types';

const SOURCE = readFileSync(fileURLToPath(new URL('./lesson.md', import.meta.url)), 'utf-8');

beforeEach(resetOtherApp);

// Plan T2 acceptance (contract.test.ts names it): a fixture non-Pry
// ToolActionSet lints and runs fixtures/other-tool/lesson.md: lint, dispatch,
// and the runner's replay with back/forward (T3).
describe('a non-Pry tool', () => {
  it('has 2 actions, 1 readout, 1 view and fake state', () => {
    expect(Object.keys(otherTool.actions)).toHaveLength(2);
    expect(Object.keys(otherTool.readouts)).toHaveLength(1);
    expect(Object.keys(otherTool.views)).toHaveLength(1);
    expect(otherTool.snapshot()).toEqual({ input: '', output: null });
  });

  it('› lints fixtures/other-tool/lesson.md clean', () => {
    const { lesson, issues } = loadLessonSource(SOURCE, { tool: otherTool });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(lesson).not.toBeNull();
    const lint = lintLesson(lesson!, { tool: otherTool });
    expect(lint.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('› dispatches the lesson\'s do steps through the real dispatcher', async () => {
    const { lesson } = loadLessonSource(SOURCE, { tool: otherTool });
    const d = createDispatcher(otherTool, new RequestMemo(), { kind: 'bundled' });
    const signal = new AbortController().signal;
    // Section 1's do step, as the runner would issue it.
    await d.dispatch('set_input', { text: 'hello' }, { signal });
    await d.dispatch('run', {}, { signal });
    expect(otherTool.readouts.result.read()).toBe('HELLO');
    // Section 2's enter, then its do step.
    await otherTool.apply(otherTool.target({ input: 'hello' }, { input: 'bank' }, otherTool.snapshot()), { signal, wait() {} });
    await d.dispatch('run', {}, { signal });
    expect(otherApp.output).toBe('BANK');
    expect(lesson?.sections.length).toBe(2);
  });

  it('runs fixtures/other-tool/lesson.md through the real runner with back/forward replay', async () => {
    const { lesson } = loadLessonSource(SOURCE, { tool: otherTool });
    const runner = createRunner({ set: otherTool, memo: new RequestMemo(), journal: memoryJournal(), currentModel: () => 'tiny' });
    await runner.open(lesson!, { source: { kind: 'bundled' } });
    // Section 1 opens on the baseline; its own do step waits for the learner.
    expect(otherTool.snapshot()).toEqual({ input: 'hello', output: null });
    await runner.answer('guess', { choice: 0 });
    await runner.doStep('go');
    await runner.showObserve('look');
    const obs = runner.render().blocks.find((b) => b.key === 'look')!.observe!;
    expect(obs.result?.agrees).toBe(true);
    // Section 2: section 1's do step replays, then its own enter applies.
    await runner.next();
    expect(otherTool.snapshot()).toEqual({ input: 'bank', output: 'HELLO' });
    // Back: section 1 again, as it opened.
    await runner.back();
    expect(otherTool.snapshot()).toEqual({ input: 'hello', output: null });
    // Forward cold: the same section 2 state.
    resetOtherApp();
    await runner.goto(1);
    expect(otherTool.snapshot()).toEqual({ input: 'bank', output: 'HELLO' });
  });
});
