// Plan T6 acceptance (plan:544): the bundled lessons against the approved
// curriculum. One `it` per row of the acceptance list, plus the index checks.
//
// While the T6 lanes run apart, a lane's worktree holds only its own lessons:
// a check that needs a lesson another lane writes waits for it (named in
// OTHER_LANES); everything present is checked in full.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { loadLessonSource } from './format/normalise';
import { parseIndex } from './format/parse';
import { pryToolSet } from './registry/pry-set';
import type { Lesson, Step } from './format/schema';

const UI = fileURLToPath(new URL('../../..', import.meta.url));
const LESSONS = join(UI, 'src/lessons');
const SKELETONS = join(UI, 'src/lib/lessons/fixtures/outline-coverage');

/** Plan:511-534: id, title, minutes, the concept map's rows. */
const TABLE: { id: string; title: string; minutes: number; map: number[] }[] = [
  { id: 'pry.quick-tour', title: "What's on Pry's screen?", minutes: 5, map: [] },
  { id: 'pry.p1-1', title: 'Is there a database in there?', minutes: 10, map: [1, 2, 3] },
  { id: 'pry.p1-2', title: 'Does the model read words?', minutes: 12, map: [6, 7] },
  { id: 'pry.p1-3', title: 'What happens between your prompt and the guess?', minutes: 10, map: [1, 18, 30] },
  { id: 'pry.p1-4', title: 'Is the top guess the right answer?', minutes: 10, map: [3, 4, 5] },
  { id: 'pry.p1-5', title: "Why doesn't it say the same thing every time?", minutes: 10, map: [1, 8, 28] },
  { id: 'pry.p1-6', title: 'Does it learn from you? Where did its numbers come from?', minutes: 12, map: [1, 8, 9, 10, 28, 29] },
  { id: 'pry.p2-1', title: 'Where does each token pull information from?', minutes: 12, map: [14, 23] },
  { id: 'pry.p2-2', title: 'Can we catch a head doing one job?', minutes: 10, map: [15, 16] },
  { id: 'pry.p2-3', title: 'What would each layer guess?', minutes: 10, map: [1, 14, 17, 20, 21] },
  { id: 'pry.p2-4', title: 'Which parts pushed toward the answer?', minutes: 12, map: [1, 14, 17, 22] },
  { id: 'pry.p2-5', title: 'What patterns can a tool find in the residual stream?', minutes: 12, map: [1, 7] },
  { id: 'pry.p3-1', title: 'Did the change cause it?', minutes: 10, map: [14, 17, 31] },
  { id: 'pry.p3-2', title: 'Switch it off: did it matter?', minutes: 12, map: [14, 23, 26] },
  { id: 'pry.p3-3', title: 'Which part carries the difference?', minutes: 12, map: [14, 27, 32] },
  { id: 'pry.p3-4', title: 'Switch a feature off: was it doing anything?', minutes: 10, map: [17, 24] },
  { id: 'pry.p3-5', title: 'Turn one feature up: does the text follow the label?', minutes: 12, map: [25, 33] },
  { id: 'pry.p3-6', title: 'Case study: where does a fact come from?', minutes: 12, map: [1, 18, 20, 34, 35] },
  { id: 'pry.p3-7', title: 'Case study: build a case', minutes: 15, map: [14, 19, 36] },
  { id: 'pry.p4-1', title: "Why doesn't GPT-2 act like ChatGPT?", minutes: 10, map: [11, 12, 21, 28, 37, 38, 39] },
];

/** Lessons the other T6 lanes write (ralph-t6-brief): allowed to be missing until the lanes merge. */
const OTHER_LANES: Record<string, string> = Object.fromEntries([
  ...['pry.p2-1', 'pry.p2-2', 'pry.p2-3', 'pry.p2-4', 'pry.p2-5'].map((id) => [id, 'lane/t6-s2']),
  ...['pry.p3-1', 'pry.p3-2', 'pry.p3-3', 'pry.p3-4', 'pry.p3-5', 'pry.p3-6', 'pry.p3-7', 'pry.p4-1'].map((id) => [id, 'lane/t6-s3']),
]);

/** `pry.p1-2` → the skeleton file and the outline label rows use (`P1.2`). */
const outlineName = (id: string) => (id === 'pry.quick-tour' ? 'quick-tour' : id.replace(/^pry\.p(\d)-(\d)$/, 'P$1.$2'));

function load(file: string): Lesson {
  const { lesson, issues } = loadLessonSource(readFileSync(file, 'utf8'), { mode: 'strict', tool: pryToolSet, file });
  const errors = issues.filter((i) => i.severity === 'error');
  if (!lesson || errors.length) throw new Error(`${file}: ${errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`);
  return lesson;
}

const folders = readdirSync(LESSONS).filter((d) => !d.startsWith('_') && existsSync(join(LESSONS, d, 'lesson.md')));
const lessons = new Map(folders.map((d) => [d, load(join(LESSONS, d, 'lesson.md'))]));
const all = [...lessons.values()];
const sidebar = all.filter((l) => l.meta.presentation !== 'overlay');
const indexIds = parseIndex(readFileSync(join(LESSONS, 'index.yaml'), 'utf8'));

function steps(l: Lesson): Step[] {
  const out: Step[] = [];
  const walk = (ss: Step[]) => ss.forEach((s) => (out.push(s), walk(s.children)));
  l.sections.forEach((sec) => walk(sec.steps));
  return out;
}
const kinds = (l: Lesson) => new Set(steps(l).map((s) => s.kind));

describe('lessons content', () => {
  it('› index.yaml lists all 20 lessons in the plan order with stages, and every bundled folder', () => {
    expect(indexIds).toEqual(TABLE.map((t) => t.id));
    const doc = parseYaml(readFileSync(join(LESSONS, 'index.yaml'), 'utf8')) as { lessons: { id: string; stage: number }[] };
    for (const e of doc.lessons) expect(typeof e.stage, e.id).toBe('number');
    for (const l of all) {
      expect(indexIds, `${l.meta.id} isn't in index.yaml`).toContain(l.meta.id);
      expect(doc.lessons.find((e) => e.id === l.meta.id)!.stage, l.meta.id).toBe(l.meta.stage ?? 0);
    }
    // A listed id with no folder: only another lane's, until the lanes merge.
    const missing = indexIds.filter((id) => !lessons.has(id));
    expect(missing.filter((id) => !(id in OTHER_LANES)), 'listed in index.yaml with no folder').toEqual([]);
  });

  it('› every sidebar lesson has predict, observe, explain-result with leaves_open, transfer, explain-chain', () => {
    expect(sidebar.length).toBeGreaterThan(0);
    for (const l of sidebar) {
      const k = kinds(l);
      for (const need of ['predict', 'observe', 'explain-result', 'transfer', 'explain-chain']) expect(k.has(need as never), `${l.meta.id} has no ${need}`).toBe(true);
      for (const s of steps(l).filter((x) => x.kind === 'explain-result')) {
        const lo = s.fields.leaves_open;
        expect(typeof lo === 'string' ? lo.trim() : Array.isArray(lo) && lo.length, `${l.meta.id} line ${s.line}: leaves_open`).toBeTruthy();
      }
    }
  });

  it('› stage 2-3 explain-results have skeptic lines', () => {
    for (const l of sidebar.filter((x) => x.meta.stage === 2 || x.meta.stage === 3)) {
      for (const s of steps(l).filter((x) => x.kind === 'explain-result')) {
        expect(s.fields.skeptic?.says?.trim() && s.fields.skeptic?.check?.trim(), `${l.meta.id} line ${s.line}: skeptic`).toBeTruthy();
      }
    }
  });

  it("› each lesson's ids and minutes match the table and its verified_rows equal the union rule", () => {
    const rowsDoc = parseYaml(readFileSync(join(LESSONS, 'verified-rows.yaml'), 'utf8')) as { rows: { id: number; lessons?: string[] }[] };
    for (const l of all) {
      const t = TABLE.find((x) => x.id === l.meta.id);
      expect(t, `${l.meta.id} isn't in the plan's table`).toBeDefined();
      expect(l.meta.title).toBe(t!.title);
      expect(l.meta.minutes, l.meta.id).toBe(t!.minutes);
      // Union: the map's rows, the outline's own (carried verbatim in its skeleton), rows 40+ citing the lesson.
      const skeleton = load(join(SKELETONS, `${outlineName(l.meta.id)}.md`));
      const own = (skeleton.meta.verified_rows ?? []).map(Number);
      const cited = rowsDoc.rows.filter((r) => r.id >= 40 && (r.lessons ?? []).includes(outlineName(l.meta.id))).map((r) => r.id);
      const union = [...new Set([...t!.map, ...own, ...cited])].sort((a, b) => a - b);
      expect((l.meta.verified_rows ?? []).map(Number).sort((a, b) => a - b), `${l.meta.id} verified_rows`).toEqual(union);
    }
  });

  it('› every tour step and experiment id is in MAPPING.md', () => {
    const mapping = readFileSync(join(LESSONS, 'MAPPING.md'), 'utf8');
    // The 0.3.8 tour's step ids and experiment ids, as they were when T7b removed both files.
    const stepIds = [
      'basics.welcome', 'basics.prompt', 'basics.run', 'basics.tokens', 'basics.predictions', 'basics.lines', 'basics.focus', 'basics.glossary',
      'attention.grid', 'attention.agg', 'attention.from-to', 'attention.copying',
      'guesses.run', 'guesses.predictions', 'guesses.write', 'guesses.lens',
      'responsible.run', 'responsible.dla', 'responsible.parts',
      'poke.knockout', 'poke.knockout-result', 'poke.swap', 'poke.swap-result',
      'concepts.run', 'concepts.features', 'concepts.history', 'concepts.layer', 'concepts.knockout', 'concepts.steer', 'concepts.find',
      'compare.run', 'compare.read',
      'lab.experiments', 'lab.notebook', 'lab.export',
      'models.switcher', 'models.engine', 'models.done',
    ];
    expect(stepIds).toHaveLength(38);
    const exps = ['induction', 'logit-lens', 'he-or-she', 'ioi-knockout', 'ioi-swap', 'features-steering', 'fact-recall', 'greater-than'];
    expect(exps).toHaveLength(8);
    const known = new Set(TABLE.map((t) => t.id));
    for (const id of [...stepIds, ...exps]) {
      const row = mapping.split('\n').find((line) => line.startsWith(`| \`${id}\` |`));
      expect(row, `${id} has no row in MAPPING.md`).toBeDefined();
      const target = row!.split('|')[2].trim();
      // Each target is `lesson#section` (a known lesson) or "cut".
      if (target !== 'cut') for (const m of target.matchAll(/`([^`#]+)#[^`]+`/g)) expect(known, `${id} → ${m[1]}`).toContain(m[1]);
      expect(target === 'cut' || /`[^`#]+#[^`]+`/.test(target), `${id}: ${target}`).toBe(true);
    }
  });

  const tn4 = ['pry.p2-1', 'pry.p3-2', 'pry.p3-7'];
  const tn4Missing = tn4.filter((id) => !lessons.has(id));
  it.skipIf(tn4Missing.length > 0)(
    `› TN-4 keys written in P2.1 (question, task) and P3.2 (task) are read in P3.2/P3.7${tn4Missing.length ? ` (waiting for ${tn4Missing.map((id) => `${id} from ${OTHER_LANES[id]}`).join(', ')})` : ''}`,
    () => {
      const written = (id: string, kindsOk: string[]) =>
        steps(lessons.get(id)!)
          .filter((s) => kindsOk.includes(s.kind) && s.fields.remember !== undefined)
          .map((s) => `${id}.${typeof s.fields.remember === 'string' ? s.fields.remember : s.fields.remember.key}`);
      const keys = [...written('pry.p2-1', ['predict', 'question', 'task']), ...written('pry.p3-2', ['task'])];
      expect(keys.length).toBeGreaterThan(0);
      const readers = ['pry.p3-2', 'pry.p3-7'].map((id) => readFileSync(join(LESSONS, id, 'lesson.md'), 'utf8')).join('\n');
      for (const k of keys) expect(readers.includes(`key="${k}"`) || readers.includes(`$earlier: ${k}`) || readers.includes(`$earlier.${k}`), `${k} is never read`).toBe(true);
    },
  );

  it('› quick tour has 12 sections, explain only, open_panel only in enter', () => {
    const tour = lessons.get('pry.quick-tour')!;
    expect(tour.meta.presentation).toBe('overlay');
    expect(tour.sections).toHaveLength(12);
    for (const s of steps(tour)) {
      expect(s.kind, `line ${s.line}`).toBe('explain');
      expect(s.actions, `line ${s.line}: a step can't act`).toEqual([]);
    }
    for (const sec of tour.sections) {
      for (const key of Object.keys(sec.enter?.value ?? {})) expect(key, `${sec.id} enter`).toBe('open_panel');
    }
    expect(tour.sections.filter((s) => s.enter).map((s) => s.id)).toEqual(['step-4', 'step-6', 'step-8']);
    // Row 72: step 12 quotes P1.1's title as shipped.
    const p11 = TABLE.find((t) => t.id === 'pry.p1-1')!.title;
    expect(tour.sections[11].steps.flatMap((s) => s.prose.map((p) => p.text)).join(' ')).toContain(`"${p11}"`);
  });

  /**
   * Where a lesson departs from its skeleton on purpose. Each entry names why;
   * nothing else may differ in sections, step kinds or actions.
   */
  const DEPARTURES: { lesson: string; step: string; lessonActions?: string[]; skeletonActions?: string[]; added?: true; args?: true; why: string }[] = [
    // `args`: same actions, arguments differ on purpose.
    ...['features-tab', 'open-card'].map((step) => ({
      lesson: 'pry.p2-5',
      step,
      args: true as const,
      why: "the feature row is row 53 (verified-rows.yaml's outline label \"31\"); the skeleton's $row.1 has no sae_layer or fid",
    })),
    { lesson: 'pry.p2-5', step: 'bank-compare', args: true, why: 'focus_token gained `side` (the row constants lane) to pick the Compare side' },
    { lesson: 'pry.p1-5', step: 'baker-set', lessonActions: ['set_prompt', 'run'], skeletonActions: ['set_prompt', 'write_it'], why: 'critic r5: the transfer write is learner-run, so the lesson only sets and runs the prompt' },
    { lesson: 'pry.p1-5', step: 'baker-write', added: true, why: 'critic r5: a task with learner_actions: [write_it]' },
    ...['write-mit', 'write-decl', 'write-baker'].map((step) => ({
      lesson: 'pry.p1-6',
      step,
      lessonActions: ['set_prompt', 'run', 'write_it'],
      skeletonActions: ['set_prompt', 'write_it'],
      why: 'write_it writes from the last Run, so each opening runs first',
    })),
    // Stage 3-4 (lane t6-s3). Each lessonActions list keeps every skeleton action, in order.
    { lesson: 'pry.p3-2', step: 'movers-knockout', lessonActions: ['reset', 'set_head_ablation', 'run_head_ablation'], skeletonActions: ['set_head_ablation', 'run_head_ablation'], why: 'set_head_ablation adds to the marked heads, so the heavy-line head is cleared before the name movers go off' },
    { lesson: 'pry.p3-2', step: 'control-knockout', args: true, why: "the control heads are row 26's recorded random three (L9H4, L2H5, L0H1), not the skeleton's placeholders" },
    { lesson: 'pry.p3-2', step: 'tom-knockout', lessonActions: ['reset', 'set_prompt', 'run', 'set_head_ablation', 'run_head_ablation'], skeletonActions: ['set_prompt', 'run', 'set_head_ablation', 'run_head_ablation'], why: 'knockouts accumulate, so the random control heads are cleared first' },
    { lesson: 'pry.p3-4', step: 'control-knockout', lessonActions: ['reset', 'set_feature_ablation', 'set_feature_ablation', 'run_feature_ablation'], skeletonActions: ['reset', 'set_feature_ablation', 'run_feature_ablation'], why: 'reset keeps feature knockouts, so the top features are unmarked before the control goes off' },
    { lesson: 'pry.p3-4', step: 'doctor-knockout', lessonActions: ['reset', 'set_feature_ablation', 'set_prompt', 'run', 'focus_token', 'set_feature_ablation', 'run_feature_ablation'], skeletonActions: ['set_prompt', 'run', 'focus_token', 'set_feature_ablation', 'run_feature_ablation'], why: 'feature knockouts accumulate, so the control feature is unmarked first' },
    { lesson: 'pry.p3-6', step: 'dla-contrast', lessonActions: ['set_compare_mode', 'ensure_run', 'open_panel', 'run_dla'], skeletonActions: ['open_panel', 'run_dla'], why: 'DLA runs on the main run, so the lesson leaves Compare (on since s3-2) and runs the Jordan prompt first' },
    ...['run-key-parts', 'map-knockout'].map((step) => ({
      lesson: 'pry.p3-7',
      step,
      args: true as const,
      why: 'the last token is " 17" with its leading space; "17" matches no token in the run',
    })),
    { lesson: 'pry.p3-7', step: 'war-1650-run', lessonActions: ['reset', 'set_prompt', 'run', 'focus_token', 'run_circuit', 'set_head_ablation', 'run_head_ablation'], skeletonActions: ['set_prompt', 'run', 'focus_token', 'run_circuit', 'set_head_ablation', 'run_head_ablation'], why: 'knockouts accumulate, so the control head is cleared first; the selected token is " 16" with its leading space' },
    ...['write-instruction', 'write-document', 'write-hidden', 'write-translate'].map((step) => ({
      lesson: 'pry.p4-1',
      step,
      lessonActions: ['set_prompt', 'run', 'write_it'],
      skeletonActions: ['set_prompt', 'write_it'],
      why: 'write_it writes from the last Run, so each prompt runs first (write-translate also takes row 39\'s fallback prompt)',
    })),
    { lesson: 'pry.p4-1', step: 'run-french', args: true, why: "row 39 narrowed: ' merci' isn't in the top 4, so the transfer uses the outline's fallback pair (the opposite of hot)" },
  ];
  /** Departures that drop a skeleton action on purpose (critic r5); every other departure only adds. */
  const DROPS = new Set(['pry.p1-5 baker-set']);

  const rowsJson = JSON.parse(readFileSync(join(LESSONS, '__generated__/rows.json'), 'utf8')) as {
    rows: { id: number; values?: Record<string, unknown>; constants?: Record<string, { value: unknown }> }[];
  };
  const rowValue = (id: string, field: string): unknown => {
    const r = rowsJson.rows.find((x) => String(x.id) === id);
    const c = r?.constants?.[field];
    return c !== undefined ? c.value : field.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], r?.values);
  };
  const rowValues = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const m = /^\$row\.([^.]+)\.(.+)$/.exec(v);
      return m ? (rowValue(m[1], m[2]) ?? v) : v;
    }
    if (Array.isArray(v)) return v.map(rowValues);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rowValues(x)]));
    return v;
  };

  it("› each bundled lesson's sections, step kinds and actions match its outline-coverage skeleton", () => {
    const sig = (l: Lesson, side: 'lesson' | 'skeleton') => {
      const dep = DEPARTURES.filter((d) => d.lesson === l.meta.id);
      const one = (s: Step): unknown[] => {
        const d = dep.find((x) => x.step === s.id);
        if (d?.added && side === 'lesson') return [];
        // `$row` arguments compare by value: an outline label's row and its alias (row 29 → row 51) are the same constant.
        let actions = s.actions.map((a) => `${a.name} ${JSON.stringify(rowValues(a.args))}`);
        if (d?.args) actions = s.actions.map((a) => a.name);
        if (d?.lessonActions) {
          expect(s.actions.map((a) => a.name), `${l.meta.id} ${s.id} (${side})`).toEqual(side === 'lesson' ? d.lessonActions : d.skeletonActions);
          if (!DROPS.has(`${d.lesson} ${d.step}`)) {
            // Lessons may add actions, never drop one: the skeleton's are an in-order subsequence.
            let i = 0;
            for (const a of d.lessonActions) if (a === d.skeletonActions?.[i]) i++;
            expect(i, `${l.meta.id} ${s.id}: every skeleton action kept`).toBe(d.skeletonActions?.length ?? 0);
          }
          actions = ['(departure)'];
        }
        return [{ kind: s.kind, id: s.id ?? null, actions, children: s.children.flatMap(one) }];
      };
      return l.sections.map((sec) => ({ id: sec.id, outline: sec.outline ?? null, depth: sec.depth, steps: sec.steps.flatMap(one) }));
    };
    for (const l of all) {
      const skeleton = load(join(SKELETONS, `${outlineName(l.meta.id)}.md`));
      expect(sig(l, 'lesson'), l.meta.id).toEqual(sig(skeleton, 'skeleton'));
    }
  });

  // glossary.ts gains `introducedIn` in lane/t6-copy. Read as text: the lessons
  // folder doesn't import Pry modules (registry/boundary.test.ts).
  const glossaryText = readFileSync(join(UI, 'src/lib/glossary.ts'), 'utf8');
  const withIntro = glossaryText
    .split(/\n\s*(?=['"]?[\w -]+['"]?:\s*\{)/)
    .map((block) => ({
      term: /\bterm:\s*['"]([^'"]+)['"]/.exec(block)?.[1],
      introducedIn: /\bintroducedIn:\s*['"]([^'"]+)['"]/.exec(block)?.[1],
      aliases: [.../\baliases:\s*\[([^\]]*)\]/.exec(block)?.[1]?.matchAll(/['"]([^'"]+)['"]/g) ?? []].map((m) => m[1]),
    }))
    .filter((g): g is { term: string; introducedIn: string; aliases: string[] } => !!g.term && !!g.introducedIn);
  it.skipIf(withIntro.length === 0)(
    `› glossary introducedIn matches terms.yaml${withIntro.length === 0 ? ' (waiting for lane/t6-copy to add introducedIn to glossary.ts)' : ''}`,
    () => {
      const terms = (parseYaml(readFileSync(join(LESSONS, 'terms.yaml'), 'utf8')) as { terms: { term: string; aliases?: string[]; introduced_in: string }[] }).terms;
      // A glossary entry matches a term when any of its names (term or alias) is one of the term's.
      const find = (names: string[]) =>
        terms.find((t) => [t.term, ...(t.aliases ?? [])].some((n) => names.some((m) => n.toLowerCase() === m.toLowerCase())));
      for (const g of withIntro) {
        const t = find([g.term, ...g.aliases]);
        expect(t, `glossary "${g.term}" isn't in terms.yaml`).toBeDefined();
        expect(g.introducedIn, g.term).toBe(t!.introduced_in);
      }
    },
  );
});
