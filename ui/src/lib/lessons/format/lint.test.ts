import { describe, expect, it } from 'vitest';
import { errors, lint, warnings } from './fixtures/helpers';
import { hostMatches } from './lint';

const F = '```';
const yaml = (s: string) => `${F}yaml\n${s}\n${F}`;
const step = (head: string, body: string) => `:::${head}\n${body}\n:::\n`;
const run = (id: string, extra = '') => step(`do{id=${id}${extra}}`, `Run it.\n\n${F}actions\n- set_prompt: { text: "The capital of France is" }\n- run: {}\n${F}`);
const predictObserve = (p: string, o: string, extraPredict = '') =>
  step(`predict{id=${p} checks=${o}}`, `Which?\n\n${yaml(`choices:\n  - { text: "A", feedback: "It went another way." }${extraPredict}`)}`) +
  '\n' +
  step(`observe{id=${o}}`, yaml('check: { read: top_guess.token, op: equals, value: $prediction }'));
const result = (extra = '') => step('explain-result{id=er}', yaml(`supports: ["This run."]\nleaves_open: ["Other runs."]${extra}`));
const BASE = { model: 'gpt2-small', baseline: { prompt: 'The capital of France is' } };

describe('lint', () => {
  it('› analogy without breaks is an error', () => {
    expect(errors(lint(`## A\n\n${step('analogy{id=a}', yaml('like: x\nbecause: y'))}`))).toContain('analogy-breaks');
    expect(errors(lint(`## A\n\n${step('analogy{id=a}', yaml('like: x\nbecause: y\nbreaks: "  "'))}`))).toContain('analogy-breaks');
    expect(errors(lint(`## A\n\n${step('analogy{id=a}', yaml('like: x\nbecause: y\nbreaks: z'))}`))).toEqual([]);
  });

  it('› two main-path analogies in one section is an error', () => {
    const a = (id: string) => step(`analogy{id=${id}}`, yaml('like: x\nbecause: y\nbreaks: z'));
    expect(errors(lint(`## A\n\n${a('a1')}\n${a('a2')}`))).toContain('analogy-two');
    expect(errors(lint(`## A\n\n${a('a1')}\n## B\n\n${a('a2')}`))).toEqual([]);
  });

  it('› an analogy inside a fold doesn\'t count', () => {
    const a = (id: string) => step(`analogy{id=${id}}`, yaml('like: x\nbecause: y\nbreaks: z'));
    expect(errors(lint(`## A\n\n${a('a1')}\n::::fold{id=f title="More"}\n\n${a('a2')}\n::::\n`))).toEqual([]);
  });

  it('› :earlier key written by a question or task remember passes', () => {
    const body = `## A\n\n${step('question{id=q}', `Which?\n\n${yaml('free: true\nremember: q-key')}`)}\n${step(
      'task{id=t}',
      yaml('target: [{ read: ablation.head_count, op: equals, value: $read.ablation.head_count }]\nremember: { key: t-key, read: ablation.heads }'),
    )}\n${step('explain{id=e}', 'You said :earlier{key=q-key}[skipped] and found :earlier{key="t-key"}[none].')}`;
    expect(errors(lint(body))).toEqual([]);
  });

  it('› $earlier argument without fallback is an error', () => {
    const body = (arg: string) => `## A\n\n${step('question{id=q}', `Q?\n\n${yaml('free: true\nremember: p21-head')}`)}\n${step('do{id=d}', `Look.\n\n${F}actions\n- open_head: { layer: ${arg}, head: 1 }\n${F}`)}`;
    expect(errors(lint(body('$earlier.p21-head')))).toContain('earlier-no-fallback');
    expect(errors(lint(body('{ $earlier: p21-head, fallback: 9 }')))).toEqual([]);
  });

  it('› when step without a negated sibling is an error', () => {
    const w = (id: string, not = '') => step(`explain{id=${id}}`, `Shown.\n\n${yaml(`when: { read: top_guess.token, op: equals, value: " Mary"${not} }`)}`);
    expect(errors(lint(`## A\n\n${w('yes')}`, BASE))).toContain('when-no-sibling');
    expect(errors(lint(`## A\n\n${w('yes')}\n${w('no', ', not: true')}`, BASE))).toEqual([]);
  });

  it('› compound skip_check with an unknown section is an error', () => {
    const sc = (skip: string) =>
      `## A {id=a}\n\n${predictObserve('p1', 'o1', `\nskip_check: { when: [{ step: p1, choice: 0 }, { step: p2, choice: 0 }], skip: [${skip}] }`)}\n${predictObserve('p2', 'o2')}\n## B {id=b}\n\nHi.\n`;
    expect(errors(lint(sc('nope'), BASE))).toContain('skip-check-unknown');
    expect(errors(lint(sc('b'), BASE))).toEqual([]);
  });

  it('› explain-result after a tool action without tool: is an error', () => {
    expect(errors(lint(`## A\n\n${run('d')}\n${result()}`, BASE))).toContain('tool-missing');
    expect(errors(lint(`## A\n\n${run('d')}\n## B\n\n${result()}`, BASE))).toContain('tool-missing');
    expect(errors(lint(`## A\n\n${run('d')}\n${result('\ntool: predictions')}`, BASE))).toEqual([]);
  });

  it('› slot used before its readout exists is a lint error', () => {
    const slots = `:::slots\ntop: { read: top_guess.token, from_capture: first, expect: " Paris" }\n:::\n`;
    const use = step('explain{id=e}', 'It gave {top}.');
    expect(errors(lint(`## A\n\n${slots}\n${use}\n${run('d', ' capture=first')}`, BASE))).toContain('slot-before-readout');
    expect(errors(lint(`## A\n\n${slots}\n${run('d', ' capture=first')}\n${use}`, BASE))).toEqual([]);
    // With no baseline and nothing run yet, a live slot has nothing to show.
    const live = `:::slots\nlive: { read: top_guess.token, expect: " Paris" }\n:::\n`;
    expect(errors(lint(`## A\n\n${live}\n${step('explain{id=e}', 'It gave {live}.')}`, { model: 'gpt2-small' }))).toContain('slot-before-readout');
  });

  it('› anchor args checked like action args', () => {
    const at = (s: string) => lint(`## A\n\n${step('explain{id=e}', `Look at ${s}.`)}`);
    expect(errors(at(':look{at=prediction-bar token=" one"}[the bar]'))).toEqual([]);
    expect(errors(at(':look{at=prediction-bar tokn=" one"}[the bar]'))).toContain('bad-anchor-args');
    expect(errors(at(':look{at=predictions-panel token=" one"}[it]'))).toContain('bad-anchor-args');
    expect(errors(at(':look{at=[predictions-panel, dla-waterfal]}[these]'))).toContain('unknown-anchor');
  });

  it('› write_it above temperature 0 without seed in a do step is an error', () => {
    const w = (args: string) => lint(`## A\n\n${step('do{id=d}', `Write.\n\n${F}actions\n- write_it: { ${args} }\n${F}`)}`, BASE);
    expect(errors(w('temperature: 1'))).toContain('seed-missing');
    expect(errors(w('temperature: 1, seed: 2'))).toEqual([]);
    expect(errors(w('temperature: 0'))).toEqual([]);
  });

  it('› repeated do step without fresh is an error', () => {
    expect(errors(lint(`## A\n\n${run('d1')}\n${run('d2')}`, BASE))).toContain('fresh-missing');
    expect(errors(lint(`## A\n\n${run('d1')}\n${run('d2', ' fresh=true')}`, BASE))).toEqual([]);
  });

  it('› $row reference missing from verified-rows.yaml is an error', () => {
    const body = `## A\n\n${step('do{id=d}', `Look.\n\n${F}actions\n- open_head: { layer: $row.26.layer, head: $row.26.head }\n${F}`)}`;
    expect(errors(lint(body, {}, { verifiedRows: ['14'] }))).toContain('row-unknown');
    expect(errors(lint(body, {}, { verifiedRows: ['14', '26'] }))).toEqual([]);
  });

  it('› bundled slot without expect is an error', () => {
    const body = `## A\n\n:::slots\ntop: { read: top_guess.token }\n:::\n\n${step('explain{id=e}', 'It gave {top}.')}`;
    expect(errors(lint(body, BASE, { bundled: true }))).toContain('expect-missing');
    const user = lint(body, BASE);
    expect(errors(user)).toEqual([]);
    expect(warnings(user)).toContain('expect-missing');
  });

  it('› expect: pending passes --skeleton and fails --release', () => {
    const body = `## A\n\n:::slots\ntop: { read: top_guess.token, expect: pending }\n:::\n\n${step('explain{id=e}', 'It gave {top}.')}`;
    expect(errors(lint(body, BASE, { bundled: true, skeleton: true }))).toEqual([]);
    expect(errors(lint(body, BASE, { bundled: true }))).toContain('expect-pending');
    expect(errors(lint(body, BASE, { bundled: true, skeleton: true, release: true }))).toContain('expect-pending');
  });

  it('› expect: learner on a slot after a fixed do step is an error', () => {
    const body = `## A\n\n:::slots\ntop: { read: top_guess.token, from_capture: fixed, expect: learner }\n:::\n\n${run('d', ' capture=fixed')}\n${step('explain{id=e}', 'It gave {top}.')}`;
    expect(errors(lint(body, BASE, { bundled: true }))).toContain('expect-learner');
  });

  it('› expect: learner on P3.2\'s task-head slot passes --release', () => {
    const body = `## Find one head {id=task}

:::slots
task_head: { read: ablation.heads, expect: learner }
task_threshold: { row: 26.threshold }
:::

${step(
  'task{id=find}',
  yaml(`target: [{ read: ablation.delta, args: { token: " Mary" }, op: lt, value: $slot.task_threshold }]
constraint: [{ read: ablation.head_count, op: equals, value: 1, expect: 1 }]
predict_before_each_run: true
remember: { key: p32-task-head, read: ablation.heads }`),
)}
${step('explain{id=found}', 'You found {task_head}.')}`;
    expect(errors(lint(body, BASE, { bundled: true, release: true }))).toEqual([]);
  });

  it('› $earlier in enter without fallback is an error', () => {
    const q = step('question{id=q}', `Q?\n\n${yaml('free: true\nremember: snippet')}`);
    expect(errors(lint(`## A\n\n${q}\n## B\n\n:::enter\nprompt: $earlier.snippet\n:::\n\nHi.\n`, BASE))).toContain('earlier-no-fallback');
    expect(errors(lint(`## A\n\n${q}\n## B\n\n:::enter\nprompt: { $earlier: snippet, fallback: "x" }\n:::\n\nHi.\n`, BASE))).toEqual([]);
  });

  it('› simplification needs a known corrected_in', () => {
    const s = (id: string) => `## A\n\n${step('simplification{id=s}', `Simplified.\n\n${yaml(`corrected_in: [${id}]`)}`)}`;
    expect(errors(lint(s('pry.p9-9'), {}, { knownLessons: ['pry.p3-4'] }))).toContain('simplification-unknown');
    expect(errors(lint(s('pry.p3-4'), {}, { knownLessons: ['pry.p3-4'] }))).toEqual([]);
  });

  it('› stage-2 explain-result without skeptic is an error', () => {
    expect(errors(lint(`## A\n\n${result()}`, { stage: 2 }))).toContain('skeptic-missing');
    expect(errors(lint(`## A\n\n${result('\nskeptic: { says: "A skeptic would say...", check: "Knock it out." }')}`, { stage: 2 }))).toEqual([]);
    expect(errors(lint(`## A\n\n${result()}`, { stage: 1 }))).toEqual([]);
  });

  it('› :earlier key without a remember is an error', () => {
    expect(errors(lint(`## A\n\n${step('explain{id=e}', 'You said :earlier{key="pry.p2-1.word-pick"}[skipped].')}`))).toContain('earlier-undeclared');
    expect(errors(lint(`## A\n\n${step('explain{id=e}', 'You said :earlier{key="pry.p2-1.word-pick"}[skipped].')}`, {}, { rememberKeys: ['pry.p2-1.word-pick'] }))).toEqual([]);
  });

  it('› targets need a tagged choice', () => {
    expect(errors(lint(`## A\n\n${predictObserve('p', 'o')}`, { ...BASE, targets: ['M3'] }))).toContain('targets-untagged');
    const tagged = `## A\n\n${step('predict{id=p checks=o}', `Which?\n\n${yaml('choices:\n  - { text: "A", target: M3, feedback: "x" }')}`)}\n${step('observe{id=o}', yaml('journal: true'))}`;
    expect(errors(lint(tagged, { ...BASE, targets: ['M3'] }))).toEqual([]);
  });

  it('› bundled lesson with an unrecorded prompt is an error', () => {
    const body = `## A\n\n${run('d')}`;
    expect(errors(lint(body, BASE, { bundled: true, recordedPrompts: ['Something else'] }))).toContain('unrecorded-prompt');
    expect(errors(lint(body, BASE, { bundled: true, recordedPrompts: ['The capital of France is'] }))).toEqual([]);
    expect(warnings(lint(body, BASE, { recordedPrompts: [] }))).toContain('unrecorded-prompt');
  });

  it('› unknown action suggests nearest name', () => {
    const issues = lint(`## A\n\n${step('do{id=d}', `Go.\n\n${F}actions\n- set_promt: { text: "x" }\n${F}`)}`);
    const i = issues.find((x) => x.code === 'unknown-action')!;
    expect(i.message).toContain('`set_prompt`');
  });

  it('› switch_model without download permission is an error', () => {
    const body = `## A\n\n${step('do{id=d}', `Switch.\n\n${F}actions\n- switch_model: { preset: gemma-2-2b }\n${F}`)}`;
    expect(errors(lint(body))).toContain('permission-missing');
    expect(errors(lint(body, { permissions: { download: ['gemma-2-2b'] } }))).toEqual([]);
    expect(errors(lint(body, {}, { bundled: true }))).toEqual([]);
  });

  it('› prose link to undeclared host is an error', () => {
    const body = `## A\n\n${step('explain{id=e}', 'Read [the paper](https://arxiv.org/abs/2211.00593).')}`;
    expect(errors(lint(body))).toContain('link-host');
    expect(errors(lint(body, { permissions: { external: ['arxiv.org'] } }))).toEqual([]);
    expect(errors(lint(`## A\n\n${step('explain{id=e}', 'See [section 2](lesson:pry.p2-1#heads).')}`))).toEqual([]);
  });

  it('› evilarxiv.org does not match arxiv.org', () => {
    expect(hostMatches('evilarxiv.org', 'arxiv.org')).toBe(false);
    expect(hostMatches('arxiv.org.evil.com', 'arxiv.org')).toBe(false);
    const body = `## A\n\n${step('explain{id=e}', 'Read [it](https://evilarxiv.org/x).')}`;
    expect(errors(lint(body, { permissions: { external: ['arxiv.org'] } }))).toContain('link-host');
  });

  it('› export.arxiv.org matches', () => {
    expect(hostMatches('export.arxiv.org', 'arxiv.org')).toBe(true);
    expect(hostMatches('ARXIV.org', 'arxiv.org')).toBe(true);
    const body = `## A\n\n${step('explain{id=e}', 'Read [it](https://export.arxiv.org/abs/1).')}`;
    expect(errors(lint(body, { permissions: { external: ['arxiv.org'] } }))).toEqual([]);
  });

  it('› mailto link is an error', () => {
    const body = `## A\n\n${step('explain{id=e}', 'Write [to us](mailto:a@example.com).')}`;
    expect(errors(lint(body))).toContain('link-scheme');
    expect(errors(lint(body, {}, { bundled: true }))).toContain('link-scheme');
  });

  it('› overlay lesson with a predict step is an error', () => {
    expect(errors(lint(`## A\n\n${predictObserve('p', 'o')}`, { ...BASE, presentation: 'overlay' }))).toContain('overlay-step');
  });

  it('› overlay lesson with a do step, or an enter key other than open_panel, is an error', () => {
    expect(errors(lint(`## A\n\n${run('d')}`, { presentation: 'overlay' }))).toContain('overlay-step');
    expect(errors(lint('## A\n\n:::enter\nprompt: "x"\n:::\n\nHi.\n', { presentation: 'overlay' }))).toContain('overlay-enter');
    expect(errors(lint('## A\n\n:::enter\nopen_panel: dla\n:::\n\nLook at :look{at=dla-waterfall}[the chart].\n', { presentation: 'overlay' }))).toEqual([]);
  });

  it('› overlay lesson over 12 sections is an error', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `## S${i}\n\nHi.\n`).join('\n');
    expect(errors(lint(many(13), { presentation: 'overlay' }))).toContain('overlay-sections');
    expect(errors(lint(many(12), { presentation: 'overlay' }))).toEqual([]);
  });

  it('› draft fails only with --release', () => {
    const issues = lint('## A\n\nHi.\n', { draft: true });
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).toContain('draft');
    expect(errors(lint('## A\n\nHi.\n', { draft: true }, { release: true }))).toContain('draft');
  });
});

// Format additions forced by the T1 outline-coverage gate (each names the outline line).
describe('lint: outline-coverage additions', () => {
  const doWrite = (id: string, seed: number) =>
    step(`do{id=${id}}`, `Write.\n\n${F}actions\n- write_it: { temperature: 1, seed: ${seed} }\n${F}\n\n${yaml(`capture: ${id}`)}`);

  it('› a check item may read from an earlier capture (P1.5:70)', () => {
    const body = `## A\n\n${doWrite('a', 1)}\n${doWrite('b', 2)}\n${step('observe{id=o}', yaml('check: { read: write_it.text, from: a, op: equals, value: $capture.b.write_it.text }'))}`;
    expect(errors(lint(body, BASE))).toEqual([]);
    const bad = `## A\n\n${step('observe{id=o}', yaml('check: { read: write_it.text, from: zz, op: equals, value: "x" }'))}`;
    expect(errors(lint(bad, BASE))).toContain('capture-unknown');
  });

  it('› a check item may read one field of a record readout (P1.6:44)', () => {
    const ok = `## A\n\n${run('r')}\n${step('observe{id=o}', yaml('check: { read: prediction, args: { token: " Paris" }, field: rank, op: lt, value: 11, expect: 3 }'))}`;
    expect(errors(lint(ok, BASE))).toEqual([]);
    const bad = `## A\n\n${run('r')}\n${step('observe{id=o}', yaml('check: { read: top_guess.prob, field: rank, op: lt, value: 1, expect: 1 }'))}`;
    expect(errors(lint(bad, BASE))).toContain('bad-readout-args');
  });

  it('› `value_args` give a captured readout its arguments (P3.2:61)', () => {
    const cap = step('do{id=c}', `Knock out.\n\n${F}actions\n- run_head_ablation: {}\n${F}\n\n${yaml('capture: control')}`);
    const check = (va: string) => step('observe{id=o}', yaml(`check: { read: ablation.delta, args: { token: " Mary" }, op: lt, value: $capture.control.ablation.delta${va} }`));
    expect(errors(lint(`## A\n\n${cap}\n${check(', value_args: { token: " Mary" }')}`, BASE))).toEqual([]);
    expect(errors(lint(`## A\n\n${cap}\n${check('')}`, BASE))).toContain('bad-readout-args');
  });

  it('› a task names the actions the learner drives, checked by name (P3.2:71)', () => {
    const task = (a: string) => step('task{id=t}', yaml(`target:\n  - { read: ablation.head_count, op: equals, value: 1, expect: learner }\nlearner_actions: [${a}]`));
    expect(errors(lint(`## A\n\n${task('set_head_ablation, run_head_ablation')}`, BASE))).toEqual([]);
    expect(errors(lint(`## A\n\n${task('run_head_ablashun')}`, BASE))).toContain('unknown-action');
  });

  it('› a check tolerance may bind a slot (P3.5:77)', () => {
    const t = (tol: string) =>
      step('task{id=t}', yaml(`target:\n  - { read: steer.coherence, args: { which: steered }, op: within, value: $read.steer.coherence, value_args: { which: original }, tolerance: ${tol} }`));
    const slots = ':::slots\nband: { row: "25.band", format: number }\n:::\n';
    expect(errors(lint(`## A\n\n${slots}\n${t('$slot.band')}`, BASE))).toEqual([]);
    expect(errors(lint(`## A\n\n${t('$slot.nope')}`, BASE))).toContain('slot-unknown');
  });

  it('› a question choice can carry a target (P1.4:74)', () => {
    const q = step('question{id=q}', `Why?\n\n${yaml('choices:\n  - { text: "a bug", target: M10 }\n  - { text: "the same process" }')}`);
    expect(errors(lint(`## A\n\n${q}`, { targets: ['M10'] }))).not.toContain('targets-untagged');
  });
});
