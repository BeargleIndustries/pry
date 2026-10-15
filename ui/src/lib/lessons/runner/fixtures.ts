// Fixture lessons for the runner tests (tests only). Each is a small Pry
// lesson built to exercise one part of the section-state fold or the flow.

const IOI = 'When Mary and John went to the store, John gave a drink to';

const head = (id: string, title: string, extra = '') => `---
format: 1
id: ${id}
title: "${title}"
tool: pry
summary: "Runner fixture."
minutes: 3
model: gpt2-small
baseline: { prompt: "The cat sat on the" }
${extra}---
`;

/** Setup, steps, a section with no enter, a later enter, a reset. */
export const FOLD = `${head('pry.fixture-fold', 'Fold fixture')}
## Run it {id=one}

:::enter
run: true
:::

:::predict{id=p1 checks=o1}
What comes next?

\`\`\`yaml
choices:
  - { text: "\\" the\\"", feedback: "Run it and see." }
  - { text: "\\" mat\\"" }
remember: first-guess
\`\`\`
:::

:::do{id=d1}
Open Why.

\`\`\`actions
- open_panel: { panel: dla }
\`\`\`
:::

:::observe{id=o1}
\`\`\`yaml
check: { read: top_guess.token, op: equals, value: $prediction }
\`\`\`
:::

## Unchanged {id=two}

:::explain
This section sets nothing.
:::

## Turn Compare off {id=three}

:::do{id=d3}
\`\`\`actions
- set_compare_mode: { on: false }
- open_panel: { panel: logit-lens }
\`\`\`
:::

## A later enter wins {id=four}

:::enter
compare_mode: true
open_panel: patching
:::

:::do{id=d4}
\`\`\`actions
- set_head_ablation: { heads: [{ layer: 1, head: 0 }], on: true }
- run_head_ablation: {}
\`\`\`
:::

## Back to the start {id=five}

:::enter
reset: true
:::

:::explain
The baseline again.
:::
`;

/** A learner-picked head carried by $earlier until a task's reset. */
export const EARLIER = `${head('pry.fixture-earlier', 'Earlier fixture', `prerequisites: [pry.p2-1]\ncold_entry: "What you need from before: the head you picked."\n`)}
## Pick {id=pick}

:::predict{id=pick-head}
Which head?

\`\`\`yaml
pick: head
remember: head
\`\`\`
:::

## Knock it out {id=knock}

:::enter
prompt: "${IOI}"
run: true
head_ablation: { heads: [{ $earlier: head, fallback: { layer: 9, head: 9 } }], on: true }
:::

:::explain
Your head, :earlier{key="head"}[skipped], is off.
:::

## Still off {id=still}

:::explain
Nothing changes here.
:::

## Find one {id=task}

:::task{id=find}
Find one head.

\`\`\`yaml
target:
  - { read: ablation.delta, args: { token: " Mary" }, op: lt, value: -0.1 }
constraint:
  - { read: ablation.head_count, op: equals, value: 1 }
max_runs: 4
predict_before_each_run: true
learner_actions: [set_head_ablation, run_head_ablation]
reset: { prompt: "${IOI}", head_ablation: { heads: [], on: false } }
remember: { key: found-head, read: ablation.heads }
\`\`\`
:::

## After {id=after}

:::explain
After the task.
:::
`;

/** Gated and stateful steps: a link, a model switch. */
export const GATED = `${head('pry.fixture-gated', 'Gated fixture')}
## Links {id=links}

:::do{id=link}
\`\`\`actions
- open_link: { url: "https://arxiv.org/abs/2211.00593" }
- open_panel: { panel: dla }
\`\`\`
:::

## Switch {id=switch}

:::do{id=to-medium}
\`\`\`actions
- switch_model: { preset: pythia-70m }
\`\`\`
:::

## After the switch {id=after-switch}

:::enter
run: true
:::

:::do{id=lens}
\`\`\`actions
- run_logit_lens: {}
\`\`\`
:::

## End {id=end}

:::explain
Done.
:::
`;

/** Fresh repeat runs with captures. */
export const FRESH = `${head('pry.fixture-fresh', 'Fresh fixture')}
## Write {id=write}

:::enter
run: true
:::

:::do{id=wa}
\`\`\`actions
- write_it: { temperature: 1, seed: 7 }
\`\`\`

\`\`\`yaml
capture: a
fresh: true
\`\`\`
:::

## Next {id=next}

:::explain
After.
:::
`;

/** Steering, to count calls on Back. */
export const STEER = `${head('pry.fixture-steer', 'Steer fixture')}
## Steer {id=steer}

:::enter
run: true
open_panel: steering
:::

:::do{id=s1}
\`\`\`actions
- set_steering: { feature_id: 7, strength: 4 }
- run_steer: {}
\`\`\`
:::

## Look {id=look}

:::explain
The steered text.
:::

## End {id=end}

:::enter
open_panel: predictions
:::

:::explain
Done.
:::
`;
