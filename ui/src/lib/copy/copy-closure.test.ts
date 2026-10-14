// Copy closure test (plan pry-clarity-2026-10-12, T4 closure matrix; crit:F4, crit:R2C-1).
//
// One row per copy finding. `has` is checked against the whole file text. `lacks`
// and `visibleMatch` are checked only against visible strings (./visible-strings),
// so identifiers, anchors and comments never count. `lacksRaw` is for the matrix
// rows that are literally an `rg` over code (class names, removed functions).
//
// Rows can't be loosened by the lane that fails them. Only the Critic or the user
// may narrow a row. Rows owned by a lane in PENDING_LANES run as `test.todo`.
import { describe, expect, it } from 'vitest';
import { PENDING_LANES, allFiles, read, visible, type Lane } from './copy-files';
import { visibleHits } from './visible-strings';
import { tipsRegistry } from '../tips/tips-registry';

interface Check {
  /** File(s) under `ui/src`. */
  file?: string | string[];
  /** Whole file must contain each. */
  has?: string[];
  /** No visible string may contain each. */
  lacks?: (string | RegExp)[];
  /** Whole file must not contain (an `rg` row over code). */
  lacksRaw?: (string | RegExp)[];
  /** Every visible string matching `select` must also match `match`. At least one must exist. */
  visibleMatch?: { select: RegExp; match: RegExp };
  /** A dedicated test carries the check: this file must define a test with this name. */
  test?: { file: string; name: string };
  /** `rg <pattern> ui/src` returns nothing (test files excluded: they quote old copy in "must not" rows). */
  rgAbsent?: string | RegExp;
  /** Only a screenshot in T6 can check this. Recorded, not asserted. */
  screenshot?: string;
  /** The lane whose merge this check waits for, when not the row's lane. */
  lane?: Lane;
}

interface Row {
  id: string;
  lane: Lane | Lane[] | '-';
  checks: Check[];
  /** Why the row has nothing to assert. */
  note?: string;
}

const EXP = 'lib/experiments/experiments.json';
const GALLERY = 'lib/components/ExperimentGallery.svelte';
const EXP_TEST = 'lib/experiments/experiments.test.ts';
const TOUR = 'lib/tutorial/tour-steps.ts';
const TIPS = 'lib/tips/tips-registry.ts';
const DECK = 'lib/loading-deck.ts';
const READOUTS = 'lib/readouts.ts';
const READOUTS_TEST = 'lib/readouts.test.ts';
const GLOSSARY = 'lib/glossary.ts';
const PAGE = 'routes/+page.svelte';
const C = (name: string) => `lib/components/${name}.svelte`;
const W = (p: string) => `routes/welcome/${p}`;

export const ROWS: Row[] = [
  // --- Experiments (T2, T4a)
  {
    id: 'copy:E1',
    lane: 'T2',
    checks: [
      { test: { file: EXP_TEST, name: 'every experiment has hook, why, prompt, lookFor, found and next.reset/next.try' } },
      { file: GALLERY, has: ['Prompt:'] },
      { screenshot: 'exp-ioi-swap-start' },
    ],
  },
  { id: 'copy:E2', lane: 'T2', checks: [{ rgAbsent: 'showFound' }, { screenshot: 'exp-*-start (found shown)' }] },
  {
    id: 'copy:E3',
    lane: 'T2',
    checks: [
      { file: GALLERY, lacksRaw: [/openDemo|location\.search/] },
      { file: EXP, has: ['Find copying heads'], lacks: ['button below'] },
    ],
  },
  { id: 'copy:E4', lane: 'T2', checks: [{ test: { file: EXP_TEST, name: 'every experiment has hook, why, prompt, lookFor, found and next.reset/next.try' } }] },
  { id: 'copy:E5', lane: 'T4a', checks: [{ file: EXP, has: ['rows are layers 0 to 11', 'Blue squares'] }] },
  { id: 'copy:E6', lane: 'T4a', checks: [{ file: EXP, has: ['Read the last column', 'Indigo'] }] },
  { id: 'copy:E7', lane: 'T4a', checks: [{ file: EXP, has: ['8 to 11', 'bar at the top'] }] },
  { id: 'copy:E8', lane: 'T4a', checks: [{ file: EXP, has: ['press Compare'], lacks: ['in the prompt box and press Run again'] }] },
  { id: 'copy:E9', lane: 'T4a', checks: [{ file: EXP, has: ['That big layer 0 bar is expected'] }] },
  { id: 'copy:E10', lane: 'T4a', checks: [{ file: EXP, lacks: ['feed-forward'] }] },
  { id: 'copy:E11', lane: 'T4a', checks: [{ file: EXP, has: ['raises the score'], lacks: ['how much of the'] }] },
  { id: 'copy:E12', lane: 'T4a', checks: [{ file: EXP, has: ['Pry tracks only the single year'] }] },
  {
    id: 'copy:E13',
    lane: 'T4a',
    checks: [
      { test: { file: 'lib/experiments/experiments-copy.test.ts', name: 'copy:E13 no quoted token with a leading space, and the dot is explained' } },
      { file: EXP, has: ['the dot means the word starts with a space'] },
    ],
  },
  { id: 'copy:E14', lane: 'T4a', checks: [{ file: EXP, has: ['layer 9, head 9', 'Original top-5'], lacks: ['normal top-5'] }] },
  { id: 'copy:E15', lane: 'T4a', checks: [{ file: EXP, has: ['# number', 'Run Steered'] }] },
  { id: 'copy:E16', lane: 'T4a', checks: [{ file: EXP, has: ['to see its whole pattern'] }] },
  { id: 'copy:E17', lane: 'T2', checks: [{ test: { file: EXP_TEST, name: 'tabLabel is defined for every experiment' } }] },
  { id: 'copy:E18', lane: 'T4a', checks: [{ file: EXP, has: ['Knock out (switch off)'] }] },
  { id: 'copy:E19', lane: 'T2', checks: [{ test: { file: EXP_TEST, name: 'every experiment has hook, why, prompt, lookFor, found and next.reset/next.try' } }] },

  // --- Tour (T4a)
  { id: 'copy:T1', lane: 'T4a', checks: [{ file: TOUR, has: ['Brighter'], lacks: ['Darker line'] }] },
  { id: 'copy:T2', lane: 'T4a', checks: [{ file: TOUR, has: ['token and feature'], lacks: ['logit and feature all have one'] }] },
  {
    id: 'copy:T3',
    lane: 'T4a',
    checks: [{ file: TOUR, has: ['Original top-5', 'round x'], lacks: ['normal top five', 'tick the features'] }],
  },
  { id: 'copy:T4', lane: 'T4a', checks: [{ file: TOUR, has: ['The top bar always fills the row'] }] },
  { id: 'copy:T5', lane: 'T4a', checks: [{ file: TOUR, has: ['Nobody wrote its rules by hand'] }] },
  { id: 'copy:T6', lane: 'T4a', checks: [{ file: TOUR, has: ['press Find key parts'] }] },
  { id: 'copy:T7', lane: 'T4a', checks: [{ file: TOUR, has: ['After one write above 0'] }] },
  {
    id: 'copy:T8',
    lane: 'T4a',
    checks: [{ test: { file: 'lib/tutorial/tour-copy.test.ts', name: 'copy:T8 every chapter\'s last step has a "Next up:" pointer' } }],
  },

  // --- Tips and loading cards (T4b; P1 also T3 and T4e; P9 also T4c)
  {
    id: 'copy:P1',
    lane: ['T4b', 'T4e'],
    checks: [
      { file: TIPS, has: ['A dot means the piece starts with a space'], lacksRaw: [/panel-a-token-strip|panel-b-token-strip/] },
      { file: PAGE, has: ['Words (tokens):'] },
      { screenshot: 'popup-tip-word-strip-1280' },
    ],
  },
  { id: 'copy:P2', lane: 'T4b', checks: [{ file: TIPS, has: ['Score by'], lacks: ['currently-focused token'] }] },
  { id: 'copy:P3', lane: 'T4b', checks: [{ file: TIPS, has: ['Only direct pushes count', '30 biggest'], lacks: ['mattered most'] }] },
  { id: 'copy:P4', lane: 'T4b', checks: [{ file: TIPS, has: ['Indigo cells', 'a hint, not proof'], lacks: ['from the start'] }] },
  {
    id: 'copy:P5',
    lane: 'T4b',
    checks: [{ file: TIPS, has: ['the word right before'], lacks: ['causal masking', 'query × key'] }],
  },
  { id: 'copy:P6', lane: 'T4b', checks: [{ file: TIPS, has: ['round x'], lacks: ['Toggle this'] }] },
  { id: 'copy:P7', lane: 'T4b', checks: [{ file: TIPS, has: ["fits your computer's memory"] }] },
  { id: 'copy:P8', lane: 'T4b', checks: [{ file: TIPS, lacks: ['basically nothing'] }] },
  {
    id: 'copy:P9',
    lane: ['T4b', 'T4c'],
    checks: [
      { file: TIPS, has: ['top 10'] },
      { file: C('PredictionsPanel'), has: ['Next-word guesses (top 10)'], lacks: ['Top-k'], lane: 'T4c' },
    ],
  },
  { id: 'copy:P10', lane: 'T4b', checks: [{ file: TIPS, has: ['Run Steered'], lacks: ['rewired'] }] },
  { id: 'copy:P11', lane: 'T4b', checks: [{ file: TIPS, has: ['Run both'] }] },
  { id: 'copy:P12', lane: 'T4b', checks: [{ file: TIPS, lacks: ['heatmap'] }] },
  { id: 'copy:P13', lane: 'T4b', checks: [{ file: TIPS, has: ['layer 7, head 3', 'Swap test'], lacks: ['head 7.3'] }] },

  // --- Readouts (T4c)
  {
    id: 'copy:R1',
    lane: 'T4c',
    checks: [
      { test: { file: READOUTS_TEST, name: '"the end of the text" for <|endoftext|>' } },
      { test: { file: READOUTS_TEST, name: '"a line break" for a newline token' } },
      { test: { file: READOUTS_TEST, name: '"word piece" for a fragment' } },
    ],
  },
  { id: 'copy:R2', lane: 'T4c', checks: [{ test: { file: READOUTS_TEST, name: 'lens readout starts "For the last word, "' } }] },
  { id: 'copy:R3', lane: 'T4c', checks: [{ test: { file: READOUTS_TEST, name: 'start marker can only look at itself' } }] },
  {
    id: 'copy:R4',
    lane: 'T4c',
    checks: [
      // The sentence lives in readouts.ts; DLAPanel renders it through explainingLabel().
      { file: READOUTS, has: ['Explaining the guess after'] },
      { file: C('DLAPanel'), lacks: ['Target token', 'pos '], lacksRaw: [/^(?![\s\S]*explainingLabel\()/] },
    ],
  },
  { id: 'copy:R5', lane: 'T4c', checks: [{ test: { file: READOUTS_TEST, name: 'near tie wording' } }] },
  { id: 'copy:R6', lane: 'T4c', checks: [{ file: READOUTS, has: ['nothing comes after it'] }] },
  { id: 'copy:R7', lane: 'T4c', checks: [{ test: { file: READOUTS_TEST, name: 'features start-marker caveat' } }] },
  { id: 'copy:R8', lane: '-', checks: [], note: 'deferred: optional (the audit marks it fine as is)' },
  {
    id: 'copy:R9',
    lane: 'T4c',
    checks: [
      { test: { file: READOUTS_TEST, name: 'patching readout names the best part and its score change' } },
      { test: { file: READOUTS_TEST, name: 'key parts readout says lines show one kind of link' } },
      // TODO(pry-learning T6): confirm the re-point in the copy pass (T4-ui: MF-4 dropped the changed-word count).
      { test: { file: READOUTS_TEST, name: 'steering readout says the text changed, with no word count' } },
    ],
  },

  // --- Panels, empty states (T4c; C24 is T4e's lint)
  {
    id: 'copy:C1',
    lane: 'T4c',
    checks: [
      {
        file: C('PatchingPanel'),
        has: ['Swap test', 'Blue squares bring the original answer back', 'raised the score for'],
        lacks: ['Activation Patching', 'Causal importance', 'Brightness = patching effect magnitude'],
      },
      { screenshot: 'bug-none-swaptest-panel' },
    ],
  },
  { id: 'copy:C2', lane: 'T4c', checks: [{ file: C('SteeringPanel'), has: ['Turn one concept up or down'] }] },
  { id: 'copy:C3', lane: 'T4c', checks: [{ file: C('PanelB'), has: ['signedHex'], lacksRaw: ['text-red-', 'text-green-'] }] },
  { id: 'copy:C4', lane: 'T4c', checks: [{ file: [C('PanelA'), C('PanelB')], has: [' pts'] }] },
  { id: 'copy:C5', lane: 'T4c', checks: [{ file: C('SteeringPanel'), has: ['turn the text to mush'], lacks: ['degenerate'] }] },
  { id: 'copy:C6', lane: 'T4c', checks: [{ file: C('CircuitPanel'), has: ['fills in on its own'] }] },
  { id: 'copy:C7', lane: 'T4c', checks: [{ file: C('CircuitPanel'), has: ['fuchsia'] }] },
  {
    id: 'copy:C8',
    lane: 'T4c',
    checks: [{ file: C('PredictionsPanel'), has: ['Next-word guesses', "the model's chance for each"] }],
  },
  {
    id: 'copy:C9',
    lane: 'T4c',
    checks: [{ file: C('DLAPanel'), has: ["Help through other parts isn't counted"], lacks: ['Direct Logit Attribution'] }],
  },
  {
    id: 'copy:C10',
    lane: 'T4c',
    checks: [
      { file: [C('DLAPanel'), C('PredictionsPanel')], has: ['Press Run again.'] },
      { file: C('DLAPanel'), lacks: ['No component attributions'] },
      { file: C('CircuitPanel'), has: ['Lower it and press Find key parts'] },
      { file: C('PanelB'), has: ['concepts inside'] },
    ],
  },
  { id: 'copy:C11', lane: 'T4c', checks: [{ file: C('PanelA'), has: ['Type at least two words'] }] },
  { id: 'copy:C12', lane: 'T4c', checks: [{ file: C('PanelA'), has: [' layers, '], lacks: ['L · '] }] },
  { id: 'copy:C13', lane: 'T4c', checks: [{ file: C('PanelA'), has: ['the word doing the looking'], lacks: ['query tokens'] }] },
  {
    id: 'copy:C14',
    lane: 'T4c',
    checks: [
      {
        file: C('PanelA'),
        has: ['Layer {tooltipLayer}, head {tooltipHead}', 'score'],
        lacks: ['L{tooltipLayer} H{tooltipHead}'],
      },
    ],
  },
  { id: 'copy:C15', lane: 'T4c', checks: [{ file: C('PanelA'), has: ['Score by'], lacksRaw: ['>Agg<'] }] },
  { id: 'copy:C16', lane: 'T4c', checks: [{ file: C('LogitLensPanel'), has: ['fills in on its own'] }] },
  { id: 'copy:C17', lane: 'T4c', checks: [{ file: C('LogitLensPanel'), has: ['matches the final answer'], lacks: ['!= final'] }] },
  { id: 'copy:C18', lane: 'T4c', checks: [{ file: C('SteeringPanel'), has: ['strength'], lacks: ['alpha=', '(act:'] }] },
  {
    id: 'copy:C19',
    lane: 'T4c',
    checks: [{ file: C('CircuitPanel'), has: ['Bigger shape, bigger push', 'Direct push'], lacks: ['Node size ='] }],
  },
  { id: 'copy:C20', lane: 'T4c', checks: [{ file: C('NoFeaturesNotice'), has: ["Features don't work with this model."] }] },
  {
    id: 'copy:C21',
    lane: 'T4c',
    checks: [{ file: C('ModelSwitcher'), has: ['No models fit this computer yet.'], lacks: ['presets'] }],
  },
  { id: 'copy:C22', lane: 'T4c', checks: [{ file: C('ComparePanel'), has: ['Press Run both again.'] }] },
  { id: 'copy:C23', lane: 'T4c', checks: [{ file: 'lib/errors.ts', has: ['Press Retry'] }] },
  {
    id: 'copy:C24',
    lane: 'T4e',
    checks: [{ test: { file: 'lib/copy/copy-lint.test.ts', name: 'no em dash in user-visible strings' } }],
  },

  // --- Welcome and setup (T4d)
  { id: 'copy:W1', lane: 'T4d', checks: [{ rgAbsent: 'two guided demos' }, { file: W('done/+page.svelte'), has: ['nine short chapters'] }] },
  { id: 'copy:W2', lane: 'T4d', checks: [{ file: W('+page.svelte'), lacks: ['transformer'] }] },
  {
    id: 'copy:W3',
    lane: 'T4d',
    checks: [{ file: W('hardware/+page.svelte'), has: ["Couldn't check your graphics card"], lacks: [/probe|probing/i] }],
  },
  {
    id: 'copy:W4',
    lane: 'T4d',
    checks: [
      {
        file: W('installing/+page.svelte'),
        has: ["Installing Pry's engine", 'Copy error details', 'Setup log'],
        lacks: [/diagnostic/i, /runtime/i],
      },
    ],
  },
  {
    id: 'copy:W5',
    lane: 'T4d',
    checks: [{ file: W('hf-token/+page.svelte'), has: ['needs permission before you can download it'], lacks: ['gated model'] }],
  },
  { id: 'copy:W6', lane: 'T4d', checks: [{ test: { file: 'lib/copy/copy-lint.test.ts', name: 'banned names' } }] },

  // --- Glossary (T4c)
  {
    id: 'copy:G1',
    lane: 'T4c',
    checks: [
      { test: { file: 'lib/glossary.test.ts', name: 'every glossary key is used by at least one <Term>' } },
      {
        file: ['DLAPanel', 'PatchingPanel', 'CircuitPanel', 'PanelA', 'PanelB', 'FeatureCard', 'SteeringPanel'].map(C),
        has: ['<Term key='],
      },
    ],
  },
  {
    id: 'copy:G2',
    lane: 'T4c',
    checks: [
      {
        file: GLOSSARY,
        has: ["'direct-value-path'", "'threshold'", "'query-key'", "'name-mover'", "'seed'", "'circuit'", "'patching'"],
      },
    ],
  },
  { id: 'copy:G3', lane: 'T4c', checks: [{ file: GLOSSARY, has: ['leaves out help'] }] },
  { id: 'copy:G4', lane: 'T4c', checks: [{ file: GLOSSARY, has: ['randomness'] }] },

  // --- Loading cards (T4b)
  { id: 'copy:L1', lane: 'T4b', checks: [{ test: { file: 'lib/loading-deck.test.ts', name: 'loading cards do not use deictic openers' } }] },
  {
    id: 'copy:L2',
    lane: 'T4b',
    checks: [{ file: DECK, has: ['Logit Lens', 'Key parts', 'Find a concept'], lacks: ['Circuit', 'Concept search'] }],
  },
];

/** Critic additions and cross-lane rows (not numbered copy findings). */
export const EXTRA_ROWS: Row[] = [
  { id: 'crit:F13', lane: '-', checks: [], note: 'covered by copy:C18, copy:C21, copy:P5, copy:W3, copy:W4' },
  {
    id: 'crit:F14',
    lane: 'T4c',
    checks: [
      {
        file: C('PatchingPanel'),
        visibleMatch: { select: /^L\$?\{l\} H/, match: /^L\$?\{l\} H\$?\{h\}: .*score change/ },
        lacks: ['L{l}.H{h}', 'L${l}.H${h}'],
      },
      { file: C('DLAPanel'), lacks: ['Attention Layer'] },
    ],
  },
  {
    id: 'rename:T4e',
    lane: 'T4e',
    checks: [
      {
        file: [PAGE, 'lib/custom-models.ts', 'lib/report.ts', 'lib/experiments/experiments.ts', 'lib/tutorial/actions.ts'],
        lacksRaw: ['Swap & Compare'],
      },
      { file: PAGE, has: ["label: 'Swap test'"] },
      { test: { file: 'lib/report.test.ts', name: 'names the patching run "Swap test"' } },
    ],
  },
  { id: 'rename:tips', lane: 'T4b', checks: [{ file: TIPS, lacks: ['Swap & Compare', 'clean', 'corrupted'] }] },
  { id: 'rename:deck', lane: 'T4b', checks: [{ file: DECK, lacks: ['Swap & Compare'] }] },
  { id: 'rename:T4a', lane: 'T4a', checks: [{ file: [TOUR, EXP], lacks: ['Swap & Compare'] }] },
  { id: 'rename:T4c', lane: 'T4c', checks: [{ file: C('NoFeaturesNotice'), lacks: ['Swap & Compare'] }] },
  // The whole-tree rg for the old tab name waits on both lanes above.
  { id: 'rename:rg', lane: ['T4a', 'T4c'], checks: [{ rgAbsent: /Swap (&|&amp;) Compare/ }] },
  {
    id: 'tour:models.done',
    lane: 'T4a',
    checks: [{ test: { file: 'lib/tutorial/tour-copy.test.ts', name: 'models.done points at the experiment gallery' } }],
  },
  { id: 'tips:why', lane: 'T4b', checks: [{ test: { file: 'lib/tips/tips-registry.test.ts', name: 'every tip has a non-empty why' } }] },
  {
    id: 'tips:anchors',
    lane: 'T4b',
    checks: [{ test: { file: 'lib/tips/tips-registry.test.ts', name: 'every tip anchor exists in a rendered component' } }],
  },
];

/** Checks only a screenshot can make. T6 walks these; this test doesn't assert them. */
export const MANUAL_T6: { id: string; screenshot: string }[] = [...ROWS, ...EXTRA_ROWS].flatMap((r) =>
  r.checks.filter((c) => c.screenshot).map((c) => ({ id: r.id, screenshot: c.screenshot! })),
);

const lanesOf = (row: Row, check: Check): Lane[] =>
  check.lane ? [check.lane] : row.lane === '-' ? [] : Array.isArray(row.lane) ? row.lane : [row.lane];

const files = (c: Check) => (c.file === undefined ? [] : Array.isArray(c.file) ? c.file : [c.file]);

function describeCheck(c: Check): string {
  if (c.test) return `${c.test.file} › ${c.test.name}`;
  if (c.rgAbsent) return `rg ${String(c.rgAbsent)}`;
  return files(c).join(', ');
}

function runCheck(id: string, c: Check) {
  for (const f of files(c)) {
    const text = read(f);
    // Markup wraps long lines, so runs of whitespace compare as one space.
    const flat = text.replace(/\s+/g, ' ');
    for (const s of c.has ?? []) expect(flat, `${id} ${f} +"${s}"`).toContain(s.replace(/\s+/g, ' '));
    for (const s of c.lacksRaw ?? []) {
      if (typeof s === 'string') expect(text, `${id} ${f} raw -"${s}"`).not.toContain(s);
      else expect(text, `${id} ${f} raw -${s}`).not.toMatch(s);
    }
    const v = c.lacks || c.visibleMatch ? visible(f) : [];
    for (const s of c.lacks ?? []) expect(visibleHits(v, s), `${id} ${f} -"${String(s)}"`).toEqual([]);
    if (c.visibleMatch) {
      const picked = v.filter((s) => c.visibleMatch!.select.test(s));
      expect(picked.length, `${id} ${f} has strings matching ${c.visibleMatch.select}`).toBeGreaterThan(0);
      for (const s of picked) expect(s, id).toMatch(c.visibleMatch.match);
    }
  }
  if (c.test) {
    const src = read(c.test.file);
    const quoted = [`'${c.test.name}'`, `"${c.test.name}"`, `\`${c.test.name}\``].some((q) => src.includes(q));
    const escaped = src.includes(`'${c.test.name.replace(/'/g, "\\'")}'`);
    expect(quoted || escaped, `${id}: ${c.test.file} defines "${c.test.name}"`).toBe(true);
  }
  if (c.rgAbsent) {
    const pat = c.rgAbsent;
    const hits = allFiles()
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => (typeof pat === 'string' ? read(f).includes(pat) : pat.test(read(f))));
    expect(hits, `${id} rg ${String(pat)}`).toEqual([]);
  }
}

function defineRows(rows: Row[]) {
  for (const row of rows) {
    const asserted = row.checks.filter((c) => !c.screenshot);
    if (asserted.length === 0) {
      it.todo(`${row.id}: ${row.note ?? 'manual (T6) only'}`);
      continue;
    }
    const ready = asserted.filter((c) => !lanesOf(row, c).some((l) => PENDING_LANES.has(l)));
    const waiting = asserted.filter((c) => lanesOf(row, c).some((l) => PENDING_LANES.has(l)));
    if (ready.length) it(row.id, () => ready.forEach((c) => runCheck(row.id, c)));
    for (const c of waiting) {
      const lanes = lanesOf(row, c).filter((l) => PENDING_LANES.has(l));
      it.todo(`${row.id} [${lanes.join(', ')}] ${describeCheck(c)}`);
    }
  }
}

describe('copy closure matrix', () => {
  it('has one row per copy finding (85: E1-E19, T1-T8, P1-P13, R1-R9, C1-C24, W1-W6, G1-G4, L1-L2)', () => {
    const want = [
      ...Array.from({ length: 19 }, (_, i) => `copy:E${i + 1}`),
      ...Array.from({ length: 8 }, (_, i) => `copy:T${i + 1}`),
      ...Array.from({ length: 13 }, (_, i) => `copy:P${i + 1}`),
      ...Array.from({ length: 9 }, (_, i) => `copy:R${i + 1}`),
      ...Array.from({ length: 24 }, (_, i) => `copy:C${i + 1}`),
      ...Array.from({ length: 6 }, (_, i) => `copy:W${i + 1}`),
      ...Array.from({ length: 4 }, (_, i) => `copy:G${i + 1}`),
      ...Array.from({ length: 2 }, (_, i) => `copy:L${i + 1}`),
    ];
    expect(ROWS.map((r) => r.id).sort()).toEqual(want.sort());
  });

  it('the only deferred finding is copy:R8', () => {
    expect(ROWS.filter((r) => r.lane === '-').map((r) => r.id)).toEqual(['copy:R8']);
  });

  it('crit:F13 points at rows that exist', () => {
    for (const id of ['copy:C18', 'copy:C21', 'copy:P5', 'copy:W3', 'copy:W4']) expect(ROWS.some((r) => r.id === id)).toBe(true);
  });

  it('exports the screenshot checks for T6', () => {
    expect(MANUAL_T6.map((m) => m.id)).toEqual(expect.arrayContaining(['copy:E1', 'copy:E2', 'copy:P1', 'copy:C1']));
  });

  defineRows(ROWS);
});

describe('copy closure extras', () => {
  defineRows(EXTRA_ROWS);

  // Folded in from T4b's lane-local tips-copy.test.ts.
  it('the extractor sees every tip title, blurb and why', () => {
    const v = visible(TIPS);
    const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
    for (const tip of tipsRegistry) {
      expect(v, tip.id).toContain(squash(tip.title));
      expect(v, tip.id).toContain(squash(tip.blurb));
      if (tip.why) expect(v, tip.id).toContain(squash(tip.why));
    }
  });

  it('copy:P1 the word strip tip anchors the visible strip', () => {
    expect(tipsRegistry.find((t) => t.id === 'word-strip')?.target).toBe('[data-tour="token-strip"]');
    expect(read(PAGE)).toContain('data-tour="token-strip"');
  });
});
