---
format: 1
id: pry.p2-2
title: "Can we catch a head doing one job?"
tool: pry
summary: "Give the model a made-up name twice, see it continue the repeat, and catch the heads that copy it forward."
minutes: 10
stage: 2
targets: [T5]
spine: [residual-stream]
new_terms: [induction head, previous-token head]
prerequisites: [pry.p2-1]
cold_entry: "Attention is the half of each layer that mixes information into a token's residual stream from itself and the tokens before it. It's split into attention heads, 12 per layer, and each head has its own pattern of which earlier tokens it draws from. A thick line shows where a head drew from, not whether that mattered."
model: gpt2-small
baseline: { prompt: "Pip ordered zebra lamps from Quorn. Pip ordered zebra lamps from" }
verified_rows: [15, 16, 48, 49]
slots:
  qu: { read: prediction, args: { token: " Qu" }, field: prob, format: probability, expect: 0.3195 }
  the_p: { read: prediction, args: { token: " the" }, field: prob, format: probability, expect: 0.0172 }
---

## Recall {id=s3-1 depth=optional outline=P2.2.md#3.1}

:::recall{id=recall-made-up}
Why this matters: the answer is a part of the model you can watch at work in this lesson.

```yaml
from: pry.p1-6
question: "Pry's model can't learn from your prompt. So how could it continue a made-up name it has only just seen?"
free: true
```
:::

## A made-up phrase, repeated {id=s3-2 outline=P2.2.md#3.2}

:::enter
prompt: "Pip ordered zebra lamps from Quorn. Pip ordered zebra lamps from"
:::

:::predict{id=pip-top checks=pip-obs}
What's the top next token?

Pip, zebra lamps and a shop called Quorn are all made up, and the sentence repeats itself. Pry's typed it in but hasn't run it yet, so you're guessing blind.

```yaml
choices:
  - { text: "\" the\"", feedback: "' Qu' got {qu}; ' the' got {the_p}. Lots of people expect a common word here. That's what you'd see if the model could only reproduce what it was trained on. It's unlikely GPT-2 memorized this phrase, so the answer had to come from earlier in this prompt." }
  - { text: "\" Qu\" (the start of \" Quorn\")", feedback: "That's what happened: ' Qu' got {qu}, and ' the' got {the_p}. The interesting part is how, since the model's weights can't have picked up Quorn from you." }
  - { text: "\" a\"", feedback: "' Qu' got {qu}; ' the' got {the_p}. Lots of people expect a common word here. That's what you'd see if the model could only reproduce what it was trained on. It's unlikely GPT-2 memorized this phrase, so the answer had to come from earlier in this prompt." }
  - { text: "something else", feedback: "' Qu' got {qu}; ' the' got {the_p}. Lots of people expect a common word here. That's what you'd see if the model could only reproduce what it was trained on. It's unlikely GPT-2 memorized this phrase, so the answer had to come from earlier in this prompt." }
```
:::

## The reveal {id=s3-3 outline=P2.2.md#3.3}

:::do{id=pip-run}
Run it and check :look{at=predictions-panel}[Predictions], then :look{at=token-strip}[the token strip]. Quorn isn't one token: it's ' Qu' followed by 'orn', so ' Qu' is the piece that'd have to come first.

```actions
- run: {}
```
:::

:::observe{id=pip-obs}
' Qu' comes out on top with {qu}. ' the' gets {the_p}. The model's continuing a name you made up a second ago, one it can't have been trained on.

```yaml
check: { read: top_guess.token, op: equals, value: " Qu" }
```
:::

:::question{id=evidence}
Where in the prompt is the evidence for ' Qu'?

```yaml
free: true
model_answer: "the token after the first ' from'."
```
:::

:::explain-result
The model's weights didn't change when you typed Quorn, and it's unlikely GPT-2 saw this exact sentence in training. So the push toward ' Qu' had to come from inside this prompt: the first time round, ' from' was followed by ' Qu'.

```yaml
supports: "' Qu' leads at the second ' from', and the only place ' Qu' follows ' from' is earlier in this same prompt."
leaves_open: "Predictions show what came out, not which parts of the model brought ' Qu' forward."
tool: predictions
skeptic: { says: "A skeptic would say ' Qu' is just a common start for shop names, and the repeat has nothing to do with it.", check: "Change the repeat later in this lesson and see whether ' Qu' still leads." }
```
:::

## The copying recipe {id=s3-4 outline=P2.2.md#3.4}

:::explain
Here's a recipe that'd produce ' Qu'. At a token that's appeared before, look back to where it showed up last time, find the token that came right after it, and copy that forward. At the second ' from', that token's ' Qu'.

A head that does this, drawing at a repeated token from the token that came right after its earlier appearance and copying it forward, is called an **induction head**. It's one of the best-understood jobs a head does, worked out by researchers at Anthropic in 2021 and 2022. The button says "Copying heads"; the concept is induction heads.
:::

## The copying-heads view {id=s3-5 outline=P2.2.md#3.5}

:::slots
top_induction_heads: { read: head_scores.top, args: { n: 3 }, expect: [{ layer: 5, head: 5, induction: 0.9389 }, { layer: 7, head: 10, induction: 0.886 }, { layer: 6, head: 9, induction: 0.8556 }] }
:::

:::do{id=copying-view}
Open :look{at=copying-heads-view}[the copying-heads view]. Pry feeds the model a run of random tokens, repeats it, and scores every head on how much it draws from "what came next last time". The best scorers get a ring. You're not looking at your prompt here; it's Pry's own test.

```actions
- open_panel: { panel: attention }
- show_copying_heads: { on: true }
```
:::

:::observe{id=ringed-layers}
Which layers hold the ringed heads? The top three scorers are {top_induction_heads}, all in the middle of the model.

The scores come from Pry's random repeated sequence, not from your prompt.

```yaml
check: { read: head_scores.top, args: { n: 3 }, op: contains, value: $row.15.top_induction_head_ref }
```
:::

## The partner head {id=s3-6 outline=P2.2.md#3.6}

:::do{id=second-ring}
The recipe has a hidden step. To copy "what came after ' from' last time", the token after the first ' from' needs a note in its residual stream saying ' from' came just before it. Another head writes that note. A head that mostly draws from the token just before is called a **previous-token head**. It's the induction head's usual partner, and :look{at=copying-heads-view}[the second ring style] marks these.

```actions
- highlight: { anchor: copying-heads-view }
```
:::

:::question{id=no-partner}
If no head ever drew from the token just before, could an induction head still find what came after ' from' last time?

```yaml
free: true
model_answer: "not this way, since the token after ' from' would have no note that ' from' preceded it."
```
:::

## Catch it on your prompt {id=s3-7 outline=P2.2.md#3.7}

:::slots
from_weight: { read: attention.weight, args: { layer: $row.15.top_induction_layer, head: $row.15.top_induction_head, from: $row.15.last_from_position, to: $row.15.qu_position }, format: probability, expect: 0.7523 }
:::

:::do{id=lines-on-pip}
Random tokens are one thing, and your sentence isn't random. Now check the top-scoring head on the Pip sentence: Pry's showing its lines from the last ' from'.

```actions
- show_copying_heads: { on: false }
- ensure_run: { prompt: "Pip ordered zebra lamps from Quorn. Pip ordered zebra lamps from" }
- set_attention_view: { view: lines }
- focus_token: { text: " from", occurrence: last }
- set_lines_head: { layer: $row.15.top_induction_layer, head: $row.15.top_induction_head }
```
:::

:::observe{id=head-to-qu}
Its heaviest line from the last ' from' goes to ' Qu', the token right after the first ' from', with {from_weight} of its mix. The same head that scored well on random tokens does the same move on your sentence.

```yaml
check: { read: attention.top_source, args: { layer: $row.15.top_induction_layer, head: $row.15.top_induction_head, from: $row.15.last_from_position }, op: contains, value: { token: " Qu" } }
```
:::

:::question{id=both-have}
Random tokens and a made-up shop name: what do both have that the head uses?

```yaml
free: true
model_answer: "A repeat."
```
:::

## One job, one test {id=s3-8 outline=P2.2.md#3.8}

:::explain-result
You caught a head doing a job: on a repeat, it draws from what came next last time. Look back at :look{at=copying-heads-view}[the copying-heads view] and keep in mind it ran one test, on one kind of input.

:refutes{target=T5}[It's one test, and it doesn't show everything the head does.]

```yaml
supports: "The copying score shows a head draws from 'what came next last time' on random repeated tokens. It's one test, and it doesn't show everything the head does."
leaves_open: "A high score says the head does this on a repeat. It doesn't say the head does only this, and it doesn't say ' Qu' depended on it here."
tool: attention
skeptic: { says: "A skeptic would say other heads could supply ' Qu' without these.", check: "Check now: change one word in the repeat and see if ' Qu' survives; check properly later, when you switch heads off." }
```
:::

::::fold{title="The name for picking things up from the prompt"}

:::explain
Picking up a pattern from earlier in the prompt, with no change to the weights, is called **in-context learning**. It answers the recall question: the model can't learn from you, but inside one prompt, heads like these can carry a repeat forward.
:::

::::

## Transfer {id=s5 outline=P2.2.md#5}

:::slots
qu_before: { row: "15.qu_prob", format: probability }
qu: { read: prediction, args: { token: " Qu" }, field: prob, format: probability, expect: 0.1158 }
the_p: { read: prediction, args: { token: " the" }, field: prob, format: probability, expect: 0.0169 }
:::

::::transfer{id=yellow}
```yaml
prompt: "Pip ordered zebra lamps from Quorn. Pip ordered yellow lamps from"
expect_if_explanation_holds: "The token right before the second ' from' still repeats, so an induction head can still find ' Qu', and ' Qu' should stay on top, though the changed word may cost it some probability."
limits: "this shows the copy survives one change, not which heads did it."
```

:::predict{id=qu-stays checks=yellow-obs}
One word in the repeat changed. Does ' Qu' stay top? Higher or lower than {qu_before}?

```yaml
free: true
```
:::

:::do{id=yellow-run}
Run the sentence with ' yellow' in place of the second ' zebra'.

```actions
- set_prompt: { text: "Pip ordered zebra lamps from Quorn. Pip ordered yellow lamps from" }
- run: {}
```
:::

:::observe{id=yellow-obs}
' Qu' stays on top with {qu}, down from {qu_before}. ' the' gets {the_p}.

```yaml
check: { read: top_guess.token, op: equals, value: " Qu" }
```
:::

::::

:::explain-result
The copy still works, since ' from' itself still repeats and still had ' Qu' after it the first time round. Less of the probability goes to ' Qu', though, so the changed word made a difference somewhere, and this view can't say where.

```yaml
supports: "' Qu' stays top after one word in the repeat changes, and its probability drops from the first run to this one."
leaves_open: "Predictions show the copy survived and got weaker. They don't show which heads carried it or why the changed word cost it probability."
limits: "this shows the copy survives one change, not which heads did it."
tool: predictions
skeptic: { says: "A skeptic would say the drop shows the induction heads weren't involved at all.", check: "Open the copying-heads view's top head again on this sentence and look at its line from the last ' from'." }
```
:::

## Explain the chain {id=s6 outline=P2.2.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: how could GPT-2 continue 'Quorn' when it can't learn from your prompt?"
model_answer: "The weights don't change; at the second ' from', an induction head draws from the token that came after the first ' from' (' Qu') and copies it into the last token's residual stream; a previous-token head made that lookup possible; the copying score is one test on random tokens, so it shows the head can do this, not that it's all it does or that ' Qu' depended on it."
```
:::
