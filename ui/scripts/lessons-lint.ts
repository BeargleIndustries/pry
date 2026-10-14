/// <reference types="vite/client" />
// The lesson linter (plan T1 "CLI"): structural, overlay and copy lint, strict mode.
// Built to ui/build-cli/lessons-lint.mjs (Node 18, deps inlined) and shipped as a resource:
//
//   node lessons-lint.mjs <folder> [--release] [--skeleton] [--bundled]
//
// <folder> is one lesson folder (with lesson.md) or a folder of lesson folders.
// A lesson set's own terms.yaml / lint-words.yaml / index.yaml / verified-rows.yaml
// next to its lessons are used when present; otherwise Pry's bundled word lists.
// Exits 1 when any lesson has an error.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import bundledTerms from '../src/lessons/terms.yaml?raw';
import bundledWords from '../src/lessons/lint-words.yaml?raw';
import { pryToolSet } from '../src/lib/lessons/registry/pry-set';
import type { ToolActionSet } from '../src/lib/lessons/registry/contract';
import { copyLint, type LintWords, type TermsData } from '../src/lib/lessons/format/copy-lint';
import { formatIssue, makeIssue, type LessonIssue } from '../src/lib/lessons/format/errors';
import { lintLessonSet } from '../src/lib/lessons/format/lint';
import { loadLessonSource } from '../src/lib/lessons/format/normalise';
import { parseIndex } from '../src/lib/lessons/format/parse';
import type { Lesson } from '../src/lib/lessons/format/schema';

const TOOLS: Record<string, ToolActionSet<any>> = { pry: pryToolSet };

export interface LintRun {
  code: number;
  lines: string[];
}

/**
 * The app's own lesson folder (`ui/src/lessons`, or `src/lessons` from inside ui/),
 * or one lesson folder in it: linted as bundled without `--bundled` (plan T6
 * acceptance runs `lessons-lint.mjs ui/src/lessons --release` as written).
 * `_template` stays a user lesson.
 */
export function isBundledTarget(root: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const isSet = (p: string) => /(^|\/)src\/lessons$/.test(norm(p));
  if (isSet(root)) return true;
  const r = norm(root);
  const name = r.slice(r.lastIndexOf('/') + 1);
  return !name.startsWith('_') && existsSync(join(root, 'lesson.md')) && isSet(resolve(root, '..'));
}

function lessonFiles(root: string): string[] {
  if (existsSync(join(root, 'lesson.md'))) return [join(root, 'lesson.md')];
  return readdirSync(root)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.') && existsSync(join(root, d, 'lesson.md')))
    .sort()
    .map((d) => join(root, d, 'lesson.md'));
}

const readIf = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined);

/** Every string anywhere in a JSON value (prompts recorded in rows.json / expectations.json). */
function strings(v: unknown, out: Set<string>): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

export function runLint(argv: string[]): LintRun {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) return { code: 2, lines: ['Usage: node lessons-lint.mjs <folder> [--release] [--skeleton] [--bundled]'] };
  const root = resolve(target);
  if (!existsSync(root) || !statSync(root).isDirectory()) return { code: 2, lines: [`${target} isn't a folder.`] };
  const setRoot = existsSync(join(root, 'lesson.md')) ? resolve(root, '..') : root;

  const terms = parse(readIf(join(setRoot, 'terms.yaml')) ?? bundledTerms) as TermsData;
  const words = parse(readIf(join(setRoot, 'lint-words.yaml')) ?? bundledWords) as LintWords;
  const indexText = readIf(join(setRoot, 'index.yaml'));
  const rowsText = readIf(join(setRoot, 'verified-rows.yaml'));
  const verifiedRows = rowsText ? collectRowIds(parse(rowsText)) : undefined;
  const recordedPrompts = ['rows.json', 'row-requests.json', 'expectations.json']
    .map((f) => readIf(join(setRoot, '__generated__', f)))
    .filter((t): t is string => t !== undefined)
    .reduce((acc, t) => strings(JSON.parse(t), acc), new Set<string>());

  const lines: string[] = [];
  const issuesByFile = new Map<string, LessonIssue[]>();
  const lessons: Lesson[] = [];
  const toolOf = new Map<Lesson, ToolActionSet<any>>();
  for (const file of lessonFiles(root)) {
    const rel = relative(process.cwd(), file) || file;
    const text = readFileSync(file, 'utf8');
    const tool = TOOLS[(/^tool:\s*(\S+)/m.exec(text)?.[1] ?? 'pry').replace(/["']/g, '')];
    if (!tool) {
      issuesByFile.set(rel, [makeIssue('bad-field', { where: 'The front matter', detail: 'this linter only knows `tool: pry`' }, { line: 1, file: rel })]);
      continue;
    }
    const { lesson, issues } = loadLessonSource(text, { mode: 'strict', tool, file: rel });
    issuesByFile.set(rel, issues);
    if (lesson) {
      lessons.push(lesson);
      toolOf.set(lesson, tool);
    }
  }

  const path = indexText ? parseIndex(indexText) : [...new Set(terms.terms.map((t) => t.introduced_in))];
  const known = new Set([...path, ...terms.terms.map((t) => t.introduced_in)]);
  for (const [tool, group] of groupBy(lessons, (l) => toolOf.get(l)!)) {
    const results = lintLessonSet(group, {
      tool,
      bundled: flags.has('--bundled') || isBundledTarget(root),
      skeleton: flags.has('--skeleton'),
      release: flags.has('--release'),
      knownLessons: known,
      verifiedRows,
      recordedPrompts: recordedPrompts.size ? recordedPrompts : undefined,
      caveatTools: Object.keys(words.pinned_caveats ?? {}),
      imageSize: (src, file) => {
        const p = resolve(file ?? root, '..', src);
        return existsSync(p) ? statSync(p).size : undefined;
      },
    });
    for (const lesson of group) {
      const copy = copyLint(lesson, { terms, words, path: indexText ? path : naturalOrder(path) }).map((i) => ({ ...i, file: lesson.file }));
      issuesByFile.get(lesson.file!)!.push(...(results.get(lesson.meta.id) ?? []), ...copy);
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const [, issues] of issuesByFile) {
    for (const i of issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      lines.push(formatIssue(i));
      if (i.severity === 'error') errorCount++;
      else warningCount++;
    }
  }
  lines.push(`${issuesByFile.size} lesson(s): ${errorCount} error(s), ${warningCount} warning(s).`);
  return { code: errorCount ? 1 : 0, lines };
}

function collectRowIds(doc: unknown): string[] {
  const rows = Array.isArray(doc) ? doc : Array.isArray((doc as any)?.rows) ? (doc as any).rows : [];
  return rows.map((r: any) => String(r?.id ?? r?.row ?? '')).filter(Boolean);
}

function groupBy<T, K>(xs: T[], f: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) m.set(f(x), [...(m.get(f(x)) ?? []), x]);
  return m;
}

/** pry.p1-2 before pry.p1-10: digits compared as numbers. */
function naturalOrder(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

if (!process.env.VITEST) {
  const { code, lines } = runLint(process.argv.slice(2));
  for (const l of lines) console.log(l);
  process.exit(code);
}
