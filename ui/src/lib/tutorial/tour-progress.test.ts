import { describe, expect, it } from 'vitest';
import {
  TOUR_PROGRESS_KEY,
  TOUR_SEEN_KEY,
  clearProgress,
  emptyProgress,
  isLastPos,
  loadProgress,
  nextPos,
  prevPos,
  resumePos,
  saveProgress,
  totalSteps,
  withCompleted,
} from './tour-progress';

const chapters = [
  { id: 'a', steps: [1, 2, 3] },
  { id: 'b', steps: [1] },
  { id: 'c', steps: [1, 2] },
];

function memoryStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('navigation', () => {
  it('moves through steps and across chapter boundaries', () => {
    expect(nextPos(chapters, { chapter: 0, step: 0 })).toEqual({ chapter: 0, step: 1 });
    expect(nextPos(chapters, { chapter: 0, step: 2 })).toEqual({ chapter: 1, step: 0 });
    expect(nextPos(chapters, { chapter: 1, step: 0 })).toEqual({ chapter: 2, step: 0 });
    expect(nextPos(chapters, { chapter: 2, step: 1 })).toBeNull();
  });

  it('goes back across chapter boundaries to the last step', () => {
    expect(prevPos(chapters, { chapter: 2, step: 0 })).toEqual({ chapter: 1, step: 0 });
    expect(prevPos(chapters, { chapter: 1, step: 0 })).toEqual({ chapter: 0, step: 2 });
    expect(prevPos(chapters, { chapter: 0, step: 0 })).toBeNull();
  });

  it('knows the last position and the total', () => {
    expect(isLastPos(chapters, { chapter: 2, step: 1 })).toBe(true);
    expect(isLastPos(chapters, { chapter: 2, step: 0 })).toBe(false);
    expect(totalSteps(chapters)).toBe(6);
  });

  it('skips empty chapters', () => {
    const withEmpty = [{ id: 'a', steps: [1] }, { id: 'e', steps: [] }, { id: 'b', steps: [1] }];
    expect(nextPos(withEmpty, { chapter: 0, step: 0 })).toEqual({ chapter: 2, step: 0 });
    expect(prevPos(withEmpty, { chapter: 2, step: 0 })).toEqual({ chapter: 0, step: 0 });
  });
});

describe('saved progress', () => {
  it('round-trips through storage', () => {
    const s = memoryStorage();
    saveProgress({ chapterId: 'c', step: 1, completed: ['a', 'b'] }, s);
    expect(loadProgress(chapters, s)).toEqual({ chapterId: 'c', step: 1, completed: ['a', 'b'] });
  });

  it('is empty when nothing is saved or the data is junk', () => {
    expect(loadProgress(chapters, memoryStorage())).toEqual(emptyProgress());
    expect(loadProgress(chapters, memoryStorage({ [TOUR_PROGRESS_KEY]: '{not json' }))).toEqual(emptyProgress());
    expect(loadProgress(chapters, memoryStorage({ [TOUR_PROGRESS_KEY]: '42' }))).toEqual(emptyProgress());
    expect(loadProgress(chapters, null)).toEqual(emptyProgress());
  });

  it('drops chapters and steps that no longer exist, keeping the rest', () => {
    const s = memoryStorage({
      [TOUR_PROGRESS_KEY]: JSON.stringify({ chapterId: 'b', step: 5, completed: ['a', 'gone', 'a', 3] }),
    });
    expect(loadProgress(chapters, s)).toEqual({ chapterId: null, step: 0, completed: ['a'] });
    const s2 = memoryStorage({ [TOUR_PROGRESS_KEY]: JSON.stringify({ chapterId: 'removed', step: 0, completed: [] }) });
    expect(loadProgress(chapters, s2).chapterId).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadProgress(chapters, broken)).toEqual(emptyProgress());
    expect(() => saveProgress(emptyProgress(), broken)).not.toThrow();
    expect(() => clearProgress(broken)).not.toThrow();
  });

  it('reset clears progress and the seen flag', () => {
    const s = memoryStorage({ [TOUR_PROGRESS_KEY]: '{}', [TOUR_SEEN_KEY]: 'true', other: 'kept' });
    clearProgress(s);
    expect(s.data.has(TOUR_PROGRESS_KEY)).toBe(false);
    expect(s.data.has(TOUR_SEEN_KEY)).toBe(false);
    expect(s.data.get('other')).toBe('kept');
  });
});

describe('resume and completion', () => {
  it('resumes at the saved place', () => {
    expect(resumePos(chapters, { chapterId: 'c', step: 1, completed: [] })).toEqual({ chapter: 2, step: 1 });
  });

  it('has nothing to resume at the very start, after finishing, or for unknown chapters', () => {
    expect(resumePos(chapters, { chapterId: 'a', step: 0, completed: [] })).toBeNull();
    expect(resumePos(chapters, { chapterId: null, step: 0, completed: ['a', 'b', 'c'] })).toBeNull();
    expect(resumePos(chapters, { chapterId: 'zzz', step: 0, completed: [] })).toBeNull();
  });

  it('marks a chapter completed once', () => {
    const p = withCompleted(emptyProgress(), 'a');
    expect(p.completed).toEqual(['a']);
    expect(withCompleted(p, 'a')).toBe(p);
  });
});
