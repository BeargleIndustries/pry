import { describe, expect, it } from 'vitest';
import { allSteps } from './normalise';
import { parseInline, parseLesson } from './parse';
import { STEP_KINDS } from './schema';
import { errors, load } from './fixtures/helpers';

const F = '```';

const EVERY_KIND = `
## One {id=one}

:::explain{id=e1 image="img/a.png" alt="A picture"}
Plain words first.
:::

:::analogy{id=a1}
${F}yaml
like: a mixing desk
because: each channel is mixed in
breaks: nobody sets the faders
${F}
:::

:::simplification{id=s1}
${F}yaml
corrected_in: [test.later]
${F}
:::

::::fold{id=f1 title="Larger models"}

:::analogy{id=a2}
${F}yaml
like: x
because: y
breaks: z
${F}
:::

::::

:::recall{id=r1}
${F}yaml
from: test.earlier
question: What did you see?
free: true
${F}
:::

:::question{id=q1}
Which one?

${F}yaml
choices:
  - { text: "A", feedback: "Because A." }
  - { text: "B", feedback: "Because B.", reveal: false }
remember: q-pick
${F}
:::

:::predict{id=p1 checks=o1}
What comes first?

${F}yaml
choices:
  - { text: "One", target: m1, feedback: "It went another way." }
remember: p-pick
${F}
:::

:::do{id=d1 capture=first}
Run it.

${F}actions
- set_prompt: { text: "The capital of France is" }
- run: {}
${F}
:::

:::observe{id=o1}
${F}yaml
check: { read: top_guess.token, op: equals, value: $prediction }
${F}
:::

:::compare{id=c1}
${F}yaml
columns:
  - { read: top_k, from: first }
  - { view: top5-pair, args: { a: first, b: first } }
  - { text: "Reference" }
same_question: journal
${F}
:::

:::explain-result{id=er1}
${F}yaml
supports: ["This run."]
leaves_open: ["Other runs."]
tool: predictions
${F}
:::

::::transfer{id=t1}
${F}yaml
prompt: "The capital of Italy is"
expect_if_explanation_holds: "Rome comes first."
limits: "One prompt."
${F}

:::predict{id=tp checks=to}
Which?

${F}yaml
free: true
${F}
:::

:::observe{id=to}
${F}yaml
journal: true
${F}
:::

::::

:::task{id=k1}
${F}yaml
target: [{ read: ablation.head_count, op: equals, value: 1 }]
max_runs: 3
predict_before_each_run: true
remember: { key: task-head, read: ablation.heads }
${F}
:::

:::explain-chain{id=x1}
${F}yaml
prompt: Write the chain in your own words.
model_answer: Here's one way to put it.
${F}
:::
`;

describe('parse', () => {
  it('› parses every step kind in the table', () => {
    const { lesson, issues } = load(EVERY_KIND);
    expect(errors(issues)).toEqual([]);
    const kinds = new Set(allSteps(lesson!.sections[0].steps).map((s) => s.kind));
    expect([...kinds].sort()).toEqual([...STEP_KINDS].sort());
    const fold = lesson!.sections[0].steps.find((s) => s.kind === 'fold')!;
    expect(fold.children.map((c) => c.kind)).toEqual(['analogy']);
    const transfer = lesson!.sections[0].steps.find((s) => s.kind === 'transfer')!;
    expect(transfer.children.map((c) => c.kind)).toEqual(['predict', 'observe']);
    const pred = lesson!.sections[0].steps.find((s) => s.kind === 'predict')!;
    expect(pred.fields.checks).toBe('o1');
    expect(pred.fields.choices[0].target).toBe('m1');
  });

  it('› parses slots, asserts, :earlier, :spine range mask, :refutes, :look with args and sequences', () => {
    const body = `
## Slots {id=s}

:::slots
clean: { read: patch.cell, args: { layer: 9, position: 5 }, field: clean, expect: 3.21, tolerance: 0.05 }
heads: { row: 26.name_movers }
share: { from: [clean, corrupted, patched], formula: share }
:::

:::explain{id=e}
It's {clean}. :earlier{key="pry.p2-1.word-pick"}[skipped] :spine{mask=embedding..logits} :refutes[the model thinks] :look{at=prediction-bar token=" one"}[the bar] :look{at=[predictions-panel, dla-waterfall]}[these]

${F}yaml
assert:
  - require: { slot: share, op: gt, value: 0.5 }
    say: "a lot of the difference"
    else: "some of the difference"
${F}
:::
`;
    const { lesson, issues } = load(body, { slots: { corrupted: { read: 'dla.actual', expect: 1 }, patched: { read: 'dla.actual', expect: 2 } } });
    expect(errors(issues)).toEqual([]);
    const sec = lesson!.sections[0];
    expect(sec.slots!.clean).toMatchObject({ read: 'patch.cell', field: 'clean', expect: 3.21 });
    expect(sec.slots!.heads.row).toBe('26.name_movers');
    expect(sec.slots!.share.formula).toBe('share');
    const step = sec.steps[0];
    expect(step.fields.assert[0].require).toEqual({ slot: 'share', op: 'gt', value: 0.5 });
    const inline = step.prose[0].inline;
    const by = (t: string) => inline.filter((n) => n.type === t);
    expect(by('slot').map((n) => n.name)).toEqual(['clean']);
    expect(by('earlier')[0]).toMatchObject({ attrs: { key: 'pry.p2-1.word-pick' }, label: 'skipped' });
    expect(by('spine')[0].attrs).toEqual({ mask: 'embedding..logits' });
    expect(by('refutes')[0].label).toBe('the model thinks');
    expect(by('look')[0]).toMatchObject({ attrs: { at: 'prediction-bar', token: ' one' }, label: 'the bar' });
    expect(by('look')[1].attrs!.at).toEqual(['predictions-panel', 'dla-waterfall']);
  });

  it('› parses when, capture, fresh, $earlier and $row arguments', () => {
    const body = `
## W {id=w}

:::do{id=d capture=runA fresh=true}
Run it.

${F}actions
- set_lines_head: { layer: { $earlier: p21-head-layer, fallback: 9 }, head: $row.26.head }
${F}
:::

:::explain{id=yes}
${F}yaml
when: { read: top_guess.token, op: equals, value: " Mary" }
${F}
:::
`;
    const { lesson } = load(body);
    const [d, w] = lesson!.sections[0].steps;
    expect(d.fields).toMatchObject({ capture: 'runA', fresh: true });
    expect(d.actions[0].name).toBe('set_lines_head');
    expect(d.actions[0].args).toEqual({ layer: { $earlier: 'p21-head-layer', fallback: 9 }, head: '$row.26.head' });
    expect(w.fields.when).toEqual({ read: 'top_guess.token', op: 'equals', value: ' Mary' });
  });

  it('› keeps source positions', () => {
    const body = `
## First {id=first}

Some prose.

:::do{id=d}
Run it.

${F}actions
- set_prompt: { text: "a" }
- run: {}
${F}
:::
`;
    const source = load(body);
    const lesson = source.lesson!;
    // Front matter is 8 lines (--- + 6 keys + ---), then a blank line.
    const fmLines = 9;
    expect(lesson.sections[0].line).toBe(fmLines + 1);
    expect(lesson.sections[0].steps[0].prose[0].line).toBe(fmLines + 3);
    const d = lesson.sections[0].steps[1];
    expect(d.line).toBe(fmLines + 5);
    expect(d.actions.map((a) => a.line)).toEqual([fmLines + 9, fmLines + 10]);
    const raw = parseLesson('---\nformat: 1\n---\n\n## A\n\n:::bogus\nx\n:::\n');
    expect(raw.sections[0].steps[0].line).toBe(7);
    expect(parseInline('a {x} b')[0]).toMatchObject({ start: 2, end: 5 });
  });

  it('› MDX/JSX and raw HTML are errors in strict mode', () => {
    expect(errors(load('## A\n\n<div>hi</div>\n', {}, { mode: 'strict' }).issues)).toContain('raw-html');
    expect(errors(load('## A\n\n<Chart data={x} />\n', {}, { mode: 'strict' }).issues)).toContain('mdx');
    expect(errors(load('## A\n\nimport X from "./x"\n', {}, { mode: 'strict' }).issues)).toContain('mdx');
    expect(errors(load('## A\n\n:::explain\nInline <b>bold</b> here.\n:::\n', {}, { mode: 'strict' }).issues)).toContain('raw-html');
    expect(errors(load('## A\n\nPlain prose.\n', {}, { mode: 'strict' }).issues)).toEqual([]);
  });
});
