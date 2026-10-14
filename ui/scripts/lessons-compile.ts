// Compiles lessons to JSON (the shape lesson.v1.schema.json describes).
//
//   npm run lessons:compile -- <folder> [--out file.json]
//
// <folder> is one lesson folder or a folder of lesson folders. Exits 1 when a
// lesson doesn't parse.
// TODO(pry-learning T6a): add the `--rows` mode that writes __generated__/row-requests.json (R5-6).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pryToolSet } from '../src/lib/lessons/registry/pry-set';
import { formatIssue, hasErrors } from '../src/lib/lessons/format/errors';
import { loadLessonSource } from '../src/lib/lessons/format/normalise';

export function compile(root: string): { lessons: unknown[]; errors: string[] } {
  const files = existsSync(join(root, 'lesson.md'))
    ? [join(root, 'lesson.md')]
    : readdirSync(root)
        .filter((d) => !d.startsWith('_') && existsSync(join(root, d, 'lesson.md')))
        .sort()
        .map((d) => join(root, d, 'lesson.md'));
  const lessons: unknown[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const rel = relative(process.cwd(), file) || file;
    const { lesson, issues } = loadLessonSource(readFileSync(file, 'utf8'), { mode: 'strict', tool: pryToolSet, file: rel });
    if (hasErrors(issues) || !lesson) errors.push(...issues.filter((i) => i.severity === 'error').map(formatIssue));
    else lessons.push(lesson);
  }
  return { lessons, errors };
}

if (!process.env.VITEST) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? argv[outAt + 1] : undefined;
  const target = argv.find((a, i) => !a.startsWith('--') && i !== outAt + 1);
  if (!target) {
    console.error('Usage: npm run lessons:compile -- <folder> [--out file.json]');
    process.exit(2);
  }
  const { lessons, errors } = compile(resolve(target));
  for (const e of errors) console.error(e);
  const text = `${JSON.stringify({ lessons }, null, 2)}\n`;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
  process.exit(errors.length ? 1 : 0);
}
