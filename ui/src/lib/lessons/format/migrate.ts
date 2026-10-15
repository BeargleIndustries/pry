// Format migration (plan "Format versioning story"). A breaking change ships as
// a new format with an automatic conversion here. Until then this file holds
// only the too-new path; no code exists for earlier formats.

import { makeIssue, type LessonIssue } from './errors';
import { LESSON_FORMAT } from './version';

export type MigrateResult = { ok: true; frontMatter: Record<string, unknown> } | { ok: false; issue: LessonIssue };

/**
 * Brings raw front matter up to the current format. Formats newer than this
 * app stop with "Update Pry". Anything else that isn't the current format is
 * left for the schema to reject.
 */
export function migrate(frontMatter: Record<string, unknown>): MigrateResult {
  const f = frontMatter.format;
  if (typeof f === 'number' && Number.isInteger(f) && f > LESSON_FORMAT) {
    return { ok: false, issue: makeIssue('format-too-new', { n: f }, { section: 0, line: 1 }) };
  }
  return { ok: true, frontMatter };
}
