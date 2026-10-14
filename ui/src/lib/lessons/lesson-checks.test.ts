// Plan T6 acceptance (plan:543): every checkable observe, slot expect and
// assert in every bundled lesson evaluates as authored against the recorded
// responses, using the registry's readouts over a fake sidecar fed from
// `__generated__/responses/` (lesson-walk.ts).

import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const recorded = loadRecorded(join(GEN, 'responses'));
const rows = loadRows(join(GEN, 'rows.json'));
const files = bundledLessonFiles();

describe('lesson checks', () => {
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
});
