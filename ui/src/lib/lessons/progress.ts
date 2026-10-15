// Lesson progress (plan T3: "progress in `pry:lesson_progress`"; format
// versioning: "Progress keys on lesson id + step id"). localStorage, read and
// written in try/catch: a blocked store just means no remembered progress.

export const PROGRESS_KEY = 'pry:lesson_progress';

export interface LessonProgress {
  /** Section ids the learner has opened. */
  sections: string[];
  /** Step ids the learner has finished (answered, done, skipped). */
  steps: string[];
  /** The section to reopen at. */
  last: string | null;
  finished: boolean;
  at: string;
  /** Marked from 0.3.8 progress (migrateTourProgress / migrateExperiments), not opened in Lessons. */
  migrated?: boolean;
}

export type ProgressStore = Record<string, LessonProgress>;

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function kv(): KV | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readProgress(store: KV | undefined = kv()): ProgressStore {
  try {
    const raw = store?.getItem(PROGRESS_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ProgressStore) : {};
  } catch {
    return {};
  }
}

function write(p: ProgressStore, store: KV | undefined): void {
  try {
    store?.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

function entry(p: ProgressStore, id: string): LessonProgress {
  return p[id] ?? { sections: [], steps: [], last: null, finished: false, at: new Date(0).toISOString() };
}

export function createProgress(store: KV | undefined = kv(), now: () => Date = () => new Date()) {
  let p = readProgress(store);
  const save = (id: string, e: LessonProgress) => {
    p = { ...p, [id]: { ...e, at: now().toISOString() } };
    write(p, store);
  };
  return {
    get all(): ProgressStore {
      return p;
    },
    of(id: string): LessonProgress | null {
      return p[id] ?? null;
    },
    /** Visited for the picker: opened in Lessons, or marked from 0.3.8 progress. */
    visited(id: string): boolean {
      return (p[id]?.sections.length ?? 0) > 0 || p[id]?.migrated === true;
    },
    /** Opened in Lessons. Migrated marks don't count, so `cold_entry` still shows to old-tour users. */
    opened(id: string): boolean {
      return (p[id]?.sections.length ?? 0) > 0 && p[id]?.migrated !== true;
    },
    /** Marks a lesson visited from 0.3.8 progress; never touches one that already has progress. */
    markMigrated(id: string, sections: string[] = []): void {
      if (p[id]) return;
      save(id, { ...entry(p, id), sections, migrated: true });
    },
    visitSection(id: string, section: string): void {
      const e = entry(p, id);
      // Opening a section in Lessons turns a migrated mark into a real visit.
      const sections = e.migrated ? [section] : e.sections.includes(section) ? e.sections : [...e.sections, section];
      save(id, { ...e, sections, last: section, migrated: undefined });
    },
    finishStep(id: string, step: string): void {
      const e = entry(p, id);
      if (e.steps.includes(step)) return;
      save(id, { ...e, steps: [...e.steps, step] });
    },
    finish(id: string): void {
      save(id, { ...entry(p, id), finished: true });
    },
  };
}

export type Progress = ReturnType<typeof createProgress>;

// ---------------------------------------------------------------------------
// 0.3.8 -> 0.4.0 migration (plan T7b "Progress migration"). The tour's keys
// are copied from 0.3.8's tour progress module, which 0.4.0 removes.
// Old keys are read, never written or removed.
// ---------------------------------------------------------------------------

/** 0.3.8 tour progress: `{ chapterId, step, completed: string[] }`. */
export const TOUR_PROGRESS_KEY = 'pry:tour_progress';
/** Set once the tour has been seen or dismissed; suppresses the tour's auto-start. */
export const TOUR_SEEN_KEY = 'pry:tutorial_seen';
/** The lesson to reopen at, written by the migration. */
export const LESSON_LAST_KEY = 'pry:lesson_last';
/** Set once the migration has run. */
export const MIGRATED_KEY = 'pry:lesson_migrated';
/** The one Lessons-toggle tip old-tour users get (tips-registry.ts). */
export const LESSONS_TIP_ID = 'lessons-toggle';

export const QUICK_TOUR_ID = 'pry.quick-tour';

/** The quick-tour stops the 0.3.8 `basics` chapter covered (lessons/MAPPING.md). */
const BASICS_STOPS = ['step-1', 'step-2', 'step-3', 'step-4', 'step-6', 'step-12'];

/** 0.3.8 tour chapter -> the lessons it marks visited. */
export const CHAPTER_LESSONS: Record<string, string[]> = {
  basics: [QUICK_TOUR_ID],
  attention: ['pry.p2-1', 'pry.p2-2'],
  guesses: ['pry.p1-4', 'pry.p2-3'],
  responsible: ['pry.p2-4', 'pry.p3-7'],
  poke: ['pry.p3-2', 'pry.p3-3'],
  concepts: ['pry.p2-5', 'pry.p3-4', 'pry.p3-5'],
  compare: ['pry.p3-1'],
  lab: [],
  models: [],
};

function readTourProgress(store: Pick<Storage, 'getItem'>): { chapterId: string | null; completed: string[] } | null {
  try {
    const raw = store.getItem(TOUR_PROGRESS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { chapterId?: unknown; completed?: unknown } | null;
    if (!v || typeof v !== 'object') return null;
    const completed = Array.isArray(v.completed) ? v.completed.filter((x): x is string => typeof x === 'string') : [];
    const chapterId = typeof v.chapterId === 'string' ? v.chapterId : null;
    return chapterId || completed.length ? { chapterId, completed } : null;
  } catch {
    return null;
  }
}

/**
 * First 0.4.0 launch: 0.3.8 tour chapters (completed ones and the one the
 * learner was on) mark lessons visited, `pry:lesson_last` names the lesson of
 * the furthest one, and only learners with tour progress keep the
 * Lessons-toggle tip. Nothing auto-opens. Runs once.
 */
export function migrateTourProgress(
  store: KV | undefined = kv(),
  progress?: Progress,
): { ran: boolean; hadTour: boolean; lessons: string[] } {
  const none = { ran: false, hadTour: false, lessons: [] as string[] };
  if (!store) return none;
  try {
    if (store.getItem(MIGRATED_KEY) === 'true') return none;
  } catch {
    return none;
  }
  const tour = readTourProgress(store);
  const lessons: string[] = [];
  if (tour) {
    const prog = progress ?? createProgress(store);
    const order = Object.keys(CHAPTER_LESSONS);
    const chapters = [...new Set([...tour.completed, ...(tour.chapterId ? [tour.chapterId] : [])])]
      .filter((c) => c in CHAPTER_LESSONS)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const c of chapters) {
      for (const id of CHAPTER_LESSONS[c]) {
        prog.markMigrated(id, id === QUICK_TOUR_ID ? BASICS_STOPS : []);
        if (!lessons.includes(id)) lessons.push(id);
      }
    }
    const last = lessons.filter((id) => id !== QUICK_TOUR_ID).at(-1);
    try {
      if (last) store.setItem(LESSON_LAST_KEY, last);
    } catch {
      /* storage unavailable */
    }
  }
  try {
    // Without tour progress there's nothing to point out: the Lessons-toggle tip never shows.
    if (!tour) store.setItem(`pry:tip_seen:${LESSONS_TIP_ID}`, 'true');
    store.setItem(MIGRATED_KEY, 'true');
  } catch {
    /* storage unavailable */
  }
  return { ran: true, hadTour: !!tour, lessons };
}

/**
 * 0.3.8 experiments the learner ran mark their lessons visited. 0.3.8 kept no
 * separate "experiment done" key: a notebook entry's experiment id is the
 * record, mapped through notebook.ts's table (lessonIdForExperiment).
 */
export function migrateExperiments(lessonIds: (string | null | undefined)[], progress: Progress): string[] {
  const out: string[] = [];
  for (const id of lessonIds) {
    if (!id || out.includes(id)) continue;
    progress.markMigrated(id);
    out.push(id);
  }
  return out;
}

/**
 * Whether the quick tour starts on its own: never once `pry:tutorial_seen` is
 * set, and never for a 0.3.8 learner with tour progress (they get the
 * Lessons-toggle tip instead).
 */
export function tourAutoStarts(store: Pick<Storage, 'getItem'> | undefined = kv()): boolean {
  try {
    if (!store) return false;
    if (store.getItem(TOUR_SEEN_KEY) === 'true') return false;
    return readTourProgress(store) === null;
  } catch {
    return false;
  }
}
