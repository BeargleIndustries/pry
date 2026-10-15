// Lesson format 1 schemas (plan T1 "Front matter", "Body", step kinds table,
// "Slots and asserts", "Checks"). Every object is strict; lenient loading strips
// unknown keys from presentational objects before validation (normalise.ts).
//
// Syntax summary (AUTHORING.md documents it in full):
//   front matter      YAML between `---` lines
//   section           `## Title {id=... depth=optional outline=file#section}`
//   section blocks    `:::enter` and `:::slots` with a raw YAML body
//   step              `:::kind{id=... attr=value}` container; structured fields in a
//                     ```yaml fence inside it; a do step's actions in a ```actions fence
//   nesting           `fold` holds any step but a fold; `transfer` holds predict, observe, do;
//                     the outer container uses more colons (`::::fold` ... `::::`)
//   inline            :look{at=anchor ...args}[text], {slot}, :earlier{key=...}[fallback],
//                     :spine{mask=box|box..box}, :refutes[text]
//   bindings          `$earlier.<key>` (as `{ $earlier: key, fallback: v }` in arguments),
//                     `$row.<id>.<field>`, `$prediction`, `$before.<readout>`,
//                     `$baseline.<readout>`, `$capture.<name>.<readout>`, `$read.<readout>`,
//                     `$slot.<name>` (a slot's expect)

import { z } from 'zod';

export const LESSON_ID_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const lessonId = z.string().max(64).regex(LESSON_ID_RE);

export const OPS = [
  'equals',
  'in',
  'changed_from',
  'gt',
  'lt',
  'increased',
  'decreased',
  'within',
  'contains',
  'starts_with',
] as const;
export type Op = (typeof OPS)[number];

export const STEP_KINDS = [
  'explain',
  'analogy',
  'simplification',
  'fold',
  'recall',
  'question',
  'predict',
  'do',
  'observe',
  'compare',
  'explain-result',
  'transfer',
  'task',
  'explain-chain',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Objects lenient mode may strip unknown keys from (plan:145). */
export const PRESENTATIONAL_KINDS: readonly string[] = ['explain', 'analogy', 'fold'];

export const FORMULAS = ['share', 'difference', 'sum', 'abs', 'ratio', 'ln'] as const;
export const SLOT_FORMATS = ['probability', 'points', 'logit', 'layer', 'count', 'position', 'string', 'number'] as const;

const args = z.record(z.string(), z.unknown());
const str = z.string();
const strList = z.array(z.string());
const strOrList = z.union([z.string(), z.array(z.string())]);
/** A recorded value, or `pending` (skeletons) or `learner` (the learner's own result). */
export const expectValue = z.union([z.number(), z.string(), z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown())]);

export const checkItem = z.strictObject({
  read: str,
  args: args.optional(),
  /** Read the readout from an earlier capture instead of the live app (P1.5:70, A = B judged after E). */
  from: str.optional(),
  /** One field of a record readout, like a slot's `field` (P1.6:44, " Sam" in prompt 1's top ten: rank). */
  field: str.optional(),
  op: z.enum(OPS),
  value: z.unknown().optional(),
  value_args: args.optional(),
  /** One field of the value's record readout (`$read`/`$capture`), like `field` (P1.4:60, ' one' vs ' four' logits). */
  value_field: str.optional(),
  not: z.boolean().optional(),
  expect: expectValue.optional(),
  /** A number, or a `$row` / `$slot` binding ("within {coh_band}", P3.5:77). */
  tolerance: z.union([z.number(), z.string().regex(/^\$(row|slot)\./)]).optional(),
});
export type CheckItem = z.infer<typeof checkItem>;
const checks = z.union([checkItem, z.array(checkItem).min(1)]);

export const slot = z.strictObject({
  read: str.optional(),
  args: args.optional(),
  field: str.optional(),
  from_capture: str.optional(),
  expect: expectValue.optional(),
  tolerance: z.number().optional(),
  row: str.optional(),
  from: strList.optional(),
  formula: z.enum(FORMULAS).optional(),
  format: z.enum(SLOT_FORMATS).optional(),
});
export type Slot = z.infer<typeof slot>;
export const slots = z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/), slot);

export const assertItem = z.strictObject({
  require: z.strictObject({
    slot: str,
    op: z.enum(OPS),
    value: z.unknown().optional(),
    slot2: str.optional(),
    abs: z.boolean().optional(),
  }),
  say: str,
  else: str,
});
export type AssertItem = z.infer<typeof assertItem>;
const asserts = z.array(assertItem);

export const permissions = z.strictObject({
  download: strList.optional(),
  network: strList.optional(),
  external: strList.optional(),
  cost: strList.optional(),
});

export const frontMatter = z.strictObject({
  format: z.literal(1),
  id: lessonId,
  title: str,
  tool: str,
  summary: str,
  minutes: z.number().positive(),
  draft: z.boolean().optional(),
  presentation: z.enum(['sidebar', 'overlay']).optional(),
  stage: z.number().int().min(0).optional(),
  targets: strList.optional(),
  spine: strList.optional(),
  new_terms: strList.optional(),
  term_budget_exception: str.optional(),
  prerequisites: strList.optional(),
  cold_entry: str.optional(),
  model: str.optional(),
  baseline: z.unknown().optional(),
  permissions: permissions.optional(),
  verified_rows: z.array(z.union([z.number(), z.string()])).optional(),
  tool_min: z.union([z.string(), z.number()]).optional(),
  limits: strOrList.optional(),
  authors: strList.optional(),
  license: str.optional(),
  version: z.union([z.string(), z.number()]).optional(),
  slots: slots.optional(),
});
export type FrontMatter = z.infer<typeof frontMatter>;

const common = {
  id: str.optional(),
  when: checkItem.optional(),
};

/** One misconception id, or several when one tempting answer bundles them (P3.5:21). */
const target = z.union([str, strList]).optional();
const predictChoice = z.strictObject({ text: str, target, feedback: str.optional() });
const questionChoice = z.strictObject({ text: str, target, feedback: str.optional(), reveal: z.boolean().optional() });

export const stepSchemas: Record<StepKind, z.ZodObject<any>> = {
  // `withdraws`: the metaphors this step retires, which it may name (map 5.1; P2.1:49, P3.2:46).
  explain: z.strictObject({ ...common, image: str.optional(), alt: str.optional(), assert: asserts.optional(), withdraws: strList.optional() }),
  // `breaks` is checked by lint (analogy-breaks) so a missing one gets the plain wording.
  analogy: z.strictObject({ ...common, like: str, because: str, breaks: str.optional(), withdrawn_in: str.optional() }),
  simplification: z.strictObject({ ...common, corrected_in: strList }),
  fold: z.strictObject({ ...common, title: str }),
  recall: z.strictObject({
    ...common,
    from: str,
    question: str.optional(),
    choices: z.array(questionChoice).optional(),
    free: z.boolean().optional(),
  }),
  question: z.strictObject({
    ...common,
    choices: z.array(questionChoice).optional(),
    free: z.boolean().optional(),
    model_answer: str.optional(),
    pick: str.optional(),
    remember: str.optional(),
    on_skip: str.optional(),
  }),
  predict: z.strictObject({
    ...common,
    choices: z.array(predictChoice).optional(),
    free: z.boolean().optional(),
    pick: str.optional(),
    hides: strList.optional(),
    skip_check: z
      .strictObject({
        when: z.array(z.strictObject({ step: str, choice: z.union([z.number(), z.string()]) })).min(1),
        skip: strList,
        reason_step: str.optional(),
      })
      .optional(),
    remember: str.optional(),
    on_skip: str.optional(),
    checks: str.optional(),
  }),
  do: z.strictObject({ ...common, capture: str.optional(), fresh: z.boolean().optional() }),
  observe: z.strictObject({
    ...common,
    check: checks.optional(),
    journal: z.boolean().optional(),
    assert: asserts.optional(),
    expect: expectValue.optional(),
  }),
  compare: z.strictObject({
    ...common,
    columns: z
      .array(
        z.union([
          z.strictObject({ read: str, args: args.optional(), from: str.optional() }),
          z.strictObject({ view: str, args: args.optional() }),
          z.strictObject({ text: str }),
        ]),
      )
      .min(2)
      .max(5),
    same_question: z.union([z.literal('journal'), z.literal('pick'), z.string()]).optional(),
    assert: asserts.optional(),
  }),
  'explain-result': z.strictObject({
    ...common,
    supports: strOrList.optional(),
    leaves_open: strOrList.optional(),
    tool: str.optional(),
    skeptic: z.strictObject({ says: str, check: str }).optional(),
    limits: strOrList.optional(),
    assert: asserts.optional(),
  }),
  transfer: z.strictObject({
    ...common,
    prompt: str,
    expect_if_explanation_holds: str,
    limits: strOrList,
    assert: asserts.optional(),
  }),
  task: z.strictObject({
    ...common,
    target: z.array(checkItem).min(1),
    constraint: z.array(checkItem).optional(),
    max_runs: z.number().int().min(1).optional(),
    predict_before_each_run: z.boolean().optional(),
    one_change: str.optional(),
    /** The actions the learner drives during the task (P3.2:71, learner-driven knockouts). */
    learner_actions: strList.optional(),
    /** Stores the readouts of the learner's last run when the target is met or they move on (P3.7:70, the learner's control). */
    capture: str.optional(),
    reset: z.unknown().optional(),
    remember: z.strictObject({ key: str, read: str, args: args.optional() }).optional(),
  }),
  // `assert` gates a qualitative word in the model answer (P3.2:87 "barely mattered").
  'explain-chain': z.strictObject({ ...common, prompt: str.optional(), model_answer: str, assert: asserts.optional() }),
};

/** Kinds a container may hold (nesting), keyed by parent kind. */
export const NESTING: Partial<Record<StepKind, readonly StepKind[]>> = {
  fold: STEP_KINDS.filter((k) => k !== 'fold'),
  // A transfer can be a faded task (P2.4:95, P3.5:77, P3.6:78).
  transfer: ['predict', 'observe', 'do', 'task'],
};

/** A step's `actions` fence: a list of single-key maps, key = action, value = args. */
export const actionsList = z.array(z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length === 1, 'each action is one `name: { args }` entry'));

// ---------------------------------------------------------------------------
// The normalised lesson (what parse + normalise hand lint, the runner and compile).

export interface InlineNode {
  type: 'look' | 'earlier' | 'spine' | 'refutes' | 'slot' | 'code' | 'link';
  /** Offsets into the prose text. */
  start: number;
  end: number;
  attrs?: Record<string, string | string[]>;
  label?: string;
  name?: string;
  url?: string;
}

export interface Prose {
  text: string;
  line: number;
  inline: InlineNode[];
}

export interface ActionCall {
  name: string;
  args: Record<string, unknown>;
  line: number;
}

export interface Step {
  kind: StepKind;
  id?: string;
  line: number;
  fields: Record<string, any>;
  prose: Prose[];
  actions: ActionCall[];
  children: Step[];
  /** Implicit explain made from prose sitting directly under a heading. */
  implicit?: boolean;
}

export interface Section {
  index: number;
  id: string;
  title: string;
  depth: 'core' | 'optional';
  line: number;
  outline?: string;
  enter?: { value: Record<string, unknown>; line: number };
  slots?: Record<string, Slot>;
  slotsLine?: number;
  steps: Step[];
}

export interface Lesson {
  file?: string;
  meta: FrontMatter;
  sections: Section[];
  /** Notes for author mode: keys lenient mode dropped, and similar. */
  authorNotes: string[];
}
