import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBundledTarget } from '../../../scripts/lessons-lint';

const uiDir = fileURLToPath(new URL('../../..', import.meta.url));
const cli = join(uiDir, 'build-cli', 'lessons-lint.mjs');
const fixtures = join(uiDir, 'src/lib/lessons/format/fixtures/cli');
// The shipped template (lane T1-app) once merged; the fixture copy of it until then.
const templates = [join(fixtures, 'template'), join(uiDir, 'src/lessons/_template')].filter((d) => existsSync(join(d, 'lesson.md')));

function lintCli(folder: string) {
  const env = { ...process.env };
  delete env.VITEST;
  const r = spawnSync(process.execPath, [cli, folder], { cwd: uiDir, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('lessons-cli', () => {
  beforeAll(() => {
    // Build the bundled linter exactly as `npm run build:cli` does.
    execFileSync(process.execPath, [join(uiDir, 'node_modules/vite/bin/vite.js'), 'build', '-c', 'vite.cli.config.ts', '--logLevel', 'error'], { cwd: uiDir, stdio: 'pipe' });
  }, 120_000);

  it('› bundled linter exits 1 with line-numbered messages on the broken fixture', () => {
    const { code, out } = lintCli(join(fixtures, 'broken'));
    expect(code).toBe(1);
    expect(out).toMatch(/lesson\.md:14: Section 1, step `desk`, line 14: This analogy needs a `breaks` line/);
    expect(out).toMatch(/lesson\.md:27: Section 2, step `run-it`, line 27: There's no action called `set_promt`\. Did you mean `set_prompt`\?/);
    expect(out).toMatch(/lesson\.md:34: Section 3, step `guess`, line 34: This predict step has nothing to check it/);
  });

  it('› exits 0 on the template', () => {
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      const { code, out } = lintCli(t);
      expect(code, out).toBe(0);
    }
  });

  it('› the app lesson folder lints as bundled without --bundled; a copy elsewhere does not', () => {
    const tour = join(uiDir, 'src/lessons/pry.quick-tour');
    expect(isBundledTarget(join(uiDir, 'src/lessons'))).toBe(true);
    expect(isBundledTarget(tour)).toBe(true);
    expect(isBundledTarget(join(uiDir, 'src/lessons/_template'))).toBe(false);
    const inApp = lintCli(tour);
    expect(inApp.code, inApp.out).toBe(0);
    const dir = join(mkdtempSync(join(tmpdir(), 'pry-lint-')), 'pry.quick-tour');
    mkdirSync(dir);
    copyFileSync(join(tour, 'lesson.md'), join(dir, 'lesson.md'));
    expect(isBundledTarget(dir)).toBe(false);
    const elsewhere = lintCli(dir);
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.out).toMatch(/belong to the app's own lessons/);
  });
});
