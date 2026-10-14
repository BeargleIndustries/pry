---
format: 1
id: pry.p3-2
title: "Switch it off: did it matter?"
tool: pry
summary: "Knock out a head, predict first, check against random heads, and learn what a no-change result can't tell you."
minutes: 12
stage: 3
targets: [T4, T2]
spine: [residual-stream]
new_terms: [ablation, name mover head]
prerequisites: [pry.p2-1, pry.p3-1]
cold_entry: "Three things from before. An attention head is one of the parts in each layer that draws information from earlier tokens into the current one (P2.1). The logit difference is one token's logit minus another's, like ' Mary' minus ' John' (P2.4). And a minimal pair changes one thing and keeps the rest, so whatever moves moved with that change (P3.1). Today the one thing you change is inside the model."
model: gpt2-small
baseline: { prompt: "When Mary and John went to the store, John gave a drink to" }
verified_rows: [14, 23, 26, 57, 58]
slots:
  row23_token: { row: "23.token", format: string }
  movers_delta: { read: ablation.delta, args: { token: " Mary" }, from_capture: movers, expect: -0.19180729985237122, tolerance: 0.02 }
  control_delta: { read: ablation.delta, args: { token: " Mary" }, from_capture: control, expect: -0.022185027599334717, tolerance: 0.02 }
  heavy_delta: { read: ablation.delta, args: { token: " Mary" }, from_capture: heavy, expect: -0.002849757671356201, tolerance: 0.02 }
---

## Recall via TN-4 {id=s3-1 outline=P3.2.md#3.1}

:::explain
In P2.1 you picked :earlier{key="pry.p2-1.word-pick"}[skipped]. Attention showed where heads drew from. Today you test whether that mattered.

You also found a head that drew from ' Mary', :earlier{key="pry.p2-1.head-pick"}[skipped], and you wrote down a guess about the head with the heaviest line: :earlier{key="pry.p2-1.hypothesis"}[skipped]. If you skipped any of those, that's fine. You'll make fresh guesses as you go.
:::

## Ablation {id=s3-2 outline=P3.2.md#3.2}

:::explain
So far you've changed the prompt and watched the answer. Now you'll change the inside. Pick one part, set its output to zero for one run so it adds nothing to the residual stream, and see whether the answer changes. Switching a part off like that is called **ablation**. Papers call every switch-off experiment by that name, so it's worth owning. In Pry it's the "Knock out heads:" control, and the "Knockout results" and "Ablated top-5" readouts show what happened.
:::

:::analogy
```yaml
like: "pull a part out of a machine and see what breaks"
because: "If the machine stops working, that part was doing something. If it keeps going, you've learned something too, though not as much as you'd hope."
breaks: "other parts can take over, and Pry sets the output to zero, which is harsher than the averaging researchers mostly use"
```
:::

::::fold{title="Zero ablation and mean ablation"}

:::explain
Pry's knockout sets a head's output to exactly zero. That's called zero ablation. Researchers more often use mean ablation: they swap the head's output for its average over lots of other prompts, so the head still sends something ordinary and only the part specific to this prompt goes missing. Zero's harsher than that. A head that always adds a steady baseline can look important under zero ablation just because the baseline vanished. Keep that in mind when a drop looks big, and look for a control.
:::

::::

:::do{id=ioi-expert}
Press **Do it** to run the Mary and John sentence, open Attention and find :look{at=ablation-head-toggle}[the "Knock out heads:" control].

```actions
- set_prompt: { text: "When Mary and John went to the store, John gave a drink to" }
- ensure_run: { prompt: "When Mary and John went to the store, John gave a drink to" }
- open_panel: { panel: attention }
- set_attention_view: { view: expert }
- highlight: { anchor: ablation-head-toggle }
```
:::

## Knock out the heavy-line head {id=s3-3 outline=P3.2.md#3.3}

:::slots
mary_before: { read: ablation.prediction, args: { side: original, token: " Mary" }, field: prob, expect: 0.6769932508468628, tolerance: 0.02 }
mary_after: { read: ablation.prediction, args: { side: ablated, token: " Mary" }, field: prob, expect: 0.6741434931755066, tolerance: 0.02 }
:::

:::predict{id=heavy-off checks=heavy-obs}
This head draws heavily from {row23_token}. Switch it off. What happens to ' Mary'? Here's what you wrote in P2.1 about a head like this: :earlier{key="pry.p2-1.hypothesis"}[skipped].

```yaml
choices:
  - { text: "falls a lot (its line was heavy)", target: T2, feedback: "Here's what you wrote in P2.1: :earlier{key=\"pry.p2-1.hypothesis\"}[skipped]. Here's the test: ' Mary' went from {mary_before} to {mary_after}. Lots of people expect a big drop, because a thick line looks like importance." }
  - { text: "falls a little", feedback: "Here's the test: ' Mary' went from {mary_before} to {mary_after}. The heavy line didn't buy that head much say in the answer." }
  - { text: "no visible change", target: T4, feedback: "Here's the test: ' Mary' went from {mary_before} to {mary_after}. Hold on to that result, though. You'll see in a minute why no change doesn't mean the head does nothing." }
  - { text: "rises", feedback: "The model went another way: ' Mary' went from {mary_before} to {mary_after}. Some heads do push against the answer, and you'll meet one in the task." }
```
:::

## The heavy line didn't matter much {id=s3-4 outline=P3.2.md#3.4}

:::slots
before: { read: ablation.prediction, args: { side: original, token: " Mary" }, field: prob, expect: 0.6769932508468628, tolerance: 0.02 }
after: { read: ablation.prediction, args: { side: ablated, token: " Mary" }, field: prob, expect: 0.6741434931755066, tolerance: 0.02 }
:::

:::do{id=heavy-knockout}
Press **Do it** to knock out the heavy-line head and run again. Then read :look{at=ablation-results}[Original top-5 vs Ablated top-5]. If you'd like the logits too, they're one click away.

```actions
- set_head_ablation: { heads: [{ layer: $row.23.layer, head: $row.23.head }], on: true }
- run_head_ablation: {}
```

```yaml
capture: heavy
```
:::

:::observe{id=heavy-obs}
' Mary' went from {before} to {after}. The head drew heavily from {row23_token}, and switching it off left the answer where it was. A thick line shows where a head drew from. It doesn't show that what it drew mattered for this answer. That's the open question from P2.1, answered for this head.

```yaml
check: { read: ablation.delta, args: { token: " Mary" }, op: gt, value: -0.01, expect: -0.002849757671356201 }
```
:::

:::explain
The mixing desk and skimming were pictures of where a head draws from. We're done with them; a knockout tests whether it mattered.

```yaml
withdraws: [mixing desk]
```
:::

## The name mover heads {id=s3-5 outline=P3.2.md#3.5}

:::do{id=open-l9h9}
Researchers already have suspects for this sentence, found with lots of knockouts and patches. Heads that copy a name from earlier in the sentence into the answer are called **name mover heads**. Wang and colleagues named them in 2022 for exactly this kind of sentence, and Pry's glossary uses the name. Three of them are cells :look{at=head-cell layer=9 head=9}[`L9H9`], :look{at=head-cell layer=9 head=6}[`L9H6`] and :look{at=head-cell layer=10 head=0}[`L10H0`] in :look{at=panel-a-heatmap}[the grid]. Press **Do it** to open `L9H9` and watch its lines from ' to' land on ' Mary'.

```actions
- open_head: { layer: 9, head: 9 }
```
:::

:::explain
The head you found in P2.1 was :earlier{key="pry.p2-1.head-pick"}[skipped]. Is it one of these?
:::

## Knock out all three {id=s3-6 outline=P3.2.md#3.6}

:::predict{id=three-off checks=three-obs}
Switch off `layer 9 head 9`, `layer 9 head 6` and `layer 10 head 0` together (plus your P2.1 head, :earlier{key="pry.p2-1.head-pick"}[skipped], if it isn't one of them). What happens?

```yaml
choices:
  - { text: "' John' overtakes ' Mary'", feedback: "It's a fair guess: if these heads move the name, losing them should break the answer. Run it and see whether ' Mary' holds on." }
  - { text: "' Mary' drops but stays on top", feedback: "Run it and see how far it drops, and then what random heads do." }
  - { text: "no visible change", feedback: "Run it and see. Then check what three random heads do, so you've got something to compare with." }
```
:::

## With the control {id=s3-7 outline=P3.2.md#3.7}

:::do{id=movers-knockout}
Press **Do it** to clear the last knockout, switch off the name movers (and your P2.1 head, if it's a different one) and run again.

```actions
- reset: {}
- set_head_ablation: { heads: [{ layer: 9, head: 9 }, { layer: 9, head: 6 }, { layer: 10, head: 0 }, { $earlier: pry.p2-1.head-pick, fallback: { layer: 9, head: 9 } }], on: true }
- run_head_ablation: {}
```

```yaml
capture: movers
```
:::

:::do{id=control-knockout}
Now the control. Press **Do it** to clear those knockouts and switch off three heads the lesson picked at random instead: `L9H4`, `L2H5` and `L0H1`.

```actions
- reset: {}
- set_head_ablation: { heads: [{ layer: 9, head: 4 }, { layer: 2, head: 5 }, { layer: 0, head: 1 }], on: true }
- run_head_ablation: {}
```

```yaml
capture: control
```
:::

:::compare{id=two-lists}
:look{at=lesson:step:two-lists}[The two Ablated top-5 lists], name movers off on the left and random heads off on the right.

```yaml
columns:
  - { read: ablation.top5, args: { side: ablated }, from: movers }
  - { read: ablation.top5, args: { side: ablated }, from: control }
```
:::

:::observe{id=three-obs}
With the name movers off, ' Mary' moved by {movers_delta}. With the random heads off, it moved by {control_delta}. ' Mary' stays on top in both lists.

```yaml
check: { read: ablation.delta, args: { token: " Mary" }, from: movers, op: lt, value: $capture.control.ablation.delta, value_args: { token: " Mary" } }
assert:
  - require: { slot: movers_delta, op: lt, value: -0.1 }
    say: "With the name movers off, ' Mary' drops a lot."
    else: "With the name movers off, ' Mary' drops."
  - require: { slot: control_delta, op: lt, value: -0.02 }
    say: "With random heads off, ' Mary' moves too, just not as far."
    else: "With random heads off, ' Mary' barely moves."
```
:::

:::question{id=why-random}
Why knock out three random heads too?

```yaml
free: true
model_answer: "So you can tell 'these heads matter' from 'removing any three heads hurts'."
```
:::

## When the answer holds {id=s3-8 outline=P3.2.md#3.8}

:::explain-result
If the answer falls apart, the part mattered. If it holds, there are two ways to read it: the part didn't matter for this sentence, or other parts covered for it. Wang and colleagues saw exactly that second thing. When they removed the name movers, other heads partly took over the job. ' Mary' staying on top here fits either reading, and the knockout alone can't tell them apart. A better knockout won't fix that. You'd need a different test, and P3.3 has one.

```yaml
supports: "A knockout shows what happens to this answer without that head. If the answer holds, the head either didn't matter here or other heads covered for it, so 'no change' isn't 'not used'."
leaves_open: "Ablation says how much the answer depends on a head on this one prompt. It doesn't say what the head does, and a small drop can't rule out a head whose job others picked up."
tool: ablation
skeptic: { says: "A skeptic would say zero is harsher than anything the head ever outputs, so the drop is just damage.", check: "Here's the check: the random heads were zeroed too, and ' Mary' dropped {control_delta}." }
```
:::

::::fold{title="Heads that take over"}

:::explain
The heads that partly took over when the name movers went missing have a real name: **backup heads**. On a normal run they don't do much for this sentence. Knock out the name movers and they start pushing ' Mary' themselves.
:::

:::analogy
```yaml
like: "spare parts"
because: "They sit there until the main part's gone, then they fill in."
breaks: "the \"spares\" also do other jobs."
```
:::

::::

:::analogy
```yaml
like: "benching a player"
because: "Take one player off and the team might still win, because the others cover. That doesn't mean the player wasn't useful."
breaks: "the teammates adjust as in a real game, but here the benched player stands frozen on the field, sending nothing, which isn't how the model ever runs."
```
:::

## Find a head that matters {id=s3-9 outline=P3.2.md#3.9}

:::slots
task_threshold: { row: "26.task_threshold", format: probability }
neg_threshold: { row: "26.task_threshold_negative", format: probability }
:::

:::task{id=find-head}
Find one head whose knockout alone lowers ' Mary' by at least {task_threshold} points. One head at a time, and type your guess before each run. The grid's a good place to start, and so are the layers the name movers sit in, though you may find the biggest drops somewhere you don't expect.

```yaml
target:
  - { read: ablation.delta, args: { token: " Mary" }, op: lt, value: $slot.neg_threshold }
constraint:
  - { read: ablation.head_count, op: equals, value: 1, expect: learner }
predict_before_each_run: true
learner_actions: [set_head_ablation, run_head_ablation]
reset: { prompt: "When Mary and John went to the store, John gave a drink to", head_ablation: { heads: [], on: false } }
remember: { key: found-head, read: ablation.heads }
```
:::

## Transfer {id=s5 outline=P3.2.md#5}

:::slots
tom_delta: { read: ablation.delta, args: { token: " Tom" }, expect: 0.049371927976608276, tolerance: 0.02 }
:::

::::transfer{id=tom-sarah}
```yaml
prompt: "When Tom and Sarah went to the park, Sarah gave a ball to"
expect_if_explanation_holds: "If these three heads move the name in every sentence of this shape, knocking them out should lower ' Tom' the way it lowered ' Mary'."
limits: "It's one more sentence of the same shape, and one knockout. Whatever happens, it doesn't tell you what the heads do on every sentence."
```

:::predict{id=tom-drop checks=tom-obs}
Same three heads off. Does ' Tom' drop the way ' Mary' did?

```yaml
free: true
```
:::

:::do{id=tom-knockout}
Press **Do it** to clear the knockouts, run the Tom and Sarah sentence, then knock out the same three name movers.

```actions
- reset: {}
- set_prompt: { text: "When Tom and Sarah went to the park, Sarah gave a ball to" }
- run: {}
- set_head_ablation: { heads: [{ layer: 9, head: 9 }, { layer: 9, head: 6 }, { layer: 10, head: 0 }], on: true }
- run_head_ablation: {}
```
:::

:::observe{id=tom-obs}
' Tom' moved by {tom_delta}. It didn't drop: it went up. So on this sentence, switching off those three heads didn't cost ' Tom' anything. Either they aren't carrying the name here, or other heads covered for them and then some. One knockout can't tell you which. That's the same limit you just read about, showing up on a new sentence.

```yaml
check: { read: ablation.delta, args: { token: " Tom" }, op: gt, value: 0, expect: 0.049371927976608276 }
```
:::

::::

:::question{id=similar-job}
If ' Tom' drops by a similar amount, what does that suggest about these heads?

```yaml
free: true
model_answer: "They do a similar job on a sentence of the same shape, which is still one more prompt, not every sentence."
```
:::

## Explain the chain {id=s6 outline=P3.2.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what does switching a head off tell you that its attention lines couldn't, and what can a small drop not rule out?"
assert:
  - require: { slot: heavy_delta, op: gt, value: -0.01 }
    say: "the heavy-line head barely mattered"
    else: "the heavy-line head moved ' Mary' by {heavy_delta}"
model_answer: "Attention shows where a head drew from; ablation removes its addition to the residual stream and watches the answer; the heavy-line head barely mattered, the name movers mattered more than random heads; if the answer holds, other heads may have covered, so no change isn't proof of no use; zero is harsh, so a control is needed."
```
:::
