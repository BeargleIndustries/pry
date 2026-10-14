// The T1 outline-coverage gate (plan T1 gate, pre-mortem 5, R4-4): one skeleton per
// approved outline, in the lesson format, that parses and lints clean under
// --skeleton, and maps section by section to its outline. The outline side is read
// programmatically: headings, named actions, pointers, checks and TN-4 mentions.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { findOutlines } from '../../../scripts/outline-rows';
import { copyLint, type LintWords, type TermsData } from './format/copy-lint';
import { formatIssue, type LessonIssue } from './format/errors';
import { lintLessonSet } from './format/lint';
import { allSteps, findBindings, loadLessonSource, stepTexts } from './format/normalise';
import type { Lesson, Section } from './format/schema';
import { pryToolSet } from './registry/pry-set';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const skeletonDir = here('./fixtures/outline-coverage');
const outlinesDir = findOutlines(here('../../..'));
const terms = parse(readFileSync(here('../../lessons/terms.yaml'), 'utf8')) as TermsData;
const words = parse(readFileSync(here('../../lessons/lint-words.yaml'), 'utf8')) as LintWords;

/** Outline file names in path order (map section 0); the tour sits outside the path. */
const OUTLINES = ['P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5', 'P1.6', 'P2.1', 'P2.2', 'P2.3', 'P2.4', 'P2.5', 'P3.1', 'P3.2', 'P3.3', 'P3.4', 'P3.5', 'P3.6', 'P3.7', 'P4.1', 'quick-tour'];
const lessonId = (name: string) => (name === 'quick-tour' ? 'pry.quick-tour' : `pry.${name.toLowerCase().replace('.', '-')}`);
const PATH = OUTLINES.filter((n) => n !== 'quick-tour').map(lessonId);

function loadSkeletons(): { lessons: Map<string, Lesson>; issues: Map<string, LessonIssue[]> } {
  const lessons = new Map<string, Lesson>();
  const issues = new Map<string, LessonIssue[]>();
  for (const name of OUTLINES) {
    const file = join(skeletonDir, `${name}.md`);
    const r = loadLessonSource(readFileSync(file, 'utf8'), { mode: 'strict', tool: pryToolSet, file: `${name}.md` });
    issues.set(name, r.issues);
    if (r.lesson) lessons.set(name, r.lesson);
  }
  return { lessons, issues };
}

describe('outline-coverage', () => {
  it('› every outline skeleton parses and lints clean (structural, overlay, copy) under --skeleton', () => {
    expect(readdirSync(skeletonDir).filter((f) => f.endsWith('.md')).sort()).toEqual(OUTLINES.map((n) => `${n}.md`).sort());
    const { lessons, issues } = loadSkeletons();
    expect([...lessons.keys()].sort()).toEqual([...OUTLINES].sort());
    const set = [...lessons.values()];
    const structural = lintLessonSet(set, {
      tool: pryToolSet,
      bundled: true,
      skeleton: true,
      knownLessons: OUTLINES.map(lessonId),
      caveatTools: Object.keys(words.pinned_caveats),
    });
    const problems: string[] = [];
    for (const [name, lesson] of lessons) {
      expect(lesson.meta.id).toBe(lessonId(name));
      const all = [
        ...(issues.get(name) ?? []),
        ...(structural.get(lesson.meta.id) ?? []),
        ...copyLint(lesson, { terms, words, path: PATH }).map((i) => ({ ...i, file: `${name}.md` })),
      ];
      for (const i of all) if (i.severity === 'error') problems.push(formatIssue(i));
    }
    expect(problems).toEqual([]);
    // The tour is an overlay; every other skeleton runs in the sidebar.
    expect(lessons.get('quick-tour')!.meta.presentation).toBe('overlay');
    for (const [name, l] of lessons) if (name !== 'quick-tour') expect(l.meta.presentation ?? 'sidebar').toBe('sidebar');
  });

  it.skipIf(!outlinesDir)(
    '› every outline §3 subsection, §5 transfer and §6 explain-the-chain maps to a skeleton section, and every action, check, pointer and TN-4 key the outline names appears in its mapped section',
    () => {
      const { lessons } = loadSkeletons();
      const missing: string[] = [];
      // Every remember key any skeleton declares, as `lesson-id.key`.
      const declared = new Set<string>();
      for (const l of lessons.values()) {
        for (const s of l.sections) {
          for (const st of allSteps(s.steps)) {
            const r = st.fields.remember;
            const k = typeof r === 'string' ? r : r && typeof r === 'object' ? r.key : undefined;
            if (typeof k === 'string') declared.add(`${l.meta.id}.${k}`);
          }
        }
      }
      for (const name of OUTLINES) {
        const lesson = lessons.get(name);
        expect(lesson, name).toBeDefined();
        const outline = outlineSections(name, readFileSync(join(outlinesDir!, `${name}.md`), 'utf8'));
        expect(outline.length, name).toBeGreaterThan(0);
        for (const os of outline) {
          const ref = `${name}.md#${os.key}`;
          const secs = lesson!.sections.filter((s) => s.outline === ref);
          if (!secs.length) {
            missing.push(`${ref}: no skeleton section`);
            continue;
          }
          const have = sectionContents(lesson!, secs);
          for (const n of named(os.text)) {
            if (n.kind === 'unmapped') missing.push(`${ref}: \`${n.name}\` names no registry action`);
            else if (n.kind === 'action' && !have.actions.has(n.name)) missing.push(`${ref}: action ${n.name}`);
            else if (n.kind === 'anchor' && !have.anchors.has(n.name)) missing.push(`${ref}: pointer ${n.name}`);
            else if (n.kind === 'readout' && !n.names.some((r) => [...have.checkReads].some((c) => c === r || (r.endsWith('.') && c.startsWith(r))))) {
              missing.push(`${ref}: no check reads ${n.names.join(' / ')}`);
            } else if (n.kind === 'check' && have.checks === 0) missing.push(`${ref}: check`);
            else if (n.kind === 'remember' && have.remembers.size === 0) missing.push(`${ref}: TN-4 remember`);
            else if (n.kind === 'earlier' && have.earlier.size === 0) missing.push(`${ref}: TN-4 earlier read`);
          }
          for (const k of have.earlier) if (!declared.has(k) && !declared.has(`${lesson!.meta.id}.${k}`)) missing.push(`${ref}: TN-4 key ${k} is read but no skeleton remembers it`);
          // Action arguments the outline writes as literals match a call in the section.
          for (const c of calls(os.text)) {
            const cands = have.calls.filter((x) => x.name === c.name);
            if (!cands.length || cands.every((x) => x.learner)) continue;
            const ok = cands.some((x) => Object.entries(c.args).every(([k, v]) => JSON.stringify(x.args[k]) === JSON.stringify(v)));
            if (!ok) missing.push(`${ref}: ${c.name} ${JSON.stringify(c.args)} has no matching call`);
          }
          // Task fields the outline names.
          const tasks = secs.flatMap((s) => allSteps(s.steps)).filter((s) => s.kind === 'task');
          for (const r of taskRules(os.text)) {
            const ok =
              r === 'task' ? tasks.length > 0
              : r === 'reset' ? tasks.length > 0 && tasks.every((t) => t.fields.reset !== undefined)
              : r.startsWith('constraint') ? tasks.some((t) => t.fields.constraint || t.fields.one_change || t.fields.max_runs) ||
                // A constraint nothing can check ("read its three logits before you trust its colour", P3.3:64) is told in the task.
                norm(tasks.flatMap((t) => stepTexts(t).map((x) => x.text)).join(' ')).includes(norm(r.slice('constraint:'.length)))
              : r === 'predict_before_each_run' ? tasks.some((t) => t.fields.predict_before_each_run === true)
              : tasks.some((t) => t.fields.max_runs === Number(r.slice('max_runs:'.length)));
            if (!ok) missing.push(`${ref}: task ${r}`);
          }
          // Lines the copy lint judges are copied verbatim (numbers may become slots or inline code).
          const text = norm(have.texts.join('\n'));
          for (const q of judgedLines(os.text)) if (!text.includes(norm(q))) missing.push(`${ref}: not verbatim: "${q}"`);
        }
        for (const s of lesson!.sections) {
          if (!s.outline) missing.push(`${name}: section "${s.title}" has no outline reference`);
          else if (!outline.some((o) => `${name}.md#${o.key}` === s.outline)) missing.push(`${name}: section "${s.title}" points at ${s.outline}, which the outline doesn't have`);
        }
      }
      expect(missing).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// The outline side.

interface OutlineSection {
  key: string;
  text: string;
}

/** §3 subsections (`### 3.N`, `**3.N ...**` or a tour table row), §5 and §6 unless they're n/a. */
function outlineSections(name: string, src: string): OutlineSection[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: OutlineSection[] = [];
  let top = '';
  let cur: OutlineSection | null = null;
  const push = (s: OutlineSection) => {
    out.push(s);
    cur = s;
  };
  for (const line of lines) {
    const h2 = /^##\s+(\d+)\.\s/.exec(line);
    if (h2) {
      top = h2[1];
      cur = null;
      if (top === '5' || top === '6') push({ key: top, text: '' });
      continue;
    }
    if (top === '3') {
      const sub = /^(?:###\s+|\*\*)(3\.\d+)\b/.exec(line);
      if (sub) {
        push({ key: sub[1], text: line });
        continue;
      }
      const row = /^\|\s*(\d+)\s*\|/.exec(line);
      if (name === 'quick-tour' && row) {
        push({ key: `3.${row[1]}`, text: line });
        cur = null;
        continue;
      }
    }
    if (cur) (cur as OutlineSection).text += `\n${line}`;
  }
  return out.filter((s) => !/^\s*n\/a\b/im.test(s.text.trim()));
}

/** Outline API names (camelCase, as the outlines write them) to registry action names. */
const ACTION_ALIASES: Record<string, string> = {
  runGenerate: 'run',
  openLeftTab: 'open_panel',
  openRightTab: 'open_panel',
  setComparePrompts: 'set_compare',
  setPanelAAggregation: 'set_aggregation',
  hideCopyingHeads: 'show_copying_heads',
  setDlaTarget: 'run_dla',
};
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toAction = (s: string): string | undefined => {
  const name = ACTION_ALIASES[s] ?? snake(s);
  return pryToolSet.actions[name] ? name : undefined;
};

/** Result objects the outlines' checks read, to the registry readouts that read them. */
const RESULT_READOUTS: Record<string, string[]> = {
  response: ['top_guess.', 'prediction', 'word_tokens', 'tokens', 'top_k'],
  compareResult: ['compare.'],
  compareDelta: ['compare.delta'],
  headAblationResult: ['ablation.'],
  featureAblationResult: ['feature_ablation.'],
  dlaResult: ['dla.'],
  logitLensResult: ['lens.'],
  patchingResult: ['patch.'],
  steerResult: ['steer.'],
  circuitResult: ['circuit.'],
  circuitTarget: ['circuit.target'],
  headScoresResult: ['head_scores.'],
};
/** Backticked camelCase names that aren't actions or results (a code name the outline cites). */
const NOT_ACTIONS = new Set(['explainingLabel', 'temperatureExplanation', 'activeTab', 'targetLabel']);

type Named =
  | { kind: 'action' | 'anchor' | 'check' | 'remember' | 'earlier' | 'unmapped'; name: string }
  | { kind: 'readout'; name: string; names: string[] };

/** "`ensureRun` not needed" (P4.1:39) names something the section leaves out. */
const NOT_NEEDED = /^\s*(?:is\s+)?not needed/i;

/** Every action, pointer, check, result readout and TN-4 key one outline section names. */
function named(text: string): Named[] {
  const out = new Map<string, Named>();
  const add = (n: Named) => out.set(`${n.kind}:${n.name}`, n);
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const code = m[1];
    if (NOT_NEEDED.test(text.slice(m.index! + m[0].length))) continue;
    const id = /^[A-Za-z_][\w-]*/.exec(code)?.[0] ?? '';
    if (RESULT_READOUTS[id] && code.includes('(')) add({ kind: 'readout', name: id, names: RESULT_READOUTS[id] });
    // An action: an outline call (`setPrompt(...)`), a camelCase name or a bare registry name (`highlight`).
    if (/[A-Z]/.test(id) || code.includes('(') || pryToolSet.actions[id]) {
      const action = toAction(id);
      if (action) add({ kind: 'action', name: action });
      else if (/^[a-z]+[A-Z]\w*$/.test(id) && !RESULT_READOUTS[id] && !NOT_ACTIONS.has(id)) add({ kind: 'unmapped', name: id });
    }
    if (pryToolSet.anchors[code]) add({ kind: 'anchor', name: code });
    for (const a of code.matchAll(/highlight\(\s*['"]([^'"]+)['"]/g)) add({ kind: 'anchor', name: a[1] });
  }
  for (const line of text.split('\n')) {
    // Pointers and the tour's anchor column name anchors even when the registry lacks them.
    const pointer = /^\s*-\s*(?:\*\*)?Pointer(?:\*\*)?:?(?:\*\*)?\s*(.*)$/i.exec(line)?.[1];
    const row = /^\|\s*\d+\s*\|([^|]*)\|/.exec(line)?.[1];
    for (const src of [pointer, row]) {
      if (!src) continue;
      for (const m of src.matchAll(/`([a-z][a-z0-9-]*)`/g)) add({ kind: 'anchor', name: m[1] });
    }
    // Prose pointers on named head cells ("pointer on cells L9H9, L9H6, L10H0", P3.2:51).
    if (/pointer on cells? L\d+H\d+/i.test(line)) add({ kind: 'anchor', name: 'head-cell' });
    // A check line, unless it says there's none here or that it follows in another section.
    const deferred = /:\s*(?:\*\*)?\s*none\b/i.test(line) || /\bin 3\.\d/i.test(line);
    if (/^\s*-\s*(?:\*\*)?Check\b[^:]*:/i.test(line) && !deferred) add({ kind: 'check', name: 'check' });
  }
  for (const m of text.matchAll(/\bTN-4\b\**\s*(\w+)?/g)) {
    if (NOT_NEEDED.test(text.slice(m.index! + 4))) continue;
    add(/^(records|stores)$/.test(m[1] ?? '') ? { kind: 'remember', name: 'TN-4' } : { kind: 'earlier', name: 'TN-4' });
  }
  return [...out.values()];
}

/** Positional argument names for outline calls. */
const POSITIONAL: Record<string, string[]> = {
  set_prompt: ['text'],
  ensure_run: ['prompt'],
  open_panel: ['panel'],
  set_attention_view: ['view'],
  set_patch_view: ['type'],
  highlight: ['anchor'],
  set_compare: ['a', 'b'],
  set_compare_mode: ['on'],
  run_patching: ['clean', 'corrupted', 'type'],
  open_head: ['layer', 'head'],
  set_lines_head: ['layer', 'head'],
  focus_patch_cell: ['layer', 'position'],
  set_head_ablation: ['on', 'heads'],
  set_feature_ablation: ['ids', 'on'],
  show_copying_heads: ['on'],
};
const KEY_ALIASES: Record<string, string> = { featureId: 'feature_id' };

/** Splits on commas outside quotes, braces and brackets. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A literal outline argument, or undefined for a placeholder (`row 1`, `{map_head}`, `<default>`). */
function literal(v: string): unknown {
  const t = v.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return JSON.parse(t);
  if (/^'[^']*'$/.test(t)) return t.slice(1, -1).replace(/\\n/g, '\n');
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  return undefined;
}

/** Outline calls with their literal arguments, e.g. `writeIt({temperature: 0})` -> write_it {temperature: 0}. */
function calls(text: string): { name: string; args: Record<string, unknown> }[] {
  const out: { name: string; args: Record<string, unknown> }[] = [];
  for (const m of text.matchAll(/`(\w+)\(([^`]*)\)`/g)) {
    const name = toAction(m[1]);
    if (!name) continue;
    const args: Record<string, unknown> = {};
    let parts = splitTop(m[2]);
    // `runPatching(..., 'resid')`: elided leading arguments, so the rest line up from the end.
    const pos = POSITIONAL[name] ?? [];
    const offset = parts[0] === '...' ? pos.length - parts.length : 0;
    if (parts[0] === '...') parts = ['', ...parts.slice(1)];
    parts.forEach((p, j) => {
      const i = j + offset;
      if (p.startsWith('{') && p.endsWith('}')) {
        for (const kv of splitTop(p.slice(1, -1))) {
          const km = /^(\w+)\s*:\s*([\s\S]+)$/.exec(kv);
          if (!km) continue;
          const v = literal(km[2]);
          if (v !== undefined) args[KEY_ALIASES[km[1]] ?? km[1]] = v;
        }
      } else {
        const key = POSITIONAL[name]?.[i];
        const v = literal(p);
        if (key && v !== undefined) args[key] = v;
      }
    });
    if (Object.keys(args).length) out.push({ name, args });
  }
  return out;
}

/** Task rules an outline section names: the task itself, reset, constraint, prediction before each run, max runs. */
function taskRules(text: string): string[] {
  if (!/\*\*Task:\*\*|^\s*-\s*Task:/m.test(text)) return [];
  const out = ['task'];
  if (/\bReset:/.test(text)) out.push('reset');
  const constraint = /\bConstraint:\**\s*([^.\n]+)/.exec(text)?.[1];
  if (constraint) out.push(`constraint:${constraint}`);
  if (/prediction (?:typed )?before each|before each run/i.test(text)) out.push('predict_before_each_run');
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const most = /at most (\w+) (?:runs|knockouts)/i.exec(text)?.[1];
  const n = most ? (words[most] ?? Number(most)) : NaN;
  if (n) out.push(`max_runs:${n}`);
  return out;
}

/** Outline labels whose quoted text is a plan, not lesson copy. */
const UNJUDGED =
  /^(term|new term|idea|one idea|app state|expected|pointer|image|single image|explain image|kind|note|why here|wording|retired phrasing|model verb rule|labelled plainly|tool needs|exact prompt|prompts?\b|ui label|picture|afterwards|reveal|feedback|metaphor|analogy)/;

/** Quoted lines (4+ words) under labels the copy lint judges, plus every analogy's `breaks`. */
function judgedLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\|/.test(line)) continue; // tour rows: "outline, not prose"
    // `breaks:` text runs to the end of the line, minus a trailing note in parentheses.
    const brk = /`breaks:`\s*(.+)$|`breaks`:\s*(.+)$/.exec(line);
    if (brk) out.push((brk[1] ?? brk[2]).replace(/\s*\([^)]*\)\.?\s*$/, '').replace(/\s*The lesson says .*$/, '').trim());
    const label = line.replace(/^\s*-\s*/, '').split(':')[0].replace(/\*\*/g, '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
    if (UNJUDGED.test(label) && !/^feedback (for|when|on|\()/.test(label)) continue;
    // Inline code keeps its words (`The nurse said that` in a stem); "[tempting: ...]" notes aren't copy.
    const bare = line.replace(/`([^`]*)`/g, (_, c: string) => c.replace(/["“”]/g, '')).replace(/\[tempting[^\]]*\]/g, ' ');
    for (const m of bare.matchAll(/"([^"]+)"|“([^”]+)”/g)) {
      const q = (m[1] ?? m[2]).trim();
      if (q.split(/\s+/).length >= 4) out.push(q);
    }
  }
  return out;
}

/** Words only: numbers, natural frequencies, slots, inline-code marks and punctuation removed. */
function norm(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/:earlier\{[^}]*\}\[[^\]]*\]/g, ' ')
    .replace(/\{[a-z_][a-z0-9_]*\}/g, ' ')
    .replace(/\(?about \d+ in \d+\)?/g, ' ')
    .replace(/`/g, ' ')
    .replace(/:[a-z]+\{[^}]*\}/g, ' ')
    .replace(/:[a-z]+\[/g, ' ')
    .replace(/\b[lh]?\d+(?:[.,]\d+)?(?:h\d+)?%?/g, ' ')
    .replace(/[^a-z']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

// ---------------------------------------------------------------------------
// The skeleton side.

interface Contents {
  actions: Set<string>;
  calls: { name: string; args: Record<string, unknown>; learner?: boolean }[];
  anchors: Set<string>;
  /** Readouts a check item reads: observe checks, task targets and constraints, `when`. */
  checkReads: Set<string>;
  checks: number;
  remembers: Set<string>;
  earlier: Set<string>;
  texts: string[];
}

/** Enter keys that set the same state an action does. */
const ENTER_ACTIONS: Record<string, [string, string]> = { prompt: ['set_prompt', 'text'], open_panel: ['open_panel', 'panel'], dla_target: ['run_dla', ''] };

function sectionContents(lesson: Lesson, secs: Section[]): Contents {
  const c: Contents = { actions: new Set(), calls: [], anchors: new Set(), checkReads: new Set(), checks: 0, remembers: new Set(), earlier: new Set(), texts: [] };
  const readItems = (v: unknown) => {
    for (const x of Array.isArray(v) ? v : v ? [v] : []) if (x && typeof x === 'object' && typeof (x as any).read === 'string') c.checkReads.add((x as any).read);
  };
  if (lesson.meta.cold_entry) c.texts.push(lesson.meta.cold_entry);
  // A predict's choice feedback shows when its observe answers it, so it counts in the observe's section.
  const ids = new Set(secs.flatMap((s) => allSteps(s.steps)).map((s) => s.id));
  for (const s of lesson.sections) {
    for (const st of allSteps(s.steps)) {
      if (st.kind === 'predict' && ids.has(st.fields.checks)) for (const t of stepTexts(st)) if (t.role === 'feedback') c.texts.push(t.text);
    }
  }
  for (const s of secs) {
    for (const [k, v] of Object.entries(s.enter?.value ?? {})) {
      const e = ENTER_ACTIONS[k];
      if (!e) continue;
      c.actions.add(e[0]);
      c.calls.push({ name: e[0], args: e[1] ? { [e[1]]: v } : (v as Record<string, unknown>) });
    }
    for (const st of allSteps(s.steps)) {
      const f = st.fields;
      for (const a of st.actions) {
        c.actions.add(a.name);
        c.calls.push({ name: a.name, args: a.args });
        if (a.name === 'highlight') {
          if (typeof a.args.anchor === 'string') c.anchors.add(a.args.anchor);
          for (const x of Array.isArray(a.args.anchors) ? a.args.anchors : []) c.anchors.add(String(x));
        }
        if (a.name === 'set_hidden' && typeof a.args.anchor === 'string') c.anchors.add(a.args.anchor);
        for (const e of findBindings(a.args).earlier) c.earlier.add(e.key);
      }
      for (const h of f.hides ?? []) c.anchors.add(h);
      if (typeof f.one_change === 'string') c.actions.add(f.one_change);
      for (const a of f.learner_actions ?? []) {
        c.actions.add(a);
        c.calls.push({ name: a, args: {}, learner: true });
      }
      readItems(f.check);
      readItems(f.target);
      readItems(f.constraint);
      readItems(f.when);
      if ((st.kind === 'observe' && (f.check || f.journal)) || st.kind === 'question' || st.kind === 'task') c.checks++;
      const r = f.remember;
      const rk = typeof r === 'string' ? r : r && typeof r === 'object' ? r.key : undefined;
      if (typeof rk === 'string') c.remembers.add(rk);
      for (const m of JSON.stringify(f).matchAll(/"\$earlier":"([^"]+)"|\$earlier\.([\w.-]+)/g)) c.earlier.add(m[1] ?? m[2]);
      for (const p of st.prose) {
        for (const n of p.inline) {
          if (n.type === 'look') {
            const at = n.attrs?.at;
            for (const t of Array.isArray(at) ? at : at ? [at] : []) c.anchors.add(t);
          }
          if (n.type === 'earlier' && typeof n.attrs?.key === 'string') c.earlier.add(n.attrs.key);
        }
      }
      for (const t of stepTexts(st)) {
        c.texts.push(t.text);
        for (const m of t.text.matchAll(/:earlier\{[^}]*key="?([^"}\s]+)/g)) c.earlier.add(m[1]);
      }
    }
  }
  return c;
}
