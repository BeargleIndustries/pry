// Runner-side shapes shared by the runner modules. The journal is the T5
// notebook's (ui/src/lib/notebook.ts JournalEntry), seen through a narrow,
// tool-neutral interface: the page wires the notebook store to it, so nothing
// here imports app code.

export type RunnerJournalKind =
  | 'recall'
  | 'question'
  | 'predict'
  | 'observe'
  | 'transfer'
  | 'compare'
  | 'task'
  | 'explain-chain'
  | 'capture';

/** One learner step, as notebook.ts JournalEntry stores it (the page adds provenance). */
export interface RunnerJournalEntry {
  id: string;
  at: string;
  lesson: { id: string; version: string; source: string };
  sectionId: string;
  stepId: string;
  kind: RunnerJournalKind;
  question: string;
  answer: { choice?: string; text?: string; pick?: unknown; value?: unknown };
  remember?: string;
  capture?: { name: string; readouts: Record<string, unknown> };
  skipped: boolean;
  committedAt: string;
  check?: { read: string; op: string; binding: string; expected: unknown; actual: unknown; agrees: boolean };
  slots?: Record<string, { live: unknown; expect: unknown }>;
}

/** What `:earlier` / `$earlier` read for a remember key (notebook.ts EarlierRead). */
export interface EarlierAnswer {
  skipped: boolean;
  value: unknown;
  text: string;
}

export interface RunnerJournal {
  /** Latest answer for a remember key; null when never answered. */
  earlier(key: string): EarlierAnswer | null;
  /** Latest capture per (lesson, name); null when none. */
  capture(lessonId: string, name: string): { name: string; readouts: Record<string, unknown> } | null;
  /** Latest entry for one step of one lesson (an observe answered on an earlier visit). */
  last?(lessonId: string, stepId: string): RunnerJournalEntry | null;
  /** Records one step. */
  write(entry: RunnerJournalEntry): void | Promise<unknown>;
}

/** An in-memory journal (tests, and the app before the notebook has loaded). */
export function memoryJournal(): RunnerJournal & { entries: RunnerJournalEntry[] } {
  const entries: RunnerJournalEntry[] = [];
  const latest = <T>(pick: (e: RunnerJournalEntry) => T | undefined | null | false): RunnerJournalEntry | null => {
    for (let i = entries.length - 1; i >= 0; i--) if (pick(entries[i])) return entries[i];
    return null;
  };
  return {
    entries,
    earlier(key) {
      const e = latest((x) => x.remember === key);
      if (!e) return null;
      if (e.skipped) return { skipped: true, value: null, text: 'skipped' };
      const v = e.answer.choice ?? e.answer.text ?? e.answer.pick ?? e.answer.value ?? null;
      return { skipped: false, value: v, text: typeof v === 'string' ? v : JSON.stringify(v) };
    },
    capture(lessonId, name) {
      return latest((x) => x.lesson.id === lessonId && x.capture?.name === name)?.capture ?? null;
    },
    last(lessonId, stepId) {
      return latest((x) => x.lesson.id === lessonId && x.stepId === stepId);
    },
    write(entry) {
      entries.push(entry);
    },
  };
}
