---
format: 1
id: pry.p3-7
title: "Case study: build a case"
tool: pry
summary: "Look, name a suspect, predict, poke one link with a control, and write the finding with its limits, on a prompt you pick."
minutes: 15
stage: 3
targets: [T6]
spine: [residual-stream, logits, probabilities]
new_terms: [circuit, direct value path]
prerequisites: [pry.p2-4, pry.p3-2, pry.p3-3, pry.p3-5]
cold_entry: "Three tools from before. DLA splits a logit into each part's direct push (P2.4). Ablation switches a part off for one run, and a random-head control tells you whether any knockout would do the same (P3.2). And activation patching copies one part from one run into another to see where the answer goes (P3.3)."
model: gpt2-small
baseline: { prompt: "The war lasted from the year 1732 to the year 17" }
verified_rows: [14, 19, 36, 68, 69, 70, 71]
slots:
  map_head: { row: "19.map_head", format: string }
  control_head: { row: "19.control_head", format: string }
  map_delta: { read: ablation.delta, args: { token: "49" }, from_capture: map, expect: -0.03274303674697876, tolerance: 0.02 }
  control_delta: { read: ablation.delta, args: { token: "49" }, from_capture: control, expect: -0.0018772967159748077, tolerance: 0.02 }
---

## Recall {id=s3-1 depth=optional outline=P3.7.md#3.1}

:::recall{id=recall-control}
```yaml
from: pry.p3-5
question: "In P3.5 the control feature changed the text too. What did that tell you about 'the text changed'?"
free: true
```
:::

## The years {id=s3-2 outline=P3.7.md#3.2}

:::do{id=war-ensure}
This lesson puts everything together on one prompt, then hands you the controls. Press **Do it** to run the war sentence. Predictions stays hidden until you've guessed.

```actions
- set_prompt: { text: "The war lasted from the year 1732 to the year 17" }
- ensure_run: { prompt: "The war lasted from the year 1732 to the year 17" }
```
:::

:::predict{id=years checks=flat-obs}
What will the model favour for the last two digits?

```yaml
choices:
  - { text: "one year with most of the probability", feedback: "The model went another way: the top year gets about 1 in 17. What the top years share is that they're all above 32." }
  - { text: "several years above 32, none with much", feedback: "That's what happened. No year gets much, and the top ones are all later than 1732. How would a model get that?" }
  - { text: "years below 32", feedback: "The model went another way: the top years are all above 32, so the war ends after it starts." }
  - { text: "anything at all", feedback: "The model went another way: it's spread out, but not randomly. The top years are all above 32." }
hides: [predictions-panel]
```
:::

## A flat shape {id=s3-3 outline=P3.7.md#3.3}

:::slots
p49: { read: prediction, args: { token: "49" }, field: prob, expect: 0.05795148387551308, tolerance: 0.02 }
p50: { read: prediction, args: { token: "50" }, field: prob, expect: 0.050567593425512314, tolerance: 0.02 }
p45: { read: prediction, args: { token: "45" }, field: prob, expect: 0.03358353301882744, tolerance: 0.02 }
p43: { read: prediction, args: { token: "43" }, field: prob, expect: 0.031525228172540665, tolerance: 0.02 }
top_four: { from: [p49, p50, p45, p43], formula: sum, format: probability }
:::

:::observe{id=flat-obs}
Look at :look{at=predictions-panel}[the top four], then :look{at=everything-else-row}[everything else]. "49" gets {p49}, "50" gets {p50}, "45" gets {p45} and "43" gets {p43}. Together that's {top_four}, and the rest is spread thin over lots of other tokens. No single year gets much. What the top ones share is that they're all above 32.

```yaml
check: { read: top_guess.token, op: equals, value: "49" }
```
:::

## Circuit {id=s3-4 outline=P3.7.md#3.4}

:::do{id=key-parts-tab}
Researchers have traced this exact kind of prompt. Hanna and colleagues found, in 2023, a small group of parts doing the job: heads that move the start year to the end, and MLPs in roughly the last few layers that push up the years above it. A small set of parts that work together on one job, established by lots of tests, is called a **circuit**. It's what interpretability papers keep trying to find, and Pry's glossary and :look{at=tab-key-parts}[the Key parts tab] use the word.

```actions
- highlight: { anchor: tab-key-parts }
```
:::

## The Key parts map {id=s3-5 outline=P3.7.md#3.5}

:::predict{id=is-circuit checks=map-obs}
Key parts draws the parts with the biggest direct pushes on the guess after the selected word. Is that the circuit?

```yaml
choices:
  - { text: "yes, that's the circuit", target: T6, feedback: "Lots of people read the map as the answer. It's built from DLA, so it's a list of suspects with lines." }
  - { text: "a starting point to test", feedback: "That's how to read it. It's built from DLA, so it's a list of suspects with lines, and you've got the tools to test them." }
```
:::

:::do{id=run-key-parts}
Key parts explains the guess after the word you've selected, the same way Why (DLA) does. With the last word selected, that's the top guess, "49". It doesn't use a contrast token, and it doesn't add up the years above 32. Press **Do it** to select the last " 17" and draw :look{at=circuit-graph}[the map].

```actions
- focus_token: { text: " 17", occurrence: last }
- open_panel: { panel: circuit }
- run_circuit: {}
```
:::

:::observe{id=map-obs}
The map explains "49", the top guess after the last word. Each box is a head or an MLP with a big direct push, and the lines run between them.

```yaml
check: { read: circuit.target, op: contains, value: { token: "49" } }
```
:::

## Direct value path {id=s3-6 outline=P3.7.md#3.6}

:::explain-result
Look at :look{at=circuit-graph}[one edge]. A line on the map means one part's output fed straight into a later head, with nothing in between. That's called a **direct value path**. It's the exact claim each line makes, and Pry's own caveat uses the name.

Two limits come with it. A missing line doesn't prove no connection: parts can talk through other parts. A part that matters by changing what other parts do can have a small direct push, so it gets left off the map.

```yaml
supports: "Each line is a direct value path: one part's output going straight into a later head. The boxes are the parts with the biggest direct pushes on the guess."
leaves_open: "A missing line doesn't show two parts aren't connected, and a part that works by changing other parts can be missing from the map altogether."
tool: circuit
skeptic: { says: "A skeptic would say a part with a big direct push must be doing the job.", check: "Here's the check: knock it out next to a head that's off the map, and compare." }
```
:::

## Poke one link, with a control {id=s3-7 outline=P3.7.md#3.7}

:::predict{id=map-head-off checks=poke-obs}
Knock out {map_head}, a head on the map. What happens to "49"?

```yaml
choices:
  - { text: "falls a lot" }
  - { text: "falls a little" }
  - { text: "no visible change" }
```
:::

:::predict{id=control-head-off checks=poke-obs}
What about {control_head}, a head that isn't on the map?

```yaml
choices:
  - { text: "falls a lot" }
  - { text: "falls a little" }
  - { text: "no visible change" }
```
:::

:::do{id=map-knockout}
Press **Do it** to keep the last word selected, knock out the map head and run again.

```actions
- focus_token: { text: " 17", occurrence: last }
- set_head_ablation: { heads: [{ layer: $row.19.map_head_layer, head: $row.19.map_head_head }], on: true }
- run_head_ablation: {}
```

```yaml
capture: map
```
:::

:::do{id=control-knockout}
Now the control. Press **Do it** to clear that knockout and switch off the head that isn't on the map instead.

```actions
- reset: {}
- set_head_ablation: { heads: [{ layer: $row.19.control_head_layer, head: $row.19.control_head_head }], on: true }
- run_head_ablation: {}
```

```yaml
capture: control
```
:::

:::compare{id=both-lists}
Both Ablated top-5 lists: map head off on the left, control head off on the right.

```yaml
columns:
  - { read: ablation.top5, args: { side: ablated }, from: map }
  - { read: ablation.top5, args: { side: ablated }, from: control }
```
:::

:::observe{id=poke-obs}
With the map head off, "49" moved by {map_delta}. With the control head off, it moved by {control_delta}. The map head's knockout lowered "49" more than the control's did.

```yaml
check: { read: ablation.delta, args: { token: "49" }, from: map, op: lt, value: $capture.control.ablation.delta, value_args: { token: "49" } }
```
:::

## What the case shows {id=s3-8 outline=P3.7.md#3.8}

:::explain-result
The map, a knockout and a control together make a case for one link, on one prompt. There's a limit on what you measured, too. Pry tracks only "49". Hanna and colleagues added up the probability of every year above 32, so a drop in "49" while "50" rises might leave the "bigger year" behaviour untouched. If a knockout changes little, other parts may be covering (you saw that in P3.2), or the line was direct but small.

Pulling a part, benching a player, the knob and the thumb on the scale: we're done with all four. From here on, ablation and steering by name.

```yaml
supports: "Key parts shows the parts with the biggest direct pushes on the guess after the selected word: a starting point, not an established circuit. A knockout with a control tests one link on one prompt."
leaves_open: "The map leaves off parts that matter by changing other parts, and each line claims only a direct value path. One knockout on one prompt, measured on one token, can't establish a circuit."
tool: circuit
skeptic: { says: "A skeptic would say \"49\" dropped but \"50\" rose, so the model still prefers years above 32.", check: "Here's the check: look at the Ablated top-5. Are the top years still all above 32?" }
```
:::

::::fold{title="The MLP Swap test on 1732 and 1701"}

:::do{id=greater-than-swap}
The greater-than experiment swaps the start year. Change 1732 to 1701 and years above 32 lose their reason to win. Press **Do it** to run the MLP Swap test on that pair, then click bars and read each one's three logits for "49": clean, corrupted and patched. Some bars land below zero, which means swapping that MLP pushed "49" further away.

```actions
- run_patching: { clean: "The war lasted from the year 1732 to the year 17", corrupted: "The war lasted from the year 1701 to the year 17", type: mlp }
```
:::

::::

## Build your own case {id=s3-9 outline=P3.7.md#3.9}

:::slots
own_control_delta: { read: ablation.top_delta, from_capture: own-control, expect: learner }
margin: { row: "19.margin_negative", format: probability }
bar: { from: [own_control_delta, margin], formula: sum, format: probability }
:::

:::task{id=pick-control}
Your turn. Pick a prompt whose top answer is a single token, select its last word and run Key parts so the map explains the top guess. Then choose your control first: a head that isn't on the map. Knock it out before you see what the map head does, so you can't pick a control that flatters your suspect.

```yaml
target:
  - { read: ablation.head_count, op: equals, value: 1, expect: learner }
  - { read: circuit.nodes, op: contains, value: $read.ablation.heads, not: true }
constraint:
  - { read: circuit.target, field: token, op: equals, value: $read.top_guess.token }
learner_actions: [set_prompt, run_circuit, set_head_ablation, run_head_ablation]
capture: own-control
reset: { prompt: "The war lasted from the year 1732 to the year 17", focus_token: { text: " 17", occurrence: last }, head_ablation: { heads: [], on: false } }
```
:::

:::task{id=own-case}
On a prompt you pick, find one part on the Key parts map whose knockout lowers the top token's probability by at least 5 points more than a control head does. Your control moved it by {own_control_delta}. Add the 5-point margin, {margin}, and the bar you're aiming to get under is {bar}. You've got three knockouts, one head at a time, and you type your guess before each.

```yaml
target:
  - { read: ablation.top_delta, op: lt, value: $slot.bar }
  - { read: circuit.nodes, op: contains, value: $read.ablation.heads }
constraint:
  - { read: circuit.target, field: token, op: equals, value: $read.top_guess.token }
  - { read: ablation.head_count, op: equals, value: 1, expect: learner }
max_runs: 3
predict_before_each_run: true
learner_actions: [set_prompt, run_circuit, set_head_ablation, run_head_ablation]
reset: { prompt: "The war lasted from the year 1732 to the year 17", focus_token: { text: " 17", occurrence: last }, head_ablation: { heads: [], on: false } }
```
:::

:::explain
Couldn't find one? That's a result too, and it usually means other parts are covering. Stuck after two attempts? Try the Mary and John sentence, with the head you found in P3.2's task: :earlier{key="pry.p3-2.found-head"}[skipped]. If that says skipped, any head on that sentence's map is a fair place to start.
:::

## Transfer {id=s5 outline=P3.7.md#5}

::::transfer{id=war-1650}
```yaml
prompt: "The war lasted from the year 1650 to the year 16"
expect_if_explanation_holds: "If the model favours years after the start year, the top years here all land at or above 50, and the map for this prompt may hold different heads."
limits: "One more prompt, measured on its top token. A head that's missing from this map can still matter here through other parts."
```

:::predict{id=above-fifty checks=war-1650-obs}
Will the top years all be at or above 50, and will the same head from `3.7` be on the map?

```yaml
free: true
```
:::

:::do{id=war-1650-run}
Press **Do it** to run the 1650 sentence, select its last " 16", draw Key parts and knock out the same map head as before.

```actions
- set_prompt: { text: "The war lasted from the year 1650 to the year 16" }
- run: {}
- focus_token: { text: " 16", occurrence: last }
- run_circuit: {}
- set_head_ablation: { heads: [{ layer: $row.19.map_head_layer, head: $row.19.map_head_head }], on: true }
- run_head_ablation: {}
```
:::

:::observe{id=war-1650-obs}
Read the top four, check whether the head you knocked out is on this map, and see what its knockout did to the top token. The top four come out at or above 50, and one of them is exactly 50. Write down what held and what didn't.

```yaml
journal: true
```
:::

::::

## Explain the chain {id=s6 outline=P3.7.md#6}

:::explain-chain
```yaml
prompt: "Write your case in a few sentences: what you looked at, your suspect and why, the poke and its control, what happened, and what your case doesn't show."
model_answer: "The top years are all above 32 but none has much probability; with the last word selected, Key parts shows the parts with the biggest direct pushes on the guess after it, \"49\"; the map isn't the circuit, it's suspects with direct value paths; knocking out one map head lowered \"49\" more than an off-map head; the case covers one link, one prompt and one token, and the \"bigger year\" behaviour needs the sum over years to test."
```
:::
