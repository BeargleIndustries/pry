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
//
// A user lesson's `expect` values are held to the responses recorded beside its
// set, in <set>/__generated__/responses/<key>.json (sidecar/tests/test_lessons.py
// --record --lesson-dir): the lesson walks through the real registry
// (lesson-walk.ts, the walk lesson-checks.test.ts and lessons-compile use, keys
// by registry/request-key.ts) with the fetch answered from those files. No
// recording: a warning that points at the recording route. A recording that
// disagrees with an `expect`: a warning, an error under --release.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import bundledTerms from '../src/lessons/terms.yaml?raw';
import bundledWords from '../src/lessons/lint-words.yaml?raw';
import { pryToolSet } from '../src/lib/lessons/registry/pry-set';
import type { ToolActionSet } from '../src/lib/lessons/registry/contract';
import { copyLint, type LintWords, type TermsData } from '../src/lib/lessons/format/copy-lint';
import { formatIssue, hasErrors, makeIssue, type LessonIssue } from '../src/lib/lessons/format/errors';
import { lintLessonSet } from '../src/lib/lessons/format/lint';
import { loadLessonSource } from '../src/lib/lessons/format/normalise';
import { parseIndex } from '../src/lib/lessons/format/parse';
import type { Lesson, Step } from '../src/lib/lessons/format/schema';
import { loadRecorded, loadRows, walkLesson, type WalkCheck } from '../src/lib/lessons/lesson-walk';

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

/** Lesson folders at or below `root` (a folder of example sets, e.g. docs/lessons/examples, holds them one level down). */
function lessonFiles(root: string, depth = 0): string[] {
  if (existsSync(join(root, 'lesson.md'))) return [join(root, 'lesson.md')];
  if (depth > 2) return [];
  return readdirSync(root)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.') && d !== 'node_modules' && statSync(join(root, d)).isDirectory())
    .sort()
    .flatMap((d) => lessonFiles(join(root, d), depth + 1));
}

const readIf = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined);

/** Every string anywhere in a JSON value (prompts recorded in rows.json / expectations.json). */
function strings(v: unknown, out: Set<string>): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

const USAGE = [
  'Usage: node lessons-lint.mjs <folder> [--release] [--skeleton] [--bundled]',
  '',
  '<folder> is one lesson folder (with lesson.md), or a folder that holds lesson folders.',
  '  --release   also fails `draft: true` and `expect: pending`. Use it before you share a lesson.',
  '  --skeleton  allows `expect: pending` while you draft. --release overrides it.',
  '  --bundled   checks the lesson as one that ships inside Pry: stricter on `expect` and recorded prompts,',
  '              no permission checks, and `pry.` ids allowed. Pry still refuses a `pry.` id from you.',
  '',
  'Exits 0 when every lesson is clean, 1 when any lesson has an error, 2 when the folder is wrong.',
];

/** Endpoints whose whole answer is a network lookup no readout reads (test_lessons.py NETWORK_ONLY): never needed for an `expect`. */
const LOOKUP_ONLY = new Set(['/concept-search']);

/** A walk check that holds the live readout to an authored value. */
const usesExpect = (c: WalkCheck) =>
  !c.skipped && (c.kind === 'slot' || (c.kind === 'check' && (c.check?.expect !== undefined || String(c.check?.value ?? '').startsWith('$slot.'))));

/** The step a walk check names (`section/step/child`), for the message's section, step and line. */
function whereOf(lesson: Lesson, where: string) {
  const [sectionId, ...path] = where.split('/');
  const section = lesson.sections.find((s) => s.id === sectionId);
  let steps: Step[] = section?.steps ?? [];
  let step: Step | undefined;
  for (const id of path) {
    step = steps.find((x) => (x.id ?? x.kind) === id);
    if (!step) break;
    steps = step.children;
  }
  return { section: section?.index ?? 0, step: step?.id, line: step?.line ?? section?.line ?? 1, file: lesson.file };
}

/**
 * The line that declares slot `name`, where its `expect` sits: in the `:::slots` block of the
 * section the check is in, else in the front matter's `slots:`. Undefined when it can't tell.
 */
function slotLine(lesson: Lesson, text: string, where: string, name: string): number | undefined {
  const lines = text.split(/\r?\n/);
  // Slot names are [a-z_][a-z0-9_]*, so they're safe inside a pattern.
  const key = new RegExp(`(^\\s*|[{,]\\s*)${name}\\s*:`);
  const section = lesson.sections.find((s) => s.id === where.split('/')[0]);
  if (section?.slots?.[name] && section.slotsLine) {
    const at = lines.findIndex((l, i) => i >= section.slotsLine! - 1 && key.test(l));
    return at < 0 ? section.slotsLine : at + 1;
  }
  const end = lines.indexOf('---', 1);
  const start = lines.findIndex((l, i) => i < end && /^slots\s*:/.test(l));
  if (start < 0) return undefined;
  for (let i = start + 1; i < end && /^\s/.test(lines[i]); i++) if (key.test(lines[i])) return i + 1;
  return start + 1;
}

/** The slot whose `expect` a failed walk check holds the readout to: the slot itself, or a check's `$slot.<name>`. */
function declaredSlot(c: WalkCheck): string | undefined {
  if (c.kind === 'slot') return c.name;
  const m = /^\$slot\.([a-z_][a-z0-9_]*)$/.exec(String(c.check?.value ?? ''));
  return m?.[1];
}

/** A user lesson's expects against the responses recorded in its set's __generated__/responses/. */
async function recordedIssues(lesson: Lesson, release: boolean): Promise<LessonIssue[]> {
  // The set is the folder that holds this lesson's folder, however far down the linted folder it sits.
  const setRoot = resolve(lesson.file!, '..', '..');
  const dir = join(setRoot, '__generated__', 'responses');
  const folder = relative(process.cwd(), dir) || dir;
  const r = await walkLesson(lesson, { recorded: loadRecorded(dir), rows: loadRows(join(setRoot, '__generated__', 'rows.json')) });
  const checks = r.checks.filter(usesExpect);
  if (!checks.length) return [];
  const missing = r.missing.filter((m) => !LOOKUP_ONLY.has(m.endpoint));
  if (missing.length) {
    const prompt = (missing[0].body as { prompt?: unknown } | null)?.prompt;
    const request = `\`${missing[0].endpoint}\` request${typeof prompt === 'string' ? ` on "${prompt}"` : ''}${missing.length > 1 ? ` (and ${missing.length - 1} more)` : ''}`;
    // With every slot still `expect: pending` there's nothing recorded to test yet, so say that instead.
    const slots = [lesson.meta.slots ?? {}, ...lesson.sections.map((s) => s.slots ?? {})].flatMap((o) => Object.values(o));
    const real =
      slots.some((s) => s.expect !== undefined && s.expect !== 'pending' && s.expect !== 'learner') ||
      checks.some((c) => c.kind === 'check' && c.check?.expect !== undefined && c.check.expect !== 'pending');
    const what = real ? '`expect` values' : 'slots marked `expect: pending`';
    return [makeIssue('expect-unrecorded', { what, request, folder }, { line: 1, section: 0, file: lesson.file }, 'warning')];
  }
  const text = readFileSync(lesson.file!, 'utf8');
  return checks
    .filter((c) => !c.ok)
    .map((c) =>
      makeIssue(
        'expect-recorded',
        {
          what: c.kind === 'slot' ? `The slot \`{${c.name}}\`` : `The check \`${c.name}\``,
          detail: c.detail,
          folder,
          declared: declaredSlot(c) ? slotLine(lesson, text, c.where, declaredSlot(c)!) : undefined,
        },
        whereOf(lesson, c.where),
        release ? 'error' : 'warning',
      ),
    );
}

/** Front matter keys whose messages point at line 1: point them at the key's own line. */
const FRONT_MATTER_KEY: Record<string, string> = { draft: 'draft', 'term-budget-lesson': 'new_terms' };
function frontMatterLine(text: string, key: string): number | undefined {
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  const at = lines.slice(0, end < 0 ? lines.length : end).findIndex((l) => l.startsWith(`${key}:`));
  return at < 0 ? undefined : at + 1;
}

export async function runLint(argv: string[]): Promise<LintRun> {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target || flags.has('--help')) return { code: flags.has('--help') ? 0 : 2, lines: USAGE };
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
  // Row constants (`rows[].constants`, written by `lessons:compile -- --rows`) that `$row.<id>.<field>` must name.
  const rowsJsonText = verifiedRows ? readIf(join(setRoot, '__generated__', 'rows.json')) : undefined;
  const rowConstants = rowsJsonText
    ? Object.fromEntries(
        (JSON.parse(rowsJsonText) as { rows: { id: number; constants?: Record<string, unknown> }[] }).rows.map((r) => [String(r.id), r.constants ?? {}]),
      )
    : undefined;

  const lines: string[] = [];
  const issuesByFile = new Map<string, LessonIssue[]>();
  const textOf = new Map<string, string>();
  const lessons: Lesson[] = [];
  const toolOf = new Map<Lesson, ToolActionSet<any>>();
  for (const file of lessonFiles(root)) {
    const rel = relative(process.cwd(), file) || file;
    const text = readFileSync(file, 'utf8');
    textOf.set(rel, text);
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
  const bundled = flags.has('--bundled') || isBundledTarget(root);
  // Node 18 has no global WebCrypto; request keys need it.
  if (!bundled && !globalThis.crypto?.subtle) (globalThis as any).crypto = (await import('node:crypto')).webcrypto;
  for (const [tool, group] of groupBy(lessons, (l) => toolOf.get(l)!)) {
    const results = lintLessonSet(group, {
      tool,
      bundled,
      skeleton: flags.has('--skeleton'),
      release: flags.has('--release'),
      knownLessons: known,
      verifiedRows,
      rowConstants,
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
      // Bundled lessons are held to their recordings by lesson-checks.test.ts.
      if (!bundled && tool === pryToolSet && !hasErrors(results.get(lesson.meta.id) ?? []))
        issuesByFile.get(lesson.file!)!.push(...(await recordedIssues(lesson, flags.has('--release'))));
    }
  }
  for (const [file, issues] of issuesByFile) {
    for (const i of issues) {
      const key = i.line === 1 && !i.section ? FRONT_MATTER_KEY[i.code] : undefined;
      const at = key ? frontMatterLine(textOf.get(file) ?? '', key) : undefined;
      if (at) i.line = at;
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
  const { code, lines } = await runLint(process.argv.slice(2));
  for (const l of lines) console.log(l);
  process.exit(code);
}
