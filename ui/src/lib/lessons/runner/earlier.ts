// Earlier answers (plan T1 TN-4, T3 `earlier.ts`): `remember: <key>` writes a
// learner's answer to the journal; `:earlier{key}[fallback]` shows it later,
// in this lesson or another. `$earlier.<key>` arguments (with `fallback`) read
// the same entries through the dispatcher's BindingSources.

import { lessonsCopy } from '../copy';
import { formatValue } from '../slots';
import type { EarlierState } from '../render';
import type { RunnerJournal } from './types';

/** The learner's own words for a stored value: strings as written, a head as `L9H9`. */
export function earlierWords(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(earlierWords).join(', ');
  return formatValue(value, 'number');
}

/**
 * What `:earlier{key}[fallback]` shows: the learner's own words; for a skipped
 * step the fallback (or "skipped"); "You haven't done that lesson yet" when
 * the key was never answered.
 */
export function earlierText(journal: RunnerJournal, key: string, fallback = ''): { text: string; state: EarlierState } {
  const e = journal.earlier(key);
  if (!e) return { text: lessonsCopy.notYet, state: 'missing' };
  if (e.skipped) return { text: fallback.trim() || lessonsCopy.skipped, state: 'skipped' };
  return { text: earlierWords(e.value), state: 'answer' };
}

/** `$earlier.<key>` for an action argument or a check value: undefined when skipped or missing. */
export function earlierValue(journal: RunnerJournal, key: string): unknown | undefined {
  const e = journal.earlier(key);
  if (!e || e.skipped) return undefined;
  return e.value ?? undefined;
}
