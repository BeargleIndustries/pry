import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonFile, lessonSource, makeKit, send, type Kit } from './test-kit';
import { EARLIER, FOLD, FRESH, GATED } from './fixtures';
import { pryToolSet } from '../registry/pry-set';
import type { RunnerJournalEntry } from './types';

afterEach(() => vi.unstubAllGlobals());

const snap = () => pryToolSet.snapshot();

function remember(kit: Kit, key: string, value: unknown, skipped = false) {
  kit.journal.write({
    id: key,
    at: '2026-10-13T10:00:00.000Z',
    lesson: { id: key.split('.').slice(0, 2).join('.'), version: '1', source: 'bundled' },
    sectionId: 's',
    stepId: 'x',
    kind: 'predict',
    question: '',
    answer: { pick: value },
    remember: key,
    skipped,
    committedAt: '2026-10-13T10:00:00.000Z',
  } as RunnerJournalEntry);
}

describe('section state', () => {
  it("› each explain-result section entered directly shows the previous section's state after its do steps", async () => {
    // P3.2 3.7 (the name movers, then the control, knocked out) -> 3.8 (its explain-result).
    const kit = makeKit();
    const lesson = lessonFile('fixtures/outline-coverage/P3.2.md');
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-8' });
    const s = snap();
    // control-knockout ran last: reset, then the three random heads on.
    expect(s.head_ablation).toEqual({ heads: [{ layer: 2, head: 3 }, { layer: 5, head: 7 }, { layer: 7, head: 1 }], on: true });
    expect(s.analyses).toContain('head_ablation');
    expect(kit.sidecar.calls.filter((c) => c.endpoint === '/ablate-head').length).toBeGreaterThan(0);
    // ...and the same scene as walking 3.7 forward and doing its steps.
    const walk = makeKit();
    await walk.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-7' });
    await send(walk, { type: 'do', step: 'movers-knockout' });
    await send(walk, { type: 'do', step: 'control-knockout' });
    const after = snap();
    await walk.runner.goto(walk.runner.sectionIndex('s3-8'));
    expect(snap()).toEqual(after);
  });

  it('› a learner-picked head carries to later sections until the task\'s reset', async () => {
    const kit = makeKit();
    remember(kit, 'pry.fixture-earlier.head', { layer: 4, head: 7 });
    const lesson = lessonSource(EARLIER);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'still' });
    expect(snap().head_ablation.heads).toEqual([{ layer: 4, head: 7 }]);
    await kit.runner.goto(kit.runner.sectionIndex('task'));
    expect(snap().head_ablation.heads).toEqual([{ layer: 4, head: 7 }]);
    await send(kit, { type: 'task-reset', step: 'find' });
    expect(snap().head_ablation).toEqual({ heads: [], on: false });
    // Skipped: the fallback head.
    const k2 = makeKit();
    remember(k2, 'pry.fixture-earlier.head', null, true);
    await k2.runner.open(lessonSource(EARLIER), { source: { kind: 'bundled' }, sectionId: 'knock' });
    expect(snap().head_ablation.heads).toEqual([{ layer: 9, head: 9 }]);
  });

  it("› the current section's do steps are not applied on entry", async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(FOLD), { source: { kind: 'bundled' }, sectionId: 'one' });
    expect(snap().left_panel).toBe('attention');
    await send(kit, { type: 'do', step: 'd1' });
    expect(snap().left_panel).toBe('dla');
    // Entering the next section replays it.
    await kit.runner.goto(1);
    expect(snap().left_panel).toBe('dla');
  });

  it('› a later enter opening panel Y beats an earlier do step opening panel X', async () => {
    // P1.6: 3.2 turns Compare off; a later enter turns it on.
    const kit = makeKit();
    const lesson = lessonSource(FOLD);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'four' });
    const s = snap();
    expect(s.compare_mode).toBe(true);
    expect(s.left_panel).toBe('patching');
    // The section before it (no enter of its own) shows its do step's panel.
    await kit.runner.goto(kit.runner.sectionIndex('three') + 0);
    await send(kit, { type: 'do', step: 'd3' });
    expect(snap().left_panel).toBe('logit-lens');
    expect(snap().compare_mode).toBe(false);
  });

  it('› reset: true partway replays no do step from before it', async () => {
    const kit = makeKit();
    const lesson = lessonSource(FOLD);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'five' });
    const s = snap();
    expect(s.head_ablation).toEqual({ heads: [], on: false });
    expect(s.compare_mode).toBe(false);
    expect(s.left_panel).toBe('attention');
    expect(s.run).toBe(false);
    expect(s.prompt).toBe('The cat sat on the');
    expect(kit.sidecar.calls.filter((c) => c.endpoint === '/ablate-head')).toHaveLength(1); // section four's, then reset
  });

  it('› replay skips an open_link do step', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(GATED), { source: { kind: 'bundled' }, sectionId: 'switch' });
    expect(kit.host.openLink).not.toHaveBeenCalled();
    expect(snap().left_panel).toBe('dla'); // the view action in the same step replayed
  });

  it('› replay stops at a switch_model to an unloaded model and shows the banner', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(GATED), { source: { kind: 'bundled' }, sectionId: 'end' });
    expect(kit.host.switchModel).not.toHaveBeenCalled();
    const step = kit.runner.render();
    expect(step.banner).toEqual({ model: 'pythia-70m' });
    // Later compute steps never ran on the wrong model.
    expect(kit.sidecar.calls.filter((c) => c.endpoint === '/logit-lens')).toHaveLength(0);
    // A switch to the model already loaded is a no-op.
    kit.host.page.active = 'pythia-70m';
    await kit.runner.goto(kit.runner.sectionIndex('end'));
    expect(kit.host.switchModel).not.toHaveBeenCalled();
    expect(kit.sidecar.calls.filter((c) => c.endpoint === '/logit-lens').length).toBeGreaterThan(0);
    // The banner now only notes the lesson's own model.
    expect(kit.runner.render().banner).toEqual({ model: 'GPT-2 small' });
  });

  it('› a fresh step with no capture replays once through the memo and stores no capture', async () => {
    const kit = makeKit();
    const lesson = lessonSource(FRESH);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'next' });
    const writes = () => kit.sidecar.calls.filter((c) => c.endpoint === '/generate' && c.body.max_new_tokens > 0);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].body.seed).toBe(7);
    expect(kit.runner.captures.has('a')).toBe(false);
    expect(kit.journal.entries.some((e) => e.capture)).toBe(false);
    await kit.runner.goto(0);
    await kit.runner.goto(1);
    expect(writes()).toHaveLength(1); // the memo answered
  });
});
