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
      for (const name of OUTLINES) {
        const lesson = lessons.get(name);
        expect(lesson, name).toBeDefined();
        const outline = outlineSections(name, readFileSync(join(outlinesDir!, `${name}.md`), 'utf8'));
        expect(outline.length, name).toBeGreaterThan(0);
        const mapped = new Set<string>();
        for (const os of outline) {
          const ref = `${name}.md#${os.key}`;
          const secs = lesson!.sections.filter((s) => s.outline === ref);
          if (!secs.length) {
            missing.push(`${ref}: no skeleton section`);
            continue;
          }
          mapped.add(ref);
          const have = sectionContents(lesson!, secs);
          for (const n of named(os.text)) {
            const ok =
              n.kind === 'action' ? have.actions.has(n.name)
              : n.kind === 'anchor' ? have.anchors.has(n.name)
              : n.kind === 'readout' ? [...have.readouts].some((r) => r === n.name || r.startsWith(n.name))
              : n.kind === 'check' ? have.checks > 0
              : have.tn4;
            if (!ok) missing.push(`${ref}: ${n.kind} ${n.name}`);
          }
        }
        // And nothing in the skeleton points at an outline section that isn't there.
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

/** Result objects the outlines' checks read, to the registry readout prefix that reads them. */
const RESULT_READOUTS: Record<string, string> = {
  compareResult: 'compare.',
  compareDelta: 'compare.delta',
  headAblationResult: 'ablation.',
  featureAblationResult: 'feature_ablation.',
  dlaResult: 'dla.',
  logitLensResult: 'lens.',
  patchingResult: 'patch.',
  steerResult: 'steer.',
  circuitResult: 'circuit.',
  circuitTarget: 'circuit.target',
  headScoresResult: 'head_scores.',
};

interface Named {
  kind: 'action' | 'anchor' | 'readout' | 'check' | 'tn4';
  name: string;
}

/** Every action, pointer, check, result readout and TN-4 key one outline section names. */
function named(text: string): Named[] {
  const out = new Map<string, Named>();
  const add = (n: Named) => out.set(`${n.kind}:${n.name}`, n);
  // "`ensureRun` not needed" (P4.1:39) names something the section leaves out.
  const NOT_NEEDED = /^\s*(?:is\s+)?not needed/i;
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const code = m[1];
    if (NOT_NEEDED.test(text.slice(m.index! + m[0].length))) continue;
    const id = /^[A-Za-z_][\w-]*/.exec(code)?.[0] ?? '';
    // An action: an outline call (`setPrompt(...)`) or a bare registry name (`highlight`).
    const action = /[A-Z]/.test(id) || code.includes('(') || pryToolSet.actions[id] ? toAction(id) : undefined;
    if (action) add({ kind: 'action', name: action });
    // Anchors: a registry anchor, or a highlight() argument.
    if (pryToolSet.anchors[code]) add({ kind: 'anchor', name: code });
    for (const a of code.matchAll(/highlight\(\s*['"]([^'"]+)['"]/g)) add({ kind: 'anchor', name: a[1] });
    const result = /^(\w+)\(?/.exec(code)?.[1];
    if (result && RESULT_READOUTS[result]) add({ kind: 'readout', name: RESULT_READOUTS[result] });
  }
  // Pointers and the tour's anchor column name anchors even when the registry lacks them.
  for (const line of text.split('\n')) {
    const pointer = /^\s*-\s*(?:\*\*)?Pointer(?:\*\*)?:?(?:\*\*)?\s*(.*)$/i.exec(line)?.[1];
    const row = /^\|\s*\d+\s*\|([^|]*)\|/.exec(line)?.[1];
    for (const src of [pointer, row]) {
      if (!src) continue;
      for (const m of src.matchAll(/`([a-z][a-z0-9-]*)`/g)) add({ kind: 'anchor', name: m[1] });
    }
    // A check line, unless it says there's none here or that it follows in another section.
    const deferred = /:\s*(?:\*\*)?\s*none\b/i.test(line) || /\bin 3\.\d/i.test(line);
    if (/^\s*-\s*(?:\*\*)?Check\b[^:]*:/i.test(line) && !deferred) add({ kind: 'check', name: 'check' });
  }
  if ([...text.matchAll(/\bTN-4\b/g)].some((m) => !NOT_NEEDED.test(text.slice(m.index! + 4)))) add({ kind: 'tn4', name: 'TN-4' });
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// The skeleton side.

interface Contents {
  actions: Set<string>;
  anchors: Set<string>;
  readouts: Set<string>;
  checks: number;
  tn4: boolean;
}

/** Enter keys that set the same state an action does. */
const ENTER_ACTIONS: Record<string, string> = { prompt: 'set_prompt', open_panel: 'open_panel', dla_target: 'run_dla' };

function sectionContents(lesson: Lesson, secs: Section[]): Contents {
  const c: Contents = { actions: new Set(), anchors: new Set(), readouts: new Set(), checks: 0, tn4: false };
  const readItems = (v: unknown) => {
    for (const x of Array.isArray(v) ? v : v ? [v] : []) if (x && typeof x === 'object' && typeof (x as any).read === 'string') c.readouts.add((x as any).read);
  };
  for (const s of secs) {
    for (const k of Object.keys(s.enter?.value ?? {})) if (ENTER_ACTIONS[k]) c.actions.add(ENTER_ACTIONS[k]);
    const slots = { ...(lesson.meta.slots ?? {}), ...(s.slots ?? {}) };
    for (const slot of Object.values(s.slots ?? {})) if (slot.read) c.readouts.add(slot.read);
    for (const st of allSteps(s.steps)) {
      const f = st.fields;
      for (const a of st.actions) {
        c.actions.add(a.name);
        if (a.name === 'highlight') {
          if (typeof a.args.anchor === 'string') c.anchors.add(a.args.anchor);
          for (const x of Array.isArray(a.args.anchors) ? a.args.anchors : []) c.anchors.add(String(x));
        }
        if (a.name === 'set_hidden' && typeof a.args.anchor === 'string') c.anchors.add(a.args.anchor);
        if (findBindings(a.args).earlier.length) c.tn4 = true;
      }
      for (const h of f.hides ?? []) c.anchors.add(h);
      if (typeof f.one_change === 'string') c.actions.add(f.one_change);
      for (const a of f.learner_actions ?? []) c.actions.add(a);
      readItems(f.check);
      readItems(f.target);
      readItems(f.constraint);
      readItems(f.when);
      readItems(f.columns);
      if (f.remember && typeof f.remember === 'object') c.readouts.add(f.remember.read);
      if ((st.kind === 'observe' && (f.check || f.journal)) || st.kind === 'question' || st.kind === 'task') c.checks++;
      if (f.remember !== undefined) c.tn4 = true;
      if (JSON.stringify(f).includes('$earlier')) c.tn4 = true;
      for (const p of st.prose) {
        for (const n of p.inline) {
          if (n.type === 'look') {
            const at = n.attrs?.at;
            for (const t of Array.isArray(at) ? at : at ? [at] : []) c.anchors.add(t);
          }
          if (n.type === 'earlier') c.tn4 = true;
        }
      }
      // Slots a step shows count as readouts its section reads.
      for (const t of stepTexts(st)) for (const m of t.text.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)) if (slots[m[1]]?.read) c.readouts.add(slots[m[1]].read!);
    }
  }
  return c;
}

