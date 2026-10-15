import { describe, expect, it } from 'vitest';
import { createLessonLog, type LogFs } from './log';

function fakeFs() {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const fs: LogFs = {
    async exists(p) {
      return files.has(p);
    },
    async readTextFile(p) {
      return files.get(p) ?? '';
    },
    async writeTextFile(p, t, o) {
      calls.push(o?.append ? `append ${p}` : `write ${p}`);
      files.set(p, o?.append ? (files.get(p) ?? '') + t : t);
    },
  };
  return { fs, files, calls };
}

const quiet = { warn: () => {} };
const now = () => new Date('2026-10-13T12:00:00Z');

describe('lessons log', () => {
  it('› block logged', async () => {
    const { fs, files } = fakeFs();
    const log = createLessonLog(fs, { path: 'L/lessons.log', rotatedPath: 'L/lessons.log.1', now, console: quiet });
    await log.log({ lessonId: 'my.lesson', stepId: 'look-up', effect: 'network', scope: 'neuronpedia', message: 'blocked: not granted' });
    const lines = files.get('L/lessons.log')!.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      time: '2026-10-13T12:00:00.000Z',
      lessonId: 'my.lesson',
      stepId: 'look-up',
      effect: 'network',
      scope: 'neuronpedia',
      message: 'blocked: not granted',
    });
  });

  it('› copy-truncate rotation', async () => {
    const { fs, files, calls } = fakeFs();
    files.set('L/lessons.log', 'x'.repeat(90) + '\n');
    const log = createLessonLog(fs, { path: 'L/lessons.log', rotatedPath: 'L/lessons.log.1', maxBytes: 120, now, console: quiet });
    await log.log({ message: 'first after start' });
    expect(files.get('L/lessons.log.1')).toBe('x'.repeat(90) + '\n');
    const kept = files.get('L/lessons.log')!;
    expect(JSON.parse(kept).message).toBe('first after start');
    // Copy, then truncate in place, then append: no remove, no rename.
    expect(calls).toEqual(['write L/lessons.log.1', 'write L/lessons.log', 'append L/lessons.log']);
    await log.log({ message: 'small' });
    expect(files.get('L/lessons.log')!.trimEnd().split('\n')).toHaveLength(2);
  });
});
