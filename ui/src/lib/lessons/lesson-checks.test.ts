// Plan T6 acceptance (plan:543): every checkable observe, slot expect and
// assert in every bundled lesson evaluates as authored against the recorded
// responses, using the registry's readouts over a fake sidecar fed from
// `__generated__/responses/` (lesson-walk.ts).

import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLessonSource } from './format/normalise';
import { pryToolSet } from './registry/pry-set';
import { loadRecorded, loadRows, walkLesson } from './lesson-walk';

const LESSONS = fileURLToPath(new URL('../../lessons', import.meta.url));
const GEN = join(LESSONS, '__generated__');

function bundledLessonFiles(): string[] {
  return readdirSync(LESSONS)
    .filter((d) => !d.startsWith('_') && existsSync(join(LESSONS, d, 'lesson.md')))
    .sort()
    .map((d) => join(LESSONS, d, 'lesson.md'));
}

/**
 * docs/lessons/examples/<set>/<id>/lesson.md: example lessons recorded with
 * test_lessons.py --record --lesson-dir, which writes their responses into
 * <set>/__generated__/responses/ beside them.
 */
const EXAMPLES = fileURLToPath(new URL('../../../../docs/lessons/examples', import.meta.url));
function exampleLessonFiles(): string[] {
  if (!existsSync(EXAMPLES)) return [];
  return readdirSync(EXAMPLES)
    .filter((set) => !set.startsWith('.') && statSync(join(EXAMPLES, set)).isDirectory())
    .flatMap((set) => readdirSync(join(EXAMPLES, set)).map((d) => join(EXAMPLES, set, d, 'lesson.md')))
    .filter((f) => existsSync(f))
    .sort();
}

const recorded = loadRecorded(join(GEN, 'responses'));
const rows = loadRows(join(GEN, 'rows.json'));
const files = bundledLessonFiles();

describe('lesson checks', () => {
  it('› $row resolves from the row constants first, then the recorded values', () => {
    // Row 23: `layer` is only a constant (derived from pick.head "L2H8"); `pick` is only a recorded value.
    expect(rows.get('23')?.layer).toBe(2);
    expect((rows.get('23')?.pick as { head: string }).head).toBe('L2H8');
    // Row 14's " Mary" head comes from row 47's record by `from_row`.
    expect([rows.get('14')?.mary_head_layer, rows.get('14')?.mary_head]).toEqual([10, 7]);
  });

  it('› there are bundled lessons to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.split(/[\\/]/).slice(-2, -1)[0], f]))(
    '› every checkable observe, slot expect and assert in every bundled lesson evaluates as authored against the recorded responses (%s)',
    async (_id, file) => {
      const { lesson, issues } = loadLessonSource(readFileSync(file, 'utf8'), { mode: 'strict', tool: pryToolSet, file });
      expect(issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
      const r = await walkLesson(lesson!, { recorded, rows });
      expect(r.errors, 'actions that failed').toEqual([]);
      expect(
        r.missing.map((m) => `${m.endpoint} ${JSON.stringify(m.body)}`),
        'requests with no recorded response (run pytest sidecar/tests/test_lessons.py --record --from-lessons)',
      ).toEqual([]);
      const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.where}: ${c.kind} ${c.name}: ${c.detail}`);
      expect(failed).toEqual([]);
      const pending = r.checks.filter((c) => c.skipped === 'pending').map((c) => `${c.where}: ${c.name}`);
      expect(pending, 'expect: pending in a bundled lesson').toEqual([]);
    },
    60_000,
  );

  it.each(exampleLessonFiles().map((f) => [f.split(/[\\/]/).slice(-2, -1)[0], f]))(
    '› every slot expect and check in an example lesson matches its recorded responses (%s)',
    async (_id, file) => {
      const { lesson, issues } = loadLessonSource(readFileSync(file, 'utf8'), { mode: 'strict', tool: pryToolSet, file });
      expect(issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
      const r = await walkLesson(lesson!, { recorded: loadRecorded(join(dirname(dirname(file)), '__generated__', 'responses')), rows });
      expect(r.errors, 'actions that failed').toEqual([]);
      // A lookup no readout reads may stay unrecorded: the offline route (no --network) is enough,
      // as AUTHORING.md says and lessons-lint.ts's LOOKUP_ONLY allows.
      expect(
        r.missing.filter((m) => m.endpoint !== '/concept-search').map((m) => `${m.endpoint} ${JSON.stringify(m.body)}`),
        'requests with no recorded response (run npm run lessons:compile -- --expectations --dir <set>, then pytest sidecar/tests/test_lessons.py --record --lesson-dir <set>)',
      ).toEqual([]);
      expect(r.checks.filter((c) => !c.ok).map((c) => `${c.where}: ${c.kind} ${c.name}: ${c.detail}`)).toEqual([]);
      expect(r.checks.filter((c) => !c.skipped).length, 'nothing was checked').toBeGreaterThan(0);
    },
    60_000,
  );
});
