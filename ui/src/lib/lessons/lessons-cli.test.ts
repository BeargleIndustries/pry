import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBundledTarget } from '../../../scripts/lessons-lint';

const uiDir = fileURLToPath(new URL('../../..', import.meta.url));
const cli = join(uiDir, 'build-cli', 'lessons-lint.mjs');
const fixtures = join(uiDir, 'src/lib/lessons/format/fixtures/cli');
// The shipped template (lane T1-app) once merged; the fixture copy of it until then.
const templates = [join(fixtures, 'my.first-lesson'), join(uiDir, 'src/lessons/_template')].filter((d) => existsSync(join(d, 'lesson.md')));

function lintCli(folder: string, ...flags: string[]) {
  const env = { ...process.env };
  delete env.VITEST;
  const r = spawnSync(process.execPath, [cli, folder, ...flags], { cwd: uiDir, env, encoding: 'utf8' });
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

  /** A copy of the second-look example set (lesson plus its recorded responses), with the lesson edited. */
  function secondLookCopy(edit: (text: string) => string = (t) => t): { set: string; lesson: string } {
    const set = join(mkdtempSync(join(tmpdir(), 'pry-lint-')), 'second-look');
    cpSync(join(uiDir, '../docs/lessons/examples/second-look'), set, { recursive: true });
    const lesson = join(set, 'community.second-look', 'lesson.md');
    writeFileSync(lesson, edit(readFileSync(lesson, 'utf8')));
    return { set, lesson };
  }

  it('› a user lesson whose expects match the responses recorded beside its set lints clean', () => {
    const { set } = secondLookCopy();
    const { code, out } = lintCli(set, '--release');
    expect(code, out).toBe(0);
    expect(out).toMatch(/1 lesson\(s\): 0 error\(s\), 0 warning\(s\)\./);
  });

  it('› a wrong expect against the recorded response is a warning, and an error under --release', () => {
    const { set } = secondLookCopy((t) => t.replace('read: token_count, expect: 15', 'read: token_count, expect: 14'));
    const plain = lintCli(set);
    expect(plain.code, plain.out).toBe(0);
    expect(plain.out).toMatch(/warning: .*The slot `\{chips\}` doesn't match the recorded response: live 15, expect 14\./);
    const release = lintCli(set, '--release');
    expect(release.code, release.out).toBe(1);
    expect(release.out).toMatch(/The slot `\{chips\}` doesn't match the recorded response: live 15, expect 14\./);
    expect(release.out).not.toMatch(/warning: .*\{chips\}/);
  });

  it('› expects with no recorded response in the set warn and point at the recording route', () => {
    const { set } = secondLookCopy();
    rmSync(join(set, '__generated__', 'responses'), { recursive: true });
    const { code, out } = lintCli(set, '--release');
    expect(code, out).toBe(0);
    expect(out).toMatch(/warning: .*This lesson has `expect` values, and there's no recorded response for its `\/generate` request on "The longest word I know is antidisestablishmentarianism, which means"/);
    expect(out).toMatch(/AUTHORING\.md, "Getting real expected values"/);
  });

  it('› a wrong expect names the line that declares the slot, as well as the step that uses it', () => {
    const { set, lesson } = secondLookCopy((t) => t.replace('read: token_count, expect: 15', 'read: token_count, expect: 14'));
    const declared = readFileSync(lesson, 'utf8').split(/\r?\n/).findIndex((l) => l.includes('chips: { read: token_count')) + 1;
    expect(declared).toBeGreaterThan(1);
    const { out } = lintCli(set, '--release');
    const msg = out.split(/\r?\n/).find((l) => l.includes('The slot `{chips}`'));
    expect(msg, out).toMatch(/lesson\.md:(\d+): Section \d+, step `[^`]+`, line \1: /);
    expect(msg).not.toMatch(new RegExp(`lesson\\.md:${declared}:`));
    expect(msg).toContain(`live 15, expect 14. Its \`expect\` is on line ${declared}.`);
  });

  it('› a $slot check against a wrong expect names the slot\'s declaration line too', () => {
    const set = join(mkdtempSync(join(tmpdir(), 'pry-lint-')), 'third-time');
    cpSync(join(uiDir, '../docs/lessons/examples/third-time'), set, { recursive: true });
    const lesson = join(set, 'community.third-time', 'lesson.md');
    writeFileSync(lesson, readFileSync(lesson, 'utf8').replace('expect: " a"', 'expect: " the"'));
    const declared = readFileSync(lesson, 'utf8').split(/\r?\n/).findIndex((l) => l.includes('top_tok: {')) + 1;
    const { out } = lintCli(set, '--release');
    const msg = out.split(/\r?\n/).find((l) => l.includes('The check `top_guess.token equals "$slot.top_tok"`'));
    expect(msg, out).toContain(`got " a", want " the". Its \`expect\` is on line ${declared}.`);
  });

  it('› with every slot still pending and nothing recorded, the warning says pending, not expect values', () => {
    const { set } = secondLookCopy((t) =>
      t.replace(/expect: (15|5|" that"|0\.34, tolerance: 0\.02)/g, 'expect: pending'),
    );
    rmSync(join(set, '__generated__', 'responses'), { recursive: true });
    const { out } = lintCli(set, '--skeleton');
    expect(out).toMatch(/warning: .*This lesson has slots marked `expect: pending`, and there's no recorded response/);
    expect(out).not.toMatch(/This lesson has `expect` values/);
  });

  it('› the draft warning points at the draft line, not line 1', () => {
    const { set, lesson } = secondLookCopy((t) => t.replace(/^(id: .*)$/m, '$1\ndraft: true'));
    const line = readFileSync(lesson, 'utf8').split(/\r?\n/).indexOf('draft: true') + 1;
    expect(line).toBeGreaterThan(1);
    const { out } = lintCli(set);
    expect(out).toContain(`lesson.md:${line}: warning: line ${line}: This lesson is marked \`draft: true\``);
  });
});
