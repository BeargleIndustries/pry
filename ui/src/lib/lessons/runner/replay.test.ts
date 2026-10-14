import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonFile, lessonSource, makeKit, send, type Kit } from './test-kit';
import { FOLD, FRESH, GATED, STEER } from './fixtures';
import { pryToolSet } from '../registry/pry-set';
import { lessonsCopy } from '../copy';
import type { RunnerJournalEntry } from './types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const snap = () => pryToolSet.snapshot();

/** A small seeded generator, so a failing order can be replayed. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function answers(kit: Kit) {
  // Journal answers fixed for the whole run (P3.2 reads three P2.1 keys).
  const at = '2026-10-13T09:00:00.000Z';
  const base = { at, committedAt: at, sectionId: 's', stepId: 'x', kind: 'predict' as const, question: '', skipped: false };
  kit.journal.write({ ...base, id: '1', lesson: { id: 'pry.p2-1', version: '1', source: 'bundled' }, remember: 'pry.p2-1.head-pick', answer: { pick: { layer: 4, head: 4 } } } as RunnerJournalEntry);
  kit.journal.write({ ...base, id: '2', lesson: { id: 'pry.p2-1', version: '1', source: 'bundled' }, remember: 'pry.p2-1.word-pick', answer: { choice: ' John' } } as RunnerJournalEntry);
  kit.journal.write({ ...base, id: '3', lesson: { id: 'pry.p2-1', version: '1', source: 'bundled' }, remember: 'pry.p2-1.hypothesis', answer: { text: 'it copies the name' } } as RunnerJournalEntry);
}

describe('replay', () => {
  it('› 50 random orders end in the same state as in order', async () => {
    const lesson = lessonFile('fixtures/outline-coverage/P3.2.md');
    const kit = makeKit();
    answers(kit);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: lesson.sections[0].id });
    const ref: unknown[] = [];
    for (let i = 0; i < lesson.sections.length; i++) {
      await kit.runner.goto(i);
      ref.push(snap());
    }
    const r = rng(20261014);
    const idx = lesson.sections.map((_, i) => i);
    for (let order = 0; order < 50; order++) {
      for (const i of shuffle(idx, r).slice(0, 5)) {
        await kit.runner.goto(i);
        expect({ order, section: i, s: snap() }).toEqual({ order, section: i, s: ref[i] });
      }
    }
  }, 120000);

  it('› mid-scene navigation (2s) ends on the newest section', async () => {
    vi.useFakeTimers();
    const kit = makeKit({ latency: (e) => (e === '/generate' ? 2000 : 0) });
    const lesson = lessonSource(FOLD);
    const opening = kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'one' }); // needs a 2s Run
    await vi.advanceTimersByTimeAsync(500);
    expect(kit.presenter.step?.busy).toBe(lessonsCopy.settingUp); // shown past 300ms
    const jump = kit.runner.goto(4); // "Back to the start": the baseline, not run
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([opening, jump]);
    expect(kit.runner.index).toBe(4);
    expect(snap().run).toBe(false);
    expect(kit.presenter.step?.section.id).toBe('five');
    expect(kit.presenter.step?.busy).toBeNull();
  });

  it('› a late response is dropped', async () => {
    vi.useFakeTimers();
    // The first section's Run answers late; the jump's scene needs none.
    const kit = makeKit({ latency: (e, b) => (e === '/generate' && b?.prompt === 'The cat sat on the' ? 3000 : 0) });
    const lesson = lessonSource(FOLD);
    const opening = kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'one' });
    await vi.advanceTimersByTimeAsync(100);
    const jump = kit.runner.goto(4);
    await vi.advanceTimersByTimeAsync(4000);
    await Promise.all([opening, jump]);
    // The late Run landed, then the newer section's scene put the app back.
    expect(kit.host.analysis.state.response).toBeNull();
    expect(snap().run).toBe(false);
    expect(kit.runner.index).toBe(4);
  });

  it('› zero sidecar calls on Back into steering', async () => {
    const kit = makeKit();
    const lesson = lessonSource(STEER);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'steer' });
    await send(kit, { type: 'do', step: 's1' });
    await kit.runner.goto(1);
    await kit.runner.goto(2);
    const n = kit.sidecar.calls.length;
    await send(kit, 'back');
    await send(kit, 'back');
    expect(kit.runner.index).toBe(0);
    expect(kit.sidecar.calls.length).toBe(n);
  });

  it("› a section without enter opens on the previous section's after-do state", async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(FOLD), { source: { kind: 'bundled' }, sectionId: 'two' });
    expect(snap().left_panel).toBe('dla');
    expect(snap().run).toBe(true);
  });

  it('› reset: true opens on the baseline', async () => {
    const kit = makeKit();
    const lesson = lessonSource(FOLD);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'five' });
    const fresh = makeKit();
    await fresh.runner.open(lessonSource(`${FOLD.split('## Run it')[0]}## Only {id=only}\n\n:::explain\nBaseline.\n:::\n`), { source: { kind: 'bundled' } });
    const baseline = snap();
    await kit.runner.goto(4);
    expect(snap()).toEqual(baseline);
  });

  it('› a model download is not cancelled by navigation', async () => {
    vi.useFakeTimers();
    const kit = makeKit();
    let finished = false;
    kit.host.switchModel.mockImplementation(async (id: string) => {
      await new Promise((r) => setTimeout(r, 5000));
      kit.host.page.active = id;
      kit.host.analysis.clearForModelSwitch();
      finished = true;
    });
    const lesson = lessonSource(GATED);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'switch' });
    const doing = send(kit, { type: 'do', step: 'to-medium' });
    await vi.advanceTimersByTimeAsync(1000);
    const away = kit.runner.goto(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(kit.presenter.step?.busy).toBe(lessonsCopy.waitingForModel);
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all([doing, away]);
    expect(finished).toBe(true);
    expect(kit.host.page.active).toBe('pythia-70m');
    expect(kit.runner.index).toBe(0);
  });

  it('› no drift chip after Do it', async () => {
    const kit = makeKit();
    await kit.runner.open(lessonSource(FOLD), { source: { kind: 'bundled' }, sectionId: 'one' });
    expect(kit.runner.render().drift).toBe(false);
    await send(kit, { type: 'do', step: 'd1' });
    expect(kit.runner.render().drift).toBe(false);
    // The learner opens another tab: the chip shows.
    kit.host.page.leftTab = 'circuit';
    expect(kit.runner.render().drift).toBe(true);
    await send(kit, { type: 'fix-drift' });
    expect(kit.runner.render().drift).toBe(false);
  });

  it('› an answered observe shows the recorded result', async () => {
    const kit = makeKit();
    const lesson = lessonSource(FOLD);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'one' });
    await send(kit, { type: 'answer', step: 'p1', choice: 0 });
    await send(kit, { type: 'do', step: 'd1' });
    await send(kit, { type: 'show', step: 'o1' });
    const first = kit.runner.render().blocks.find((b) => b.key === 'o1')!.observe!;
    expect(first.result?.text).toBe(lessonsCopy.agreesPrediction);
    // A later visit: "Last time: ..." until its do step runs again.
    await kit.runner.goto(1);
    await kit.runner.goto(0);
    const again = kit.runner.render().blocks.find((b) => b.key === 'o1')!.observe!;
    expect(again.revealed).toBe(false);
    expect(again.result?.last).toBe(true);
    expect(again.result?.text).toBe('Last time: the app agrees with your prediction.');
  });

  it('› a fresh step replays through the memo on navigation; an existing capture is unchanged', async () => {
    const kit = makeKit();
    const lesson = lessonSource(FRESH);
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 'write' });
    await send(kit, { type: 'do', step: 'wa' });
    const writes = () => kit.sidecar.calls.filter((c) => c.endpoint === '/generate' && c.body.max_new_tokens > 0);
    expect(writes()).toHaveLength(1);
    expect(kit.runner.captures.has("a")).toBe(true);
    // Pressed again: fresh calls the sidecar again.
    await send(kit, { type: 'do', step: 'wa' });
    expect(writes()).toHaveLength(2);
    const second = JSON.stringify(kit.runner.captures.get('a'));
    await kit.runner.goto(1); // replays `wa` through the memo
    expect(writes()).toHaveLength(2);
    expect(JSON.stringify(kit.runner.captures.get('a'))).toBe(second);
  });
});
