// Pure chapter navigation and saved progress for the guided tour. Plain TS so
// vitest can test it without the Svelte compiler; `tutorial-store.svelte.ts`
// holds the live state.

/** The smallest shape navigation needs: a chapter id and how many steps it has. */
export interface ChapterShape {
  id: string;
  steps: readonly unknown[];
}

export interface TourPos {
  chapter: number;
  step: number;
}

/** What is saved between sessions. `chapterId: null` means no place to resume. */
export interface TourProgress {
  chapterId: string | null;
  step: number;
  completed: string[];
}

export const TOUR_PROGRESS_KEY = 'pry:tour_progress';
/** Set once the tour has been seen or dismissed; gates the first-launch auto start. */
export const TOUR_SEEN_KEY = 'pry:tutorial_seen';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function emptyProgress(): TourProgress {
  return { chapterId: null, step: 0, completed: [] };
}

/** Read saved progress, dropping anything that no longer matches the chapters. */
export function loadProgress(
  chapters: readonly ChapterShape[],
  storage: StorageLike | null = defaultStorage(),
): TourProgress {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(TOUR_PROGRESS_KEY) ?? null;
  } catch {
    return emptyProgress();
  }
  if (!raw) return emptyProgress();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyProgress();
  }
  if (!parsed || typeof parsed !== 'object') return emptyProgress();
  const p = parsed as Partial<TourProgress>;
  const ids = new Set(chapters.map((c) => c.id));
  const completed = Array.isArray(p.completed)
    ? [...new Set(p.completed.filter((id): id is string => typeof id === 'string' && ids.has(id)))]
    : [];
  const chapter = chapters.find((c) => c.id === p.chapterId);
  const step = typeof p.step === 'number' && Number.isInteger(p.step) ? p.step : 0;
  if (!chapter || step < 0 || step >= chapter.steps.length) {
    return { chapterId: null, step: 0, completed };
  }
  return { chapterId: chapter.id, step, completed };
}

export function saveProgress(progress: TourProgress, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* storage full or blocked: progress just isn't remembered */
  }
}

/** Forget tour progress and the "seen" flag, so the tour starts fresh (and auto-starts next launch). */
export function clearProgress(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(TOUR_PROGRESS_KEY);
    storage?.removeItem(TOUR_SEEN_KEY);
  } catch {
    /* unavailable */
  }
}

export function totalSteps(chapters: readonly ChapterShape[]): number {
  return chapters.reduce((n, c) => n + c.steps.length, 0);
}

export function isLastPos(chapters: readonly ChapterShape[], pos: TourPos): boolean {
  return pos.chapter === chapters.length - 1 && pos.step === chapters[pos.chapter].steps.length - 1;
}

/** The step after `pos`, crossing into the next chapter; null at the very end. */
export function nextPos(chapters: readonly ChapterShape[], pos: TourPos): TourPos | null {
  const chapter = chapters[pos.chapter];
  if (!chapter) return null;
  if (pos.step < chapter.steps.length - 1) return { chapter: pos.chapter, step: pos.step + 1 };
  for (let c = pos.chapter + 1; c < chapters.length; c++) {
    if (chapters[c].steps.length > 0) return { chapter: c, step: 0 };
  }
  return null;
}

/** The step before `pos`, crossing back into the previous chapter; null at the very start. */
export function prevPos(chapters: readonly ChapterShape[], pos: TourPos): TourPos | null {
  if (pos.step > 0) return { chapter: pos.chapter, step: pos.step - 1 };
  for (let c = pos.chapter - 1; c >= 0; c--) {
    const n = chapters[c].steps.length;
    if (n > 0) return { chapter: c, step: n - 1 };
  }
  return null;
}

/** Where "Continue where you left off" goes, or null when there is nothing to continue. */
export function resumePos(chapters: readonly ChapterShape[], progress: TourProgress): TourPos | null {
  if (progress.chapterId === null) return null;
  const chapter = chapters.findIndex((c) => c.id === progress.chapterId);
  if (chapter < 0) return null;
  const pos = { chapter, step: progress.step };
  // The very first step is the same as starting over.
  if (chapter === 0 && pos.step === 0) return null;
  return pos;
}

export function withCompleted(progress: TourProgress, chapterId: string): TourProgress {
  if (progress.completed.includes(chapterId)) return progress;
  return { ...progress, completed: [...progress.completed, chapterId] };
}
