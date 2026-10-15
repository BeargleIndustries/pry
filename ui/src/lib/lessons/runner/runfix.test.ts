// First-timer rubric fixes, runtime half (plan T8 step 6): what the learner
// sees must belong to the step on screen and to the run it talks about.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonFile, lessonSource, makeKit, send, type Kit } from './test-kit';
import { plainText, type RenderedBlock } from '../render';
import { lessonsCopy } from '../copy';
import { allSteps } from '../format/normalise';
import { pryToolSet } from '../registry/pry-set';
import { pryUi } from '../registry/pry-state.svelte';

afterEach(() => vi.unstubAllGlobals());

function block(kit: Kit, key: string): RenderedBlock {
  const flat = (bs: RenderedBlock[]): RenderedBlock[] => bs.flatMap((b) => [b, ...flat(b.children)]);
  const b = flat(kit.runner.render().blocks).find((x) => x.key === key || x.stepId === key);
  if (!b) throw new Error(`no block ${key}`);
  return b;
}

const TWO_RUNS = `---
format: 1
id: pry.fixture-runfix
title: "Runfix fixture"
tool: pry
summary: "Runner fixture."
minutes: 1
model: gpt2-small
baseline: { prompt: "The capital of France is" }
---

## Two runs {id=two}

:::slots
now: { read: prediction, args: { token: " now" }, field: prob, expect: 0.047506 }
:::

:::predict{id=top checks=obs1}
Top word?

\`\`\`yaml
choices:
  - { text: "\\" Paris\\"", feedback: "The model went another way: ' now' got {now}." }
  - { text: "something else" }
\`\`\`
:::

:::do{id=run1}
The lesson runs it. Read :look{at=predictions-panel}[Predictions].

\`\`\`actions
- run: {}
\`\`\`
:::

:::observe{id=obs1}
\`\`\`yaml
check: { read: top_guess.token, op: equals, value: " now" }
\`\`\`
:::

:::do{id=run2}
Now add three words and run it again.

\`\`\`actions
- set_prompt: { text: "The capital of France is the city of" }
- run: {}
\`\`\`
:::

## Next {id=next}

:::explain
Nothing to point at here.
:::
`;

describe('runfix', () => {
  it('› choice feedback waits for the observe it checks, so its slots never show before the run', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(TWO_RUNS), { source: { kind: 'bundled' } });
    await send(kit, { type: 'answer', step: 'top', choice: 0 });
    expect(block(kit, 'top').ask?.feedback).toBeNull();
    await send(kit, { type: 'do', step: 'run1' });
    expect(block(kit, 'top').ask?.feedback).toBeNull();
    await send(kit, { type: 'show', step: 'obs1' });
    const fb = plainText(block(kit, 'top').ask?.feedback ?? []);
    expect(fb).toContain('4.8% (about 1 in 21)');
    expect(fb).not.toContain('appears after');
  });

  it('› a later do step does not re-check an earlier observe against its own run', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(TWO_RUNS), { source: { kind: 'bundled' } });
    await send(kit, { type: 'answer', step: 'top', choice: 1 });
    await send(kit, { type: 'do', step: 'run1' });
    await send(kit, { type: 'show', step: 'obs1' });
    expect(block(kit, 'obs1').observe?.result?.agrees).toBe(true);
    await send(kit, { type: 'do', step: 'run2' });
    expect(block(kit, 'obs1').observe?.result?.agrees).toBe(true);
  });

  it('› a run result stops reading once the prompt box says something else', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(TWO_RUNS), { source: { kind: 'bundled' } });
    await send(kit, { type: 'do', step: 'run1' });
    expect(pryToolSet.readouts['top_guess.token'].read()).toBe(' now');
    kit.host.setPrompt('Humans only use ten percent of their');
    expect(pryToolSet.readouts['top_guess.token'].read()).toBeUndefined();
    expect(pryToolSet.readouts['top_guess.prob'].read()).toBeUndefined();
  });

  it('› pointers clear on section change, including one a highlight put up', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(TWO_RUNS), { source: { kind: 'bundled' } });
    await send(kit, { type: 'answer', step: 'top', choice: 1 });
    await send(kit, { type: 'look', at: [{ anchor: 'copying-heads-view' }] });
    expect(kit.presenter.pointers).toEqual([{ anchor: 'copying-heads-view' }]);
    await send(kit, 'next');
    expect(kit.presenter.pointers).toEqual([]);
    expect(kit.runner.render().entering).toBe(false);
  });

  it('› :look args resolve $row values before pointing (feature-row id=$row.25.target_id)', async () => {
    const lesson = lessonFile('../../lessons/pry.p3-5/lesson.md');
    const kit = makeKit();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: lesson.sections[0].id });
    const looks = kit.runner.activeLooks(kit.runner.render());
    const row = looks.find((t) => 'anchor' in t && t.anchor === 'feature-row');
    if (row) expect(typeof (row.args as { id: unknown }).id).toBe('number');
    for (const t of looks) expect(JSON.stringify(t)).not.toContain('$row');
  });

  it('› the task form starts from its reset values with $row constants resolved', async () => {
    const lesson = lessonFile('../../lessons/pry.p3-5/lesson.md');
    const sec = lesson.sections.find((s) => allSteps(s.steps).some((st) => st.id === 'find-strength'))!;
    const kit = makeKit();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: sec.id });
    const args = block(kit, 'find-strength').task?.changeArgs ?? [];
    expect(args.map((a) => a.name)).toEqual(['feature_id', 'strength']);
    expect(args[0].value).toMatch(/^\d+$/);
    expect(args[1].value).toBe('0');
  });

  it('› a task run refuses to start with an unresolved value or an empty prompt, in plain words', async () => {
    const lesson = lessonFile('../../lessons/pry.p3-5/lesson.md');
    const sec = lesson.sections.find((s) => allSteps(s.steps).some((st) => st.id === 'find-strength'))!;
    const kit = makeKit();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: sec.id });
    await send(kit, { type: 'task-predict', step: 'find-strength', text: 'rain shows up' });
    await send(kit, { type: 'task-args', step: 'find-strength', args: { feature_id: '$row.25.target_id' } });
    await send(kit, { type: 'task-run', step: 'find-strength' });
    expect(block(kit, 'find-strength').task?.message).toBe(lessonsCopy.taskArgsMissing);
    expect(block(kit, 'find-strength').task?.runs).toBe(0);
    await send(kit, { type: 'task-args', step: 'find-strength', args: { feature_id: '21791', strength: '25' } });
    kit.host.setPrompt('');
    await send(kit, { type: 'task-run', step: 'find-strength' });
    const msg = block(kit, 'find-strength').task?.message ?? '';
    expect(msg.startsWith('Not there yet.')).toBe(true);
    expect(msg).toContain('prompt box is empty');
    expect(msg).not.toMatch(/failed|400/);
  });

  it('› the embedding reader mounts under the step that points at it, once per section', async () => {
    const lesson = lessonFile('../../lessons/pry.p1-2/lesson.md');
    const sec = lesson.sections.find((s) => s.title === 'Same start?')!;
    const kit = makeKit();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: sec.id });
    const flat = (bs: RenderedBlock[]): RenderedBlock[] => bs.flatMap((b) => [b, ...flat(b.children)]);
    const mounts = flat(kit.runner.render().blocks).filter((b) => b.mount);
    expect(mounts.map((b) => b.mount!.view)).toEqual(['embedding-compare']);
  });

  it('› the honesty box carries the latest leaves_open into a section without its own', async () => {
    const lesson = lessonFile('../../lessons/pry.p1-1/lesson.md');
    const withResult = lesson.sections.findIndex((s) => allSteps(s.steps).some((st) => st.kind === 'explain-result'));
    const after = lesson.sections.findIndex(
      (s, i) => i > withResult && !allSteps(s.steps).some((st) => st.kind === 'explain-result' || st.kind === 'transfer'),
    );
    expect(after).toBeGreaterThan(withResult);
    const kit = makeKit();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: lesson.sections[after].id });
    const h = kit.runner.render().honesty;
    expect(h).not.toBeNull();
    expect((h!.leavesOpen.length + h!.limits.length) > 0).toBe(true);
  });

  it('› a compute action brings its result tab forward and leaves Compare (Swap test, Watch it write)', async () => {
    const kit = makeKit();
    const lesson = lessonSource(`---
format: 1
id: pry.fixture-show
title: "Show fixture"
tool: pry
summary: "Runner fixture."
minutes: 1
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
---

## Swap {id=swap}

:::do{id=swap-run}
The lesson runs the Swap test.

\`\`\`actions
- set_compare_mode: { on: true }
- run_patching: { clean: "When Mary and John went to the store, John gave a drink to", corrupted: "When Mary and John went to the store, Mary gave a drink to", type: head }
\`\`\`
:::

:::do{id=write}
The lesson writes on.

\`\`\`actions
- write_it: { temperature: 0 }
\`\`\`
:::
`);
    await kit.runner.open(lesson, { source: { kind: 'bundled' } });
    await send(kit, { type: 'do', step: 'swap-run' });
    expect(kit.host.page.compareMode).toBe(false);
    expect(kit.host.getLeftTab()).toBe('patching');
    await send(kit, { type: 'do', step: 'write' });
    expect(kit.host.getRightTab()).toBe('predictions');
  });

  it('› a scene whose enter opens a right-side panel brings the right half forward in the one-panel layout', async () => {
    const kit = makeKit();
    pryUi.workspaceSplit = false;
    try {
      const lesson = lessonSource(`---
format: 1
id: pry.fixture-front
title: "Front fixture"
tool: pry
summary: "Runner fixture."
minutes: 1
model: gpt2-small
baseline: { prompt: "The capital of France is", run: true }
---

## Predictions {id=p}

:::enter
open_panel: predictions
:::

:::explain
Read :look{at=predictions-panel}[Predictions].
:::
`);
      await kit.runner.open(lesson, { source: { kind: 'bundled' } });
      expect(kit.host.getRightTab()).toBe('predictions');
      expect(kit.host.page.front).toBe('right');
    } finally {
      pryUi.workspaceSplit = true;
    }
  });
});
