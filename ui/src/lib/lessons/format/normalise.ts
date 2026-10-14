// Raw structure -> validated lesson (plan "Format versioning story": strict and
// lenient). Strict: unknown keys are errors everywhere. Lenient: unknown keys on
// presentational objects (front matter metadata, explain, analogy, fold, images)
// are dropped and listed in author notes; everywhere else they stay errors.

import { LineCounter, parseDocument } from 'yaml';
import type { ZodType } from 'zod';
import type { ToolActionSet } from '../registry/contract';
import { makeIssue, nearest, type LessonIssue } from './errors';
import { migrate } from './migrate';
import { parseInline, parseLesson, type LoadedLesson, type RawBlock, type RawLesson, type RawStep } from './parse';
import {
  actionsList,
  frontMatter as frontMatterSchema,
  NESTING,
  PRESENTATIONAL_KINDS,
  slots as slotsSchema,
  STEP_KINDS,
  stepSchemas,
  type ActionCall,
  type FrontMatter,
  type Lesson,
  type Section,
  type Step,
  type StepKind,
} from './schema';

export type Mode = 'strict' | 'lenient';

export interface NormaliseOptions {
  mode?: Mode;
  /** Validates `baseline` and `:::enter` with the tool's schemas when given. */
  tool?: Pick<ToolActionSet<unknown>, 'baselineSchema' | 'overlaySchema'>;
  file?: string;
}

export interface NormaliseResult {
  lesson: Lesson | null;
  issues: LessonIssue[];
}

interface Ctx {
  mode: Mode;
  issues: LessonIssue[];
  notes: string[];
  section: number;
}

function readYaml(block: RawBlock, where: string, ctx: Ctx, step?: string): { value: any; counter: LineCounter; doc: any } | null {
  const counter = new LineCounter();
  const doc = parseDocument(block.value, { lineCounter: counter, uniqueKeys: true });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const line = block.line + ((e.linePos?.[0].line ?? 1) - 1);
    ctx.issues.push(makeIssue('yaml-syntax', { where, detail: e.message.split('\n')[0] }, { line, section: ctx.section, step }));
    return null;
  }
  return { value: doc.toJS(), counter, doc };
}

/** Turns zod issues into lesson issues; unrecognised keys get the unknown-key wording. */
function zodIssues(result: { success: boolean; error?: any }, where: string, ctx: Ctx, line: number, step?: string) {
  if (result.success) return;
  for (const iss of result.error.issues as any[]) {
    const at = iss.path?.length ? ` (at \`${iss.path.join('.')}\`)` : '';
    if (iss.code === 'unrecognized_keys') {
      for (const key of iss.keys) ctx.issues.push(makeIssue('unknown-key', { key, where: `${where}${at}` }, { line, section: ctx.section, step }));
    } else {
      ctx.issues.push(makeIssue('bad-field', { where: `${where}${at}`, detail: iss.message }, { line, section: ctx.section, step }));
    }
  }
}

/** Lenient: drop keys the schema doesn't know from a presentational object, noting each. */
function stripUnknown(obj: Record<string, unknown>, known: string[], where: string, ctx: Ctx) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) {
      delete obj[key];
      ctx.notes.push(`Dropped \`${key}\` ${where}.`);
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normaliseLesson(raw: RawLesson, opts: NormaliseOptions = {}): NormaliseResult {
  const ctx: Ctx = { mode: opts.mode ?? 'strict', issues: [...raw.issues], notes: [], section: 0 };
  const done = (lesson: Lesson | null): NormaliseResult => ({
    lesson,
    issues: opts.file ? ctx.issues.map((i) => ({ ...i, file: opts.file })) : ctx.issues,
  });

  if (!raw.frontMatter) {
    ctx.issues.push(makeIssue('front-matter-missing', {}, { line: 1 }));
    return done(null);
  }
  const fmY = readYaml(raw.frontMatter, 'in the front matter', ctx);
  if (!fmY) return done(null);
  if (!isObj(fmY.value)) {
    ctx.issues.push(makeIssue('front-matter-missing', {}, { line: 1 }));
    return done(null);
  }
  const mig = migrate(fmY.value);
  if (!mig.ok) {
    ctx.issues.push(mig.issue);
    return done(null);
  }
  const fm = { ...mig.frontMatter };
  if (ctx.mode === 'lenient') stripUnknown(fm, Object.keys(frontMatterSchema.shape), 'from the front matter', ctx);
  const fmLine = (key: string) => {
    const node = fmY.doc.contents?.items?.find((p: any) => p.key?.value === key);
    return node?.key?.range ? raw.frontMatter!.line + fmY.counter.linePos(node.key.range[0]).line - 1 : 1;
  };
  const parsed = frontMatterSchema.safeParse(fm);
  if (!parsed.success) {
    for (const iss of parsed.error.issues as any[]) {
      const line = fmLine(String(iss.path?.[0] ?? ''));
      if (iss.path?.[0] === 'id' && iss.path.length === 1) {
        ctx.issues.push(makeIssue('bad-id', { id: String(fm.id) }, { line, section: 0 }));
      } else {
        zodIssues({ success: false, error: { issues: [iss] } }, 'in the front matter', ctx, line);
      }
    }
  }
  if (opts.tool && fm.baseline !== undefined) {
    zodIssues(opts.tool.baselineSchema.safeParse(fm.baseline), 'in `baseline`', ctx, fmLine('baseline'));
  }

  const sections: Section[] = raw.sections.map((rs, i) => {
    ctx.section = i + 1;
    const sec: Section = {
      index: i + 1,
      id: typeof rs.attrs.id === 'string' ? rs.attrs.id : slug(rs.title),
      title: rs.title,
      depth: rs.attrs.depth === 'optional' ? 'optional' : 'core',
      line: rs.line,
      outline: typeof rs.attrs.outline === 'string' ? rs.attrs.outline : undefined,
      steps: [],
    };
    for (const key of Object.keys(rs.attrs)) {
      if (!['id', 'depth', 'outline'].includes(key)) {
        ctx.issues.push(makeIssue('unknown-key', { key, where: 'on a section heading' }, { line: rs.line, section: ctx.section }));
      }
    }
    if (rs.enter) {
      const y = readYaml(rs.enter, 'in `:::enter`', ctx);
      const v = y?.value ?? {};
      if (y && !isObj(v)) {
        ctx.issues.push(makeIssue('bad-field', { where: '`:::enter`', detail: 'it must be a YAML map' }, { line: rs.enter.line, section: ctx.section }));
      } else if (y) {
        const { reset, ...overlay } = v;
        if (reset !== undefined && reset !== true) {
          ctx.issues.push(makeIssue('bad-field', { where: '`:::enter` `reset`', detail: 'it can only be `true`' }, { line: rs.enter.line, section: ctx.section }));
        }
        if (opts.tool) zodIssues(safeParseBound(opts.tool.overlaySchema, overlay), 'in `:::enter`', ctx, rs.enter.line);
        sec.enter = { value: v, line: rs.enter.line };
      }
    }
    if (rs.slots) {
      const y = readYaml(rs.slots, 'in `:::slots`', ctx);
      if (y) {
        const r = slotsSchema.safeParse(y.value ?? {});
        zodIssues(r, 'in `:::slots`', ctx, rs.slots.line);
        if (r.success) sec.slots = r.data;
        sec.slotsLine = rs.slots.line;
      }
    }
    sec.steps = rs.steps.map((st) => normaliseStep(st, undefined, ctx, opts.tool?.overlaySchema)).filter((s): s is Step => s !== null);
    return sec;
  });

  if (!parsed.success) return done(null);
  return done({ file: opts.file, meta: parsed.data as FrontMatter, sections, authorNotes: ctx.notes });
}

function coerceAttr(v: string | string[] | true): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function normaliseStep(raw: RawStep, parent: StepKind | undefined, ctx: Ctx, overlaySchema?: ZodType): Step | null {
  const stepId = typeof raw.attrs.id === 'string' ? raw.attrs.id : undefined;
  const at = { line: raw.line, section: ctx.section, step: stepId };
  if (!(STEP_KINDS as readonly string[]).includes(raw.kind)) {
    ctx.issues.push(makeIssue('unknown-step', { kind: raw.kind, hint: nearest(raw.kind, STEP_KINDS) }, at));
    return null;
  }
  const kind = raw.kind as StepKind;
  if (parent && !NESTING[parent]?.includes(kind)) {
    ctx.issues.push(makeIssue('step-nesting', { kind, parent: `a \`${parent}\` step` }, at));
  }

  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw.attrs)) fields[k] = coerceAttr(v);
  if (raw.label !== undefined && kind === 'fold' && fields.title === undefined) fields.title = raw.label.trim();

  const actions: ActionCall[] = [];
  for (const block of raw.blocks) {
    if (block.lang === 'yaml') {
      const y = readYaml(block, `in this \`${kind}\` step`, ctx, stepId);
      if (!y) continue;
      if (y.value === null || y.value === undefined) continue;
      if (!isObj(y.value)) {
        ctx.issues.push(makeIssue('bad-field', { where: `The YAML in this \`${kind}\` step`, detail: 'it must be a map of fields' }, { ...at, line: block.line }));
        continue;
      }
      for (const [k, v] of Object.entries(y.value)) {
        if (k in fields && k in raw.attrs) ctx.issues.push(makeIssue('duplicate-key', { key: k }, { ...at, line: block.line }));
        fields[k] = v;
      }
    } else if (block.lang === 'actions') {
      if (kind !== 'do') {
        ctx.issues.push(makeIssue('unknown-key', { key: 'actions', where: `of a \`${kind}\` step` }, { ...at, line: block.line }));
        continue;
      }
      const y = readYaml(block, 'in the `actions` list', ctx, stepId);
      if (!y) continue;
      const r = actionsList.safeParse(y.value ?? []);
      if (!r.success) {
        zodIssues(r, 'In the `actions` list', ctx, block.line, stepId);
        continue;
      }
      const items = y.doc.contents?.items ?? [];
      r.data.forEach((entry, idx) => {
        const [name, argv] = Object.entries(entry)[0];
        const range = items[idx]?.range;
        const line = range ? block.line + y.counter.linePos(range[0]).line - 1 : block.line;
        actions.push({ name, args: isObj(argv) ? argv : argv == null ? {} : { value: argv }, line });
      });
    }
  }

  const schema = stepSchemas[kind];
  if (ctx.mode === 'lenient' && PRESENTATIONAL_KINDS.includes(kind)) {
    stripUnknown(fields, Object.keys(schema.shape), `from a \`${kind}\` step (line ${raw.line})`, ctx);
  }
  zodIssues(schema.safeParse(fields), `of a \`${kind}\` step`, ctx, raw.line, stepId);
  if (kind === 'task' && fields.reset !== undefined && overlaySchema) {
    zodIssues(safeParseBound(overlaySchema, fields.reset), 'in the task\'s `reset`', ctx, raw.line, stepId);
  }

  return {
    kind,
    id: stepId,
    line: raw.line,
    fields,
    prose: raw.prose.map((p) => ({ text: p.text, line: p.line, inline: parseInline(p.text) })),
    actions,
    children: raw.children.map((c) => normaliseStep(c, kind, ctx, overlaySchema)).filter((s): s is Step => s !== null),
    ...(raw.implicit ? { implicit: true } : {}),
  };
}

export interface Bindings {
  /** The value with each `{ $earlier, fallback }` replaced by its fallback. */
  value: unknown;
  earlier: { key: string; hasFallback: boolean; path: (string | number)[] }[];
  rows: { id: string; field: string; path: (string | number)[] }[];
}

/** Finds `$earlier` and `$row` bindings in action arguments or an overlay (plan:297). */
export function findBindings(v: unknown, path: (string | number)[] = [], out?: Bindings): Bindings {
  const acc: Bindings = out ?? { value: undefined, earlier: [], rows: [] };
  const walk = (x: unknown, p: (string | number)[]): unknown => {
    if (typeof x === 'string') {
      const e = /^\$earlier\.(.+)$/.exec(x);
      if (e) acc.earlier.push({ key: e[1], hasFallback: false, path: p });
      const r = /^\$row\.([^.]+)\.(.+)$/.exec(x);
      if (r) acc.rows.push({ id: r[1], field: r[2], path: p });
      return x;
    }
    if (Array.isArray(x)) return x.map((y, i) => walk(y, [...p, i]));
    if (isObj(x)) {
      if (typeof x.$earlier === 'string') {
        acc.earlier.push({ key: x.$earlier.replace(/^\$earlier\./, ''), hasFallback: 'fallback' in x, path: p });
        return x.fallback;
      }
      return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, [...p, k])]));
    }
    return x;
  };
  acc.value = walk(v, path);
  return acc;
}

/** Zod issues minus those at a `$row` binding (a row constant's type is only known from rows.json). */
export function safeParseBound(schema: ZodType, v: unknown): { success: boolean; error?: any; bindings: Bindings } {
  const b = findBindings(v);
  const r = schema.safeParse(b.value);
  if (r.success) return { success: true, bindings: b };
  const atRow = (ip: PropertyKey[]) => b.rows.some((row) => row.path.length <= ip.length && row.path.every((k, n) => String(k) === String(ip[n])));
  const issues = r.error.issues.filter((i) => !atRow(i.path));
  return issues.length ? { success: false, error: { issues }, bindings: b } : { success: true, bindings: b };
}

export type TextRole = 'prose' | 'choice' | 'feedback' | 'say' | 'field';

export interface StepText {
  text: string;
  line: number;
  role: TextRole;
  /** The field it came from, for fields. */
  field?: string;
}

const TEXT_FIELDS = ['like', 'because', 'breaks', 'question', 'model_answer', 'on_skip', 'expect_if_explanation_holds', 'title', 'alt'];
const LIST_FIELDS = ['supports', 'leaves_open', 'limits'];

/** Every learner-visible string in one step (not its children), with its role. */
export function stepTexts(step: Step): StepText[] {
  const out: StepText[] = step.prose.map((p) => ({ text: p.text, line: p.line, role: 'prose' as const }));
  const f = step.fields;
  const add = (v: unknown, role: TextRole, field?: string) => {
    if (typeof v === 'string') out.push({ text: v, line: step.line, role, field });
    else if (Array.isArray(v)) v.forEach((x) => add(x, role, field));
  };
  for (const k of TEXT_FIELDS) add(f[k], 'field', k);
  for (const k of LIST_FIELDS) add(f[k], 'field', k);
  if (step.kind === 'explain-chain') add(f.prompt, 'field', 'prompt');
  if (isObj(f.skeptic)) {
    add(f.skeptic.says, 'field', 'skeptic');
    add(f.skeptic.check, 'field', 'skeptic');
  }
  if (Array.isArray(f.choices)) {
    for (const c of f.choices) {
      if (!isObj(c)) continue;
      add(c.text, 'choice', 'choices');
      add(c.feedback, 'feedback', 'feedback');
    }
  }
  if (Array.isArray(f.assert)) {
    for (const a of f.assert) {
      if (!isObj(a)) continue;
      add(a.say, 'say', 'assert');
      add(a.else, 'say', 'assert');
    }
  }
  if (Array.isArray(f.columns)) for (const c of f.columns) if (isObj(c)) add(c.text, 'field', 'columns');
  return out;
}

/** Parse + normalise in one call. */
export function loadLessonSource(source: string, opts: NormaliseOptions = {}): NormaliseResult {
  return normaliseLesson(parseLesson(source), opts);
}

/** Every step in a lesson, folds and transfers included, in document order. */
export function allSteps(steps: Step[]): Step[] {
  return steps.flatMap((s) => [s, ...allSteps(s.children)]);
}

/** loader.ts's interface (lane T1-app): lenient load, first error with its line. */
export function parseLessonForLoader(
  text: string,
  path: string,
): { ok: true; lesson: LoadedLesson } | { ok: false; error: { file: string; line: number; message: string } } {
  const { lesson, issues } = loadLessonSource(text, { mode: 'lenient', file: path });
  const first = issues.find((i) => i.severity === 'error');
  if (!lesson || first) {
    return { ok: false, error: { file: path, line: first?.line ?? 1, message: first?.message ?? 'The lesson could not be read.' } };
  }
  const images = lesson.sections.flatMap((s) =>
    allSteps(s.steps)
      .map((st) => st.fields.image)
      .filter((x): x is string => typeof x === 'string'),
  );
  return {
    ok: true,
    lesson: {
      id: lesson.meta.id,
      title: lesson.meta.title,
      draft: lesson.meta.draft === true,
      permissions: lesson.meta.permissions ?? {},
      sections: lesson.sections.map((s) => ({ id: s.id })),
      images,
    },
  };
}
