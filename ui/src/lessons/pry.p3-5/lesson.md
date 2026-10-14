---
format: 1
id: pry.p3-5
title: "Turn one feature up: does the text follow the label?"
tool: pry
summary: "Steer one feature and a control at the same strength, then judge the text by what changed, coherence, the control and the scale."
minutes: 12
stage: 3
targets: [T5, M4, N7]
spine: [residual-stream, sampling, append, repeat]
new_terms: [steering, coherence]
prerequisites: [pry.p2-5, pry.p3-4, pry.p1-5]
cold_entry: "Three things from before. A feature is one of the patterns a sparse autoencoder (SAE) splits a residual stream into, and its label is another AI's guess at what it fires on (P2.5). A feature's direction is the fixed list of numbers it adds to the residual stream, scaled by its activation, and knocking a feature out subtracts it (P3.4). And text gets written one token at a time, each new token added to the prompt before the next one's picked (P1.5)."
model: gpt2-small
baseline: { prompt: "On our trip we walked along the beach and watched the ocean" }
verified_rows: [25, 33, 63, 64, 65]
slots:
  target_label: { row: "25.target_label", format: string }
  control_label: { row: "25.control_label", format: string }
  s: { row: "25.strength", format: number }
  s_high: { row: "25.strength_high", format: number }
  coh_at_s: { read: steer.coherence, args: { which: steered }, from_capture: at_s, expect: -1.0579530000686646, tolerance: 0.05 }
  scale: { read: steer.scale, from_capture: at_s, expect: { strength: 25, activation_p50: 0, activation_p99: 0, activation_max: 0 } }
---

## Direction {id=s3-1 outline=P3.5.md#3.1}

:::recall{id=recall-direction}
```yaml
from: pry.p3-4
question: "In P3.4 you knocked features out. What did that remove from the residual stream?"
free: true
```
:::

:::do{id=ocean-features}
Every time a feature's active, it adds the same fixed mix of numbers to the residual stream, its direction. Only the amount changes. Press **Do it** to run the beach prompt and look at :look{at=feature-row id=$row.25.target_id}[a feature row at ' ocean'].

Knocking a feature out removed its direction; this lesson adds more of it.

```actions
- set_prompt: { text: "On our trip we walked along the beach and watched the ocean" }
- ensure_run: { prompt: "On our trip we walked along the beach and watched the ocean" }
- open_panel: { panel: features }
- focus_token: { text: " ocean" }
```
:::

:::analogy
```yaml
like: "a heading on a map"
because: "A heading says which way to go, and how far you go is a separate number. A direction says which way the feature pushes the residual stream, and the activation says how far."
breaks: "a map heading has two numbers and this has 768, and two features' directions can partly overlap."
```
:::

## Steering and steering strength {id=s3-2 outline=P3.5.md#3.2}

:::do{id=steering-tab}
Now turn a feature up instead. Add more of one feature's direction to the residual stream, at one layer and at every token, prompt included, then let the model write. That's called **steering**. It's the standard test for whether a feature does what its label says, and Pry's Steering tab does it. "Steering strength" is the number you set, not the feature's activation. Once you've steered, Pry shows it beside the feature's usual activation range on this prompt, so you can tell how hard you're pushing next to how hard it normally pushes. Press **Do it** to open :look{at=steering-feature-menu}[the feature menu], then find :look{at=steering-strength}[Steering strength].

From here on, a feature is just a feature and its direction.

```actions
- open_panel: { panel: steering }
- highlight: { anchors: [steering-feature-menu, steering-strength] }
```
:::

:::analogy
```yaml
like: "a volume knob for one feature"
because: "You turn one feature's direction up and listen to what comes out."
breaks: "it pushes at every token including the prompt, too much turns the text to mush, and a match doesn't show the label covers everything the feature does."
```
:::

## Target vs control {id=s3-3 outline=P3.5.md#3.3}

:::slots
period: { read: prediction, args: { token: "." }, field: prob, expect: 0.10398386418819427, tolerance: 0.02 }
rise: { read: prediction, args: { token: " rise" }, field: prob, expect: 0.04655522480607033, tolerance: 0.02 }
breeze: { read: prediction, args: { token: " breeze" }, field: prob, expect: 0.03423939272761345, tolerance: 0.02 }
:::

:::explain
Unsteered, the next token's spread out: "." gets {period}, ' rise' gets {rise} and ' breeze' gets {breeze}. You'll steer a target feature, and Pry steers a control feature beside it. The control's picked so its direction is the same size as the target's, so at the same steering strength it pushes just as hard. Only which way it pushes differs.
:::

:::predict{id=which-change checks=changed-obs}
Steer the target feature (label: {target_label}) and a control feature (label: {control_label}) at the same steering strength, {s}. Which ones change the text?

```yaml
choices:
  - { text: "only the target", target: [T5, N7, M4], feedback: "The model went another way: the control changed the text too, just not toward {target_label}. Any push this size moves the text, so 'it changed' can't be the test." }
  - { text: "both", feedback: "That's what happened. Both texts change. So 'it changed' can't be the test. What else would you look at?" }
  - { text: "neither", feedback: "The model went another way: both texts changed. A push this size moves the text whichever way it points." }
```
:::

:::predict{id=toward-label checks=changed-obs}
Which moves the text toward the target's label?

```yaml
choices:
  - { text: "target" }
  - { text: "control" }
  - { text: "both" }
```
:::

## What changed {id=s3-4 outline=P3.5.md#3.4}

:::do{id=steer-both}
Press **Do it** to steer the target and the control. Read :look{at=steering-panel}[the two text panes], with the changed tokens marked, and then the line that says whether the label's idea shows up in each.

```actions
- set_hidden: { anchor: steering-coherence, on: true }
- set_steering: { feature_id: $row.25.target_id, strength: $row.25.strength }
- run_steer: { control: true }
```

```yaml
capture: at_s
```
:::

:::compare{id=three-texts}
Unsteered, steered and control, side by side.

```yaml
columns:
  - { read: steer.text, args: { which: original } }
  - { read: steer.text, args: { which: steered } }
  - { read: steer.text, args: { which: control } }
```
:::

:::observe{id=changed-obs}
Both texts changed. The steered one fills up with sun, clouds, wind and rain. The control's text changed too, and it went round in circles about the ocean, with no rain in it. So only the target moved toward its label. Counting changed words wouldn't have told you that: the control changed nearly as many. Now the scale: steering strength beside the feature's usual activation on this prompt reads {scale}. The feature doesn't fire here at all on its own, so every bit of that push is added.

```yaml
check:
  - { read: steer.text, args: { which: steered }, op: contains, value: "rain" }
  - { read: steer.text, args: { which: control }, op: contains, value: "rain", not: true }
  - { read: steer.text, args: { which: control }, op: equals, value: $read.steer.text, value_args: { which: original }, not: true }
```
:::

## Coherence and the four readouts {id=s3-5 outline=P3.5.md#3.5}

:::slots
coh_steered: { read: steer.coherence, args: { which: steered }, expect: -1.0579530000686646, tolerance: 0.05 }
coh_control: { read: steer.coherence, args: { which: control }, expect: -0.7376875877380371, tolerance: 0.05 }
:::

:::do{id=reveal-coherence}
Whether the steered text still reads like sensible text is called its **coherence**. Steering papers use the word, and Pry measures it for every text: it scores the text with the unsteered model and takes the average log-probability per token, in nats. Closer to zero means the model finds the text more predictable. Press **Do it** to show :look{at=steering-coherence}[the coherence line]: {coh_steered} for the target, {coh_control} for the control.

```actions
- set_hidden: { anchor: steering-coherence, on: false }
```
:::

:::explain-result
You judge a steer by four things, each with its source in view: what changed (the texts side by side), whether the label's idea shows up, coherence, and the control. Never by how many words changed, since the control changes words too.

Look at the control's coherence. It's closer to zero than the target's, and the control's text is the one that repeats itself. The model finds repetition very predictable, so this measure scores it as coherent. That's why coherence is one readout of four, not the verdict.

```yaml
supports: "The target pushed the text toward its label and the control, pushing just as hard, didn't. Coherence says how predictable the model finds each text, so read it next to the texts themselves."
leaves_open: "This is one prompt at one steering strength. Coherence measures predictability, not sense, so repetitive text can score well, and none of the four readouts shows what the feature does when nobody's steering it."
tool: steering
skeptic: { says: "A skeptic would say any feature at this strength would fill the text with weather, since the prompt's already outdoors.", check: "Here's the check: the control, at the same strength on the same prompt, wrote no rain at all." }
```
:::

## Push harder {id=s3-6 outline=P3.5.md#3.6}

:::slots
coh_high: { read: steer.coherence, args: { which: steered }, expect: -1.0579530000686646, tolerance: 0.05 }
:::

:::predict{id=push-harder checks=harder-obs}
Raise the target's steering strength to {s_high}. What happens to coherence and to the label's idea?

```yaml
choices:
  - { text: "both go up" }
  - { text: "the idea goes up, coherence drops" }
  - { text: "nothing more changes" }
```
:::

:::do{id=steer-high}
Press **Do it** to steer the same feature at the higher strength, which is as high as Pry's steering strength goes.

```actions
- set_steering: { feature_id: $row.25.target_id, strength: $row.25.strength_high }
- run_steer: {}
```
:::

:::observe{id=harder-obs}
Coherence at the higher strength is {coh_high}, against {coh_at_s} at {s}. The steered text is still below the unsteered text's coherence, the way it was before.

```yaml
check: { read: steer.coherence, args: { which: steered }, op: lt, value: $read.steer.coherence, value_args: { which: original } }
assert:
  - require: { slot: coh_high, op: equals, slot2: coh_at_s }
    say: "Pushing harder didn't drop coherence any further on this feature: the steered text came out the same, word for word. Push hard enough and text can turn to mush; this feature stopped changing first."
    else: "Pushing harder moved coherence. Compare the two numbers, and read both texts before you decide what changed."
```
:::

:::analogy
```yaml
like: "mush"
because: "Push a feature hard enough and the text can stop making sense, and you'll see it before any number tells you."
breaks: "mush is a symptom you see; coherence is the measure."
```
:::

## What a steer shows {id=s3-7 outline=P3.5.md#3.7}

:::explain-result
The tempting guess was that only the target would change the text. It's reasonable: you only turned one feature up. The control rules it out, because it changed the text too. What set the target apart was the direction of the change.

A steer that doesn't bring out the label's idea doesn't show the feature's unused, either. The steering strength may be small next to the feature's usual activation range, the idea may show up in the probabilities but not in the text, or this layer may not be where that idea gets used.

```yaml
supports: "Steering pushes at every token, prompt included, at one layer. A match with the label shows the label fits at least that much, so check coherence and the control before reading more into it. Labels are written by an AI and can be wrong."
leaves_open: "A steer shows what adding this direction does to the text on this prompt. It doesn't show the model uses the feature this way on its own, or that the label covers everything the feature does."
tool: steering
skeptic: { says: "A skeptic would say the prompt's already about the beach, so any push drifts toward sea words.", check: "Here's the check: the control on the same prompt, then the same steer on a prompt with no beach in it." }
```
:::

:::analogy
```yaml
like: "a thumb on the scale at every step of writing"
because: "Each time the model picks a token, the steer has already tipped things a little toward the feature's direction."
breaks: "it's added to the residual stream at one layer, not to the final logits."
```
:::

## Transfer {id=s5 outline=P3.5.md#5}

::::transfer{id=saturday}
```yaml
prompt: "My favourite thing to do on a Saturday is"
expect_if_explanation_holds: "If the target's direction pushes toward weather on its own, the steered text drifts toward rain and sun here too, on a prompt with no beach in it."
limits: "One more prompt, and the label's idea showing up once doesn't tell you how often it would on others."
```

:::predict{id=saturday-steer checks=saturday-obs}
Same target feature, same steering strength {s}. Will the label's idea show up here, and will coherence hold?

```yaml
free: true
```
:::

:::do{id=steer-saturday}
Press **Do it** to steer the Saturday prompt with the same feature at the same strength.

```actions
- set_prompt: { text: "My favourite thing to do on a Saturday is" }
- set_steering: { feature_id: $row.25.target_id, strength: $row.25.strength }
- run_steer: {}
```
:::

:::observe{id=saturday-obs}
Read the two texts and the coherence line. Did the label's idea show up, and how far did coherence move from the unsteered text's? Write down what you see.

```yaml
journal: true
```
:::

::::

:::task{id=find-strength}
Find a steering strength where the label's idea shows up in the text. Then read the coherence line next to it: you've seen that a number closer to zero can just mean repetition, so judge it beside the text. Change only the steering strength, type your guess before each run, and you've got four runs.

```yaml
target:
  - { read: steer.text, args: { which: steered }, op: contains, value: "rain" }
max_runs: 4
predict_before_each_run: true
one_change: set_steering
learner_actions: [set_steering, run_steer]
reset: { prompt: "My favourite thing to do on a Saturday is", steering: { feature_id: $row.25.target_id, strength: 0 } }
```
:::

## Explain the chain {id=s6 outline=P3.5.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what does steering add to the model, how did you tell whether the text followed the label, and why did you need the control?"
model_answer: "A feature's direction is a fixed mix of the residual stream's numbers; steering adds more of it at one layer, at every token; any push changes the text, so the test is whether the label's idea shows up while coherence holds, and whether a control at the same steering strength does the same; even a match shows the label fits that much, not that it's the whole story."
```
:::
