import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonFile, lessonSource, makeKit, send } from './test-kit';
import { FOLD } from './fixtures';
import { earlierText } from './earlier';
import { memoryJournal, type RunnerJournalEntry } from './types';
import { lessonsCopy } from '../copy';
import type { RNode } from '../render';

afterEach(() => vi.unstubAllGlobals());

function entry(key: string, answer: RunnerJournalEntry['answer'], skipped = false): RunnerJournalEntry {
  return {
    id: key,
    at: '2026-10-13T10:00:00.000Z',
    lesson: { id: 'pry.p2-1', version: '1', source: 'bundled' },
    sectionId: 's',
    stepId: 'x',
    kind: 'predict',
    question: '',
    answer,
    remember: key,
    skipped,
    committedAt: '2026-10-13T10:00:00.000Z',
  };
}

const earlierNodes = (nodes: RNode[]): { text: string; state: string }[] => {
  const out: { text: string; state: string }[] = [];
  const walk = (ns: RNode[]) => {
    for (const n of ns) {
      if (n.t === 'earlier') out.push({ text: n.text, state: n.state });
      if ('children' in n) walk(n.children);
    }
  };
  walk(nodes);
  return out;
};

describe(':earlier', () => {
  it("› shows the learner's own words", async () => {
    const j = memoryJournal();
    j.write(entry('pry.p2-1.hypothesis', { text: 'the head copies the name' }));
    expect(earlierText(j, 'pry.p2-1.hypothesis', 'skipped')).toEqual({ text: 'the head copies the name', state: 'answer' });
    j.write(entry('pry.p2-1.head-pick', { pick: { layer: 9, head: 9 } }));
    expect(earlierText(j, 'pry.p2-1.head-pick').text).toBe('L9H9');
    // Through the runner, in P3.2's recall.
    const kit = makeKit();
    kit.journal.write(entry('pry.p2-1.word-pick', { choice: ' Mary' }));
    await kit.runner.open(lessonFile('fixtures/outline-coverage/P3.2.md'), { source: { kind: 'bundled' }, sectionId: 's3-1' });
    const shown = earlierNodes(kit.runner.render().blocks.flatMap((b) => b.body));
    expect(shown[0]).toEqual({ text: ' Mary', state: 'answer' });
  });

  it('› shows "skipped"', async () => {
    const j = memoryJournal();
    j.write(entry('pry.p2-1.hypothesis', {}, true));
    expect(earlierText(j, 'pry.p2-1.hypothesis', 'skipped')).toEqual({ text: 'skipped', state: 'skipped' });
    expect(earlierText(j, 'pry.p2-1.hypothesis', '')).toEqual({ text: lessonsCopy.skipped, state: 'skipped' });
    // A skipped predict writes the skip under its remember key.
    const kit = makeKit();
    await kit.runner.open(lessonSource(FOLD), { source: { kind: 'bundled' } });
    await send(kit, { type: 'skip', step: 'p1' });
    expect(kit.journal.entries.find((e) => e.remember === 'pry.fixture-fold.first-guess')?.skipped).toBe(true);
    expect(earlierText(kit.runner.journal, 'first-guess', 'skipped')).toEqual({ text: 'skipped', state: 'skipped' });
  });

  it('› shows "You haven\'t done that lesson yet"', async () => {
    expect(earlierText(memoryJournal(), 'pry.p2-1.hypothesis', 'skipped')).toEqual({ text: "You haven't done that lesson yet", state: 'missing' });
    const kit = makeKit();
    await kit.runner.open(lessonFile('fixtures/outline-coverage/P3.2.md'), { source: { kind: 'bundled' }, sectionId: 's3-1' });
    const shown = earlierNodes(kit.runner.render().blocks.flatMap((b) => b.body));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((s) => s.text === lessonsCopy.notYet && s.state === 'missing')).toBe(true);
  });
});
