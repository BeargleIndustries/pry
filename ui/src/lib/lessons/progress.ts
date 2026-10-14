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
    visited(id: string): boolean {
      return (p[id]?.sections.length ?? 0) > 0;
    },
    visitSection(id: string, section: string): void {
      const e = entry(p, id);
      save(id, { ...e, sections: e.sections.includes(section) ? e.sections : [...e.sections, section], last: section });
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
