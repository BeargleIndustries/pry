// Lesson progress and the 0.3.8 -> 0.4.0 migration (plan T7b "Progress migration").
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import {
  CHAPTER_LESSONS,
  LESSON_LAST_KEY,
  MIGRATED_KEY,
  TOUR_PROGRESS_KEY,
  TOUR_SEEN_KEY,
  createProgress,
  migrateExperiments,
  migrateTourProgress,
  tourAutoStarts,
} from './progress';
import { lessonFile, makeKit } from './runner/test-kit';

afterEach(() => vi.unstubAllGlobals());

function kv(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const tour = (p: { chapterId?: string | null; step?: number; completed?: string[] }) =>
  JSON.stringify({ chapterId: p.chapterId ?? null, step: p.step ?? 0, completed: p.completed ?? [] });

describe('progress', () => {
  it('› guesses chapter marks pry.p1-4 and pry.p2-3 visited', () => {
    const store = kv({ [TOUR_PROGRESS_KEY]: tour({ completed: ['guesses'] }) });
    const r = migrateTourProgress(store);
    expect(r).toEqual({ ran: true, hadTour: true, lessons: ['pry.p1-4', 'pry.p2-3'] });
    const p = createProgress(store);
    expect(p.visited('pry.p1-4')).toBe(true);
    expect(p.visited('pry.p2-3')).toBe(true);
    expect(p.visited('pry.p2-1')).toBe(false);
    expect(store.getItem(LESSON_LAST_KEY)).toBe('pry.p2-3');
  });

  it('maps every chapter as the plan lists, the current chapter included', () => {
    expect(CHAPTER_LESSONS).toEqual({
      basics: ['pry.quick-tour'],
      attention: ['pry.p2-1', 'pry.p2-2'],
      guesses: ['pry.p1-4', 'pry.p2-3'],
      responsible: ['pry.p2-4', 'pry.p3-7'],
      poke: ['pry.p3-2', 'pry.p3-3'],
      concepts: ['pry.p2-5', 'pry.p3-4', 'pry.p3-5'],
      compare: ['pry.p3-1'],
      lab: [],
      models: [],
    });
    const store = kv({ [TOUR_PROGRESS_KEY]: tour({ chapterId: 'poke', step: 2, completed: ['basics', 'models'] }) });
    expect(migrateTourProgress(store).lessons).toEqual(['pry.quick-tour', 'pry.p3-2', 'pry.p3-3']);
    const p = createProgress(store);
    // basics: the quick-tour stops it covered count as seen.
    expect(p.of('pry.quick-tour')?.sections).toEqual(['step-1', 'step-2', 'step-3', 'step-4', 'step-6', 'step-12']);
    expect(store.getItem(LESSON_LAST_KEY)).toBe('pry.p3-3');
  });

  it('› a migrated lesson still shows its cold_entry', async () => {
    const kit = makeKit();
    migrateTourProgress(kv({ [TOUR_PROGRESS_KEY]: tour({ completed: ['attention'] }) }), kit.progress);
    // Visited for the picker...
    expect(kit.progress.visited('pry.p2-1')).toBe(true);
    // ...but not opened, so pry.p2-2 (prerequisite pry.p2-1) still shows its cold entry.
    expect(kit.progress.opened('pry.p2-1')).toBe(false);
    const lesson = lessonFile('../../lessons/pry.p2-2/lesson.md');
    expect(lesson.meta.prerequisites).toEqual(['pry.p2-1']);
    expect(lesson.meta.cold_entry).toBeTruthy();
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: lesson.sections[0].id });
    expect(kit.runner.render().coldEntry).not.toBeNull();
    // Once pry.p2-1 is really opened in Lessons, the cold entry goes.
    kit.progress.visitSection('pry.p2-1', 's1');
    expect(kit.progress.opened('pry.p2-1')).toBe(true);
    expect(kit.runner.render().coldEntry).toBeNull();
  });

  it('› tutorial_seen suppresses auto-open', () => {
    expect(tourAutoStarts(kv())).toBe(true);
    expect(tourAutoStarts(kv({ [TOUR_SEEN_KEY]: 'true' }))).toBe(false);
    // Old-tour learners get the Lessons-toggle tip instead of an auto-started tour.
    const old = kv({ [TOUR_PROGRESS_KEY]: tour({ completed: ['basics'] }) });
    expect(tourAutoStarts(old)).toBe(false);
    migrateTourProgress(old);
    expect(old.getItem('pry:tip_seen:lessons-toggle')).toBeNull();
    expect(tourAutoStarts(old)).toBe(false);
    // Without tour progress the Lessons-toggle tip never shows, and seen still wins after migrating.
    const fresh = kv({ [TOUR_SEEN_KEY]: 'true' });
    migrateTourProgress(fresh);
    expect(fresh.getItem('pry:tip_seen:lessons-toggle')).toBe('true');
    expect(tourAutoStarts(fresh)).toBe(false);
  });

  it('› old keys untouched', () => {
    const before = { [TOUR_PROGRESS_KEY]: tour({ chapterId: 'concepts', step: 3, completed: ['basics', 'guesses'] }), [TOUR_SEEN_KEY]: 'true' };
    const store = kv(before);
    migrateTourProgress(store);
    expect(store.getItem(TOUR_PROGRESS_KEY)).toBe(before[TOUR_PROGRESS_KEY]);
    expect(store.getItem(TOUR_SEEN_KEY)).toBe('true');
    expect(store.getItem(MIGRATED_KEY)).toBe('true');
    // Runs once: a second launch changes nothing.
    const snap = new Map(store.m);
    expect(migrateTourProgress(store).ran).toBe(false);
    expect(new Map(store.m)).toEqual(snap);
  });

  it('marks the lessons of 0.3.8 experiments the learner ran, never over real progress', () => {
    const store = kv();
    const p = createProgress(store);
    p.visitSection('pry.p3-2', 's3-6');
    // notebook.ts lessonIdForExperiment: induction -> pry.p2-2, ioi-knockout -> pry.p3-2, unknown -> null.
    expect(migrateExperiments(['pry.p2-2', 'pry.p3-2', 'pry.p2-2', null], p)).toEqual(['pry.p2-2', 'pry.p3-2']);
    expect(p.visited('pry.p2-2')).toBe(true);
    expect(p.opened('pry.p2-2')).toBe(false);
    expect(p.opened('pry.p3-2')).toBe(true);
    expect(p.of('pry.p3-2')?.sections).toEqual(['s3-6']);
  });
});
