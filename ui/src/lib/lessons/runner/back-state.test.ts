import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SKELETONS, lessonFile, makeKit, visibleText } from './test-kit';
import { pryToolSet } from '../registry/pry-set';

afterEach(() => vi.unstubAllGlobals());

const BUNDLED_DIR = fileURLToPath(new URL('../../../lessons/', import.meta.url));
/** Every bundled lesson that exists now (T6 adds them), then the template and the 20 outline skeletons. */
const BUNDLED = readdirSync(BUNDLED_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('__') && existsSync(`${BUNDLED_DIR}${d.name}/lesson.md`))
  .map((d) => `../../lessons/${d.name}/lesson.md`);
const LESSONS = [...BUNDLED, '../../lessons/_template/lesson.md', ...SKELETONS];

describe('back-state', () => {
  it('runs over the 20 outline skeletons and every bundled lesson', () => {
    expect(SKELETONS).toHaveLength(20);
    expect(LESSONS.length).toBeGreaterThanOrEqual(21);
  });

  for (const file of LESSONS) {
    it(`› snapshot() and readout strings on Back equal the forward entry: ${file.replace(/^.*\//, '').replace(/\/lesson\.md$/, '')}${file.endsWith('lesson.md') ? ` (${file.split('/').at(-2)})` : ''}`, async () => {
      const lesson = lessonFile(file);
      const kit = makeKit();
      const n = lesson.sections.length;
      const forward: { snap: unknown; text: unknown }[] = [];
      await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: lesson.sections[0].id });
      for (let i = 0; i < n; i++) {
        await kit.runner.goto(i);
        forward.push({ snap: pryToolSet.snapshot(), text: visibleText(kit.runner.render()) });
      }
      // Overlay lessons (the tour) apply only their own delta on top of the app: Back re-applies it.
      if (lesson.meta.presentation === 'overlay') {
        for (let i = n - 1; i >= 0; i--) {
          await kit.runner.goto(i);
          expect(visibleText(kit.runner.render())).toEqual(forward[i].text);
        }
        return;
      }
      for (let i = n - 1; i >= 0; i--) {
        await kit.runner.goto(i);
        expect({ section: lesson.sections[i].id, snap: pryToolSet.snapshot() }).toEqual({
          section: lesson.sections[i].id,
          snap: forward[i].snap,
        });
        expect(visibleText(kit.runner.render())).toEqual(forward[i].text);
      }
      kit.runner.close();
    }, 30000);
  }
});
