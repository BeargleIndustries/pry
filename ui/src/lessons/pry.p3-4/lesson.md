---
format: 1
id: pry.p3-4
title: "Switch a feature off: was it doing anything?"
tool: pry
summary: "Knock out the features that fire on ' nurse', check against an unrelated one, and see what their labels can and can't tell you."
minutes: 10
stage: 3
targets: [N7, T5]
spine: [residual-stream]
new_terms: [direction]
prerequisites: [pry.p2-5, pry.p3-1, pry.p3-2]
cold_entry: "Three things from before. A sparse autoencoder (SAE) splits a token's residual stream into features, and a feature's activation says how strongly it's active on that token (P2.5). Ablation switches a part off for one run to see whether the answer changes (P3.2). And the nurse and doctor pair: with ' nurse', ' she' tops the list; with ' doctor', ' he' does (P3.1)."
model: gpt2-small
baseline: { prompt: "The nurse said that" }
verified_rows: [17, 24, 61, 62]
slots:
  n: { row: "24.n_top", format: count }
  target_delta: { read: feature_ablation.delta, args: { token: " she" }, from_capture: target, expect: -0.011518552899360657, tolerance: 0.02 }
  control_delta: { read: feature_ablation.delta, args: { token: " she" }, from_capture: control, expect: 0.0009149760007858276, tolerance: 0.02 }
---

## Recall {id=s3-1 depth=optional outline=P3.4.md#3.1}

:::recall{id=recall-held}
```yaml
from: pry.p3-2
question: "The name movers came off and ' Mary' held on more than you might expect. What were the two readings of 'it held'?"
free: true
```
:::

## Knocking out a feature {id=s3-2 outline=P3.4.md#3.2}

:::explain
Every feature comes with its own fixed list of numbers, one for each number in the residual stream. Adding that list in pushes the residual stream one particular way, and a feature's activation says how much of it there is. That list is called the feature's **direction**, a name you'll see again when you turn a feature up instead of off.

Ablation (P3.2) applies to features too. At one layer, the SAE measures each feature's activation at every token; Pry subtracts the feature's own share (its activation times its direction's numbers) from the residual stream, at that layer, at every token where the feature fires, and lets the run carry on. Nothing gets rebuilt, and the edit isn't limited to ' nurse'.

In Pry it's "Knock out features:", with results in "Knockout results" and "Ablated top-5". It's the same ablation you ran on heads, done to a feature.
:::

:::analogy
```yaml
like: "pull a part out of a machine and see what breaks"
because: "It's the picture from P3.2 again, with the same limits, plus one more."
breaks: "other parts take over; zero is harsh; and the SAE doesn't capture everything in the residual stream, so removing a feature removes only the part the SAE accounts for."
```
:::

::::fold{title="The part the SAE doesn't capture"}

:::explain
Rebuild a residual stream from its SAE features and you don't get it back exactly. What's left over has a real name: **reconstruction error**. A feature knockout never touches it, so whatever the leftover carries keeps flowing through the run.
:::

::::

:::do{id=nurse-features}
Press **Do it** to run the nurse prompt and open :look{at=panel-b-features-list}[the Features list at ' nurse'].

```actions
- set_prompt: { text: "The nurse said that" }
- ensure_run: { prompt: "The nurse said that" }
- open_panel: { panel: features }
- switch_sae_layer: { layer: $row.24.sae_layer }
- focus_token: { text: " nurse" }
```
:::

## Knock out the top features at ' nurse' {id=s3-3 outline=P3.4.md#3.3}

:::slots
before: { read: feature_ablation.prediction, args: { side: original, token: " she" }, field: prob, expect: 0.1896977424621582, tolerance: 0.02 }
after: { read: feature_ablation.prediction, args: { side: ablated, token: " she" }, field: prob, expect: 0.17817918956279755, tolerance: 0.02 }
:::

:::predict{id=top-off checks=top-obs}
Switch off the {n} most active features at ' nurse' (labels shown; Pry removes them wherever they fire in the prompt). What happens to ' she'?

```yaml
choices:
  - { text: "falls to almost nothing", target: N7, feedback: "The model went another way: ' she' fell from {before} to {after}, not to nothing." }
  - { text: "falls some", feedback: "That's what happened: ' she' fell from {before} to {after}. Is that more than switching off any feature would do?" }
  - { text: "no visible change", feedback: "The model went another way: ' she' fell from {before} to {after}. It's a small move, so you'll need something to compare it with." }
  - { text: "rises", feedback: "The model went another way: ' she' fell from {before} to {after}." }
```
:::

## Do and observe {id=s3-4 outline=P3.4.md#3.4}

:::slots
before: { read: feature_ablation.prediction, args: { side: original, token: " she" }, field: prob, expect: 0.1896977424621582, tolerance: 0.02 }
after: { read: feature_ablation.prediction, args: { side: ablated, token: " she" }, field: prob, expect: 0.17817918956279755, tolerance: 0.02 }
:::

:::do{id=top-knockout}
Press **Do it** to knock out those features and run again, then compare :look{at=ablation-results}[Original top-5 vs Ablated top-5]. If you'd like the logits, they're a click away.

```actions
- set_feature_ablation: { ids: $row.24.top_ids, on: true }
- run_feature_ablation: {}
```

```yaml
capture: target
```
:::

:::observe{id=top-obs}
' she' went from {before} to {after}. It fell, and it's still on top, so the features weren't the whole story. The labels sounded like they'd explain ' she' on their own, and the run says they don't.

```yaml
check: { read: feature_ablation.delta, args: { token: " she" }, op: lt, value: 0, expect: -0.011518552899360657 }
```
:::

## The control feature {id=s3-5 outline=P3.4.md#3.5}

:::predict{id=control-off checks=control-obs}
Now switch off one feature that's active at ' nurse' but whose label has nothing to do with people or gender. What happens to ' she'?

```yaml
choices:
  - { text: "falls as much" }
  - { text: "falls a little" }
  - { text: "no visible change" }
```
:::

:::do{id=control-knockout}
Is that drop more than switching off any feature does? Press **Do it** to clear the knockouts and switch off one active feature whose label is about processes and actions, not people.

```actions
- reset: {}
- set_feature_ablation: { ids: [$row.24.control_id], on: true }
- run_feature_ablation: {}
```

```yaml
capture: control
```
:::

:::observe{id=control-obs}
The unrelated feature moved ' she' by {control_delta}, against {target_delta} for the top features. That's the floor any real effect has to beat, and the top features beat it.

```yaml
check: { read: feature_ablation.delta, args: { token: " she" }, from: target, op: lt, value: $capture.control.feature_ablation.delta, value_args: { token: " she" } }
```
:::

:::question{id=why-unrelated}
Why does even an unrelated feature move ' she' a little?

```yaml
free: true
model_answer: "Removing any active feature's share changes the residual stream, and later layers respond to that change."
```
:::

## What the knockout supports {id=s3-6 outline=P3.4.md#3.6}

:::explain-result
The common guess is that these are the features that make ' she', so ' she' should vanish. It's reasonable: they're active on ' nurse' and their labels sound right. The run doesn't back all of that, though. ' she' fell further than with an unrelated feature, so these features affect ' she' on this prompt, at this layer. They were removed at every token where they fire, not only at ' nurse'.

The other way round needs care too. A feature whose knockout changes nothing may still be used. The same information can sit in other features, or earlier layers may already have copied it into later tokens' residual streams, before the layer you edited.

```yaml
supports: "A feature knockout shows how much this answer depends on that feature here. Removing any active feature's share changes the residual stream a little, so compare against a control before reading a small change. Labels are best guesses from Neuronpedia, not certainties."
leaves_open: "Knocking out a feature tests it at one layer, on one prompt. It doesn't show the label is right, it removes only the part of the residual stream the SAE accounts for, and 'no change' can't rule out the same information sitting somewhere else."
tool: features
skeptic: { says: "A skeptic would say any change to the residual stream would move ' she' that much.", check: "Here's the check: the unrelated feature's knockout moved ' she' by {control_delta}, against {target_delta} for the top features." }
```
:::

## One feature at a time {id=s3-7 outline=P3.4.md#3.7}

:::task{id=find-feature}
Find one feature at ' nurse' whose knockout alone lowers ' she' by more than the control did. One feature at a time, and before each run write down what you expect from its label. Knocking out several at once mixes their effects, so now you're pulling them apart.

```yaml
target:
  - { read: feature_ablation.delta, args: { token: " she" }, op: lt, value: $capture.control.feature_ablation.delta, value_args: { token: " she" } }
constraint:
  - { read: feature_ablation.count, op: equals, value: 1, expect: learner }
predict_before_each_run: true
learner_actions: [set_feature_ablation, run_feature_ablation]
reset: { prompt: "The nurse said that", feature_ablation: { ids: [], on: false } }
```
:::

:::question{id=fitting-label}
Did the feature with the most fitting label move ' she' most?

```yaml
choices:
  - { text: "yes", target: T5, feedback: "Check the others too. A label is another AI's guess at what a feature fires on, and it doesn't promise what the feature does to the answer." }
  - { text: "no", feedback: "That happens. A label is another AI's guess at what a feature fires on. What a feature does to the answer is something only a test like this one shows." }
```
:::

## Transfer {id=s5 outline=P3.4.md#5}

:::slots
he_delta: { read: feature_ablation.delta, args: { token: " he" }, expect: -0.014612361788749695, tolerance: 0.02 }
:::

::::transfer{id=doctor}
```yaml
prompt: "The doctor said that"
expect_if_explanation_holds: "If the knockout works the way it did on ' nurse', switching off the top features at ' doctor' lowers ' he' a little, and it stays near the top."
limits: "One more prompt at the same layer, with no control run this time, so a small move is hard to read on its own."
```

:::predict{id=he-falls checks=he-obs}
Switch off the top features at ' doctor'. Will ' he' fall the way ' she' fell for ' nurse'?

```yaml
free: true
```
:::

:::do{id=doctor-knockout}
Press **Do it** to clear the knockouts, run the doctor prompt and knock out the top features at ' doctor'. One of them's labelled after a TV show. Labels can be odd like that, and it's worth remembering they're guesses.

```actions
- reset: {}
- set_prompt: { text: "The doctor said that" }
- run: {}
- focus_token: { text: " doctor" }
- set_feature_ablation: { ids: $row.24.doctor_top_ids, on: true }
- run_feature_ablation: {}
```
:::

:::observe{id=he-obs}
' he' moved by {he_delta}. Compare it with what happened to ' she', and write down whether it fits.

```yaml
journal: true
```
:::

::::

:::question{id=two-reasons}
If ' he' barely moves, list two reasons that don't mean the features are unused.

```yaml
free: true
model_answer: "Information elsewhere (other features, other tokens); other parts covering."
```
:::

## Explain the chain {id=s6 outline=P3.4.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what happens inside when Pry knocks out a feature, what did the drop in ' she' show, and why did you need the unrelated feature?"
model_answer: "At one layer, the SAE measures each feature's activation at every token, and Pry subtracts the feature's share (activation times direction) wherever it fires; ' she' fell more than with an unrelated feature, so those features affect ' she' here; removing any active feature changes the residual stream a little, so the control sets the floor; the label is still a guess, and no change wouldn't have meant unused."
```
:::
