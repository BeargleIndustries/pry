---
format: 1
id: pry.p2-4
title: "Which parts pushed toward the answer?"
tool: pry
summary: "Split a logit back into each part's own push, read the bars' total against the real number, and see what the bars can't show."
minutes: 12
stage: 2
targets: [N2, T6]
spine: [residual-stream, logits]
new_terms: [MLP, direct logit attribution, logit difference]
prerequisites: [pry.p1-4, pry.p2-1, pry.p2-3]
cold_entry: "Every layer adds to each token's residual stream, and at the top the unembedding turns the last token's residual stream into a logit for every token. A layer has two halves: attention, split into heads that mix in information from earlier tokens, and another half that works on each token alone. The logit lens reads any layer with the unembedding."
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 14, 17, 22, 51, 52]
limits: "Each bar is one part's direct push on the logit. Only direct pushes count, so treat the tall bars as suspects."
slots:
  top_parts: { read: dla.top_parts, args: { n: 3 }, expect: [{ part: "MLP.9", contribution: 1.8497 }, { part: "MLP.10", contribution: 1.778 }, { part: "L11.H3", contribution: 1.7494 }] }
  bars_total: { read: dla.bars_total, expect: 14.799 }
  actual_logit: { read: dla.actual, expect: 15.962 }
  gap: { read: dla.gap, expect: 1.163 }
  x: { row: "22.push_threshold", format: logit }
  n: { read: dla.parts_above, args: { threshold: $row.22.push_threshold }, expect: 2 }
  k: { row: "22.top_mlp_layer", format: count }
---

## Recall {id=s3-1 depth=optional outline=P2.4.md#3.1}

:::recall{id=recall-qu}
Why this matters: this lesson's tool splits a logit into each part's own push, which is that measurement.

```yaml
from: pry.p2-2
question: "An induction head copied ' Qu' forward. How could you measure how much one head raised ' Qu''s logit?"
free: true
```
:::

## The other half gets its name {id=s3-2 outline=P2.4.md#3.2}

:::explain{id=layer-halves}
In P2.1 you met attention, the half of each layer that mixes information between tokens. The other half got a description and no name. It works on each token's residual stream on its own, with no mixing between tokens, and plenty of what the model reproduces about the world seems to be stored in these halves, spread over several layers.

The half of each layer that works on each token's residual stream alone is called the **MLP**. The bars in this lesson's tool list MLPs by layer, so you'll be reading the name on screen in a minute.

```yaml
image: images/layer-attention-mlp.svg
alt: "One layer drawn as an attention half and an MLP half. Both halves read the residual stream and add their output back into it. Attention has arrows between tokens; the MLP works on each token separately."
```
:::

:::analogy
```yaml
like: "communicate, then compute: attention passes information between tokens, the MLP works on what each token has"
because: "It's a handy way to keep the two halves apart: one moves things around, the other works on what's already there."
breaks: "both halves add to the same residual stream, and the split isn't clean."
```
:::

## Split the logit back into its parts {id=s3-3 outline=P2.4.md#3.3}

:::explain
' basketball''s logit comes from what every head and every MLP added to the last token's residual stream. Take each of those additions on its own, measure it straight to that logit, and you get each part's own push toward ' basketball', or against it.

Splitting a logit into each part's own push toward or against a token is called **direct logit attribution**, or **DLA**. Papers use the name, and it's on :look{at=left-tab-strip}[Pry's "Why (DLA)" tab], which is direct logit attribution under a friendlier label. You'll open it in the next section; first, **Do it** below loads the prompt. "Direct" means each bar is one part's own push, measured straight to the logit.
:::

:::analogy
```yaml
like: "a push; credit and blame"
because: "Each bar hands out credit, or blame, to one part for how far it shoved the logit."
breaks: "a push is measured straight to the logit; help through later parts lands in their bars."
```
:::

:::do{id=jordan-ensure}
Pry loads the Jordan prompt again. You know the ending: ' basketball' on top.

```actions
- set_prompt: { text: "Michael Jordan played the sport of" }
- ensure_run: { prompt: "Michael Jordan played the sport of" }
```
:::

## Predict {id=s3-4 outline=P2.4.md#3.4}

:::predict{id=bars-shape checks=bars-obs}
What will the bars for ' basketball' look like?

```yaml
choices:
  - { text: "one part towers over the rest", target: N2, feedback: "Lots of people expect that, because facts feel like they live somewhere. The bars come up in the next section." }
  - { text: "a handful of parts, heads and MLPs mixed" }
  - { text: "every part about equal" }
  - { text: "something else" }
remember: bars-pick
```
:::

:::question{id=remove-biggest}
If you removed the single biggest bar's push, would ' basketball' still have pushes toward it?

```yaml
choices:
  - { text: "yes" }
  - { text: "no", feedback: "Other bars push toward ' basketball' too, so taking away one push leaves the rest standing." }
model_answer: "Yes; others remain."
```
:::

## The bars {id=s3-5 outline=P2.4.md#3.5}

:::do{id=dla-jordan}
Pry runs DLA on ' basketball' at the last token, ' of'. Look at :look{at=dla-waterfall}[the top three bars], then :look{at=dla-total-line}[the total line] underneath.

```actions
- open_panel: { panel: dla }
- focus_token: { text: " of", occurrence: last }
- run_dla: { answer: " basketball" }
```
:::

:::observe{id=bars-obs}
You picked :earlier{key="pry.p2-4.bars-pick"}[nothing]. In :look{at=dla-waterfall}[the bars], {n} parts push harder than {x}, heads and MLPs both, with MLP.{k} among them. The three biggest pushes are {top_parts}. Each number is a push in logits, so a bar of one means that part on its own raised ' basketball''s logit by one.

```yaml
check: { read: dla.bars_total, op: gt, value: 0, expect: 14.799 }
```
:::

:::explain-result
Several parts push hard, and MLPs show up among the biggest. There's no single home here; there's a crowd.

```yaml
supports: "Several bars carry large pushes toward ' basketball', and MLPs appear among the top. Only direct pushes count. Help through other parts isn't counted. The bar for a part shows the push that part made most directly."
leaves_open: "The bars show each part's own push on the final logit. They don't show what any part read from the residual stream to make its push."
tool: dla
skeptic: { says: "A skeptic would say the tallest MLP bar is where the Jordan fact is stored.", check: "Keep reading: two sections on, you'll see what a bar can and can't say about where information came from." }
```
:::

## The total, the real logit and the gap {id=s3-6 outline=P2.4.md#3.6}

:::do{id=total-line}
Look at :look{at=dla-total-line}[the total line]: the bars added up, the real logit, and what's left between them.

```actions
- highlight: { anchor: dla-waterfall }
```
:::

:::explain-result
The bars for ' basketball' total {bars_total}. The real logit is {actual_logit}. The {gap} left over is the embedding's own direct push plus a few fixed numbers the model adds on every run, which Pry doesn't draw as bars.

The gap isn't help that went missing. If a part helped by feeding a later part, that help's already inside the later part's bar.

```yaml
supports: "The bars' total sits next to the real logit, and the gap has a known source. Only direct pushes count, so read each bar as the part that pushed most directly."
leaves_open: "The total line shows how close the bars come to the real logit. It doesn't split the gap itself into the embedding's push and the fixed numbers."
tool: dla
skeptic: { says: "A skeptic would say the gap is where the model's hidden teamwork lives.", check: "Compare the gap with the bars' total: teamwork through later parts is already in their bars, and the gap is the embedding plus fixed numbers." }
assert:
  - require: { slot: gap, op: lt, slot2: bars_total, abs: true }
    say: "That's a small leftover."
    else: "Here the bars total {bars_total} and the real logit is {actual_logit}, so read both before trusting either."
```
:::

::::fold{title="The fixed numbers"}

:::explain
The "few fixed numbers the model adds on every run" are called **biases**: one added after each attention half and one in the unembedding. They don't depend on your prompt, so they push the same way every time.
:::

::::

## A big push isn't where the fact lives {id=s3-7 outline=P2.4.md#3.7}

:::explain-result
An MLP with a big bar pushed ' basketball' directly. To make that push it read the residual stream at ' of', which already held whatever attention had mixed in from ' Jordan' a few layers down. Other MLPs pushed too.

:refutes[Lots of people expect one home for a fact. The bars show several parts pushing, and DLA can't say where the information came from before each push.]

```yaml
supports: "A tall MLP bar is a direct push, built from whatever was in the residual stream when it ran. Help through other parts isn't counted."
leaves_open: "DLA credits the part that made the final push. It doesn't show which earlier parts put the information there for it to use."
tool: dla
skeptic: { says: "A skeptic would say that if one MLP has the biggest bar, the Jordan fact must live in it.", check: "A later case study traces this same fact with tools that switch parts off and swap them; hold the question till then." }
```
:::

:::question{id=whose-bar}
An early head mixes ' Jordan' into the last token, and a later MLP turns that into a push for ' basketball'. Whose bar shows the push?

```yaml
choices:
  - { text: "the head's", feedback: "The head only gets credit for its own direct push. The push toward ' basketball' came out of the MLP, so it's in the MLP's bar." }
  - { text: "the MLP's" }
model_answer: "The MLP's; the head gets credit only for its own direct push."
```
:::

## A fair question compares two tokens {id=s3-8 outline=P2.4.md#3.8}

:::enter
open_panel: predictions
:::

:::slots
mary: { read: prediction, args: { token: " Mary" }, field: prob, format: probability, expect: 0.677 }
john: { read: prediction, args: { token: " John" }, field: prob, format: probability, expect: 0.0235 }
ratio: { from: [mary, john], formula: ratio, format: number }
actual_diff: { from: [ratio], formula: ln, format: logit }
:::

:::do{id=ioi-ensure}
Back to the Mary and John prompt from P2.1. Check :look{at=predictions-panel}[Predictions].

```actions
- set_prompt: { text: "When Mary and John went to the store, John gave a drink to" }
- ensure_run: { prompt: "When Mary and John went to the store, John gave a drink to" }
```
:::

:::explain
A part can raise every name's logit at once. That wouldn't help ' Mary' beat ' John' at all. So the fair question compares the two: ' Mary' {mary}, ' John' {john}, so ' Mary' is about {ratio} times as likely, a logit difference of about {actual_diff} (ln {ratio}).

One token's logit minus another's, how much more the model scores ' Mary' than ' John', is called the **logit difference**. The lessons where you poke at the model measure with it, and it's what DLA works out when you give it a contrast token.
:::

::::fold{title="The name of this task"}

:::explain
Researchers call this sentence's puzzle, working out who receives the drink, indirect object identification, or IOI. It's one of the best-studied tasks in GPT-2 small, which is why it keeps coming back in these lessons.
:::

::::

## Mary minus John {id=s3-9 outline=P2.4.md#3.9}

:::slots
top_parts: { read: dla.top_parts, args: { n: 3 }, expect: [{ part: "L10.H7", contribution: -2.2792 }, { part: "L9.H6", contribution: 2.1079 }, { part: "L9.H9", contribution: 2.0957 }] }
bars_total: { read: dla.bars_total, expect: 4.564 }
actual_logit: { read: dla.actual, expect: 3.362 }
gap: { read: dla.gap, expect: -1.203 }
:::

:::predict{id=which-layers checks=mary-john-obs}
Which layers push ' Mary' over ' John' hardest?

```yaml
choices:
  - { text: "L0-L2" }
  - { text: "L3-L5" }
  - { text: "L6-L8" }
  - { text: "L9-L11" }
  - { text: "spread evenly" }
```
:::

:::do{id=dla-mary-john}
Pry runs DLA on ' Mary' with ' John' as the contrast, at the last ' to'. Read :look{at=dla-waterfall}[the bars], then the total line yourself.

```actions
- focus_token: { text: " to", occurrence: last }
- run_dla: { answer: " Mary", contrast: " John" }
```
:::

:::observe{id=mary-john-obs}
The three biggest bars by size are {top_parts}, all heads in the last few layers. Read the signs: two push ' Mary' over ' John', and one pushes the other way, against ' Mary'. Parts don't all pull the same way. The bars total {bars_total}, the real logit difference is {actual_logit}, and the gap is {gap}.

```yaml
check: { read: dla.target, op: equals, value: { answer: " Mary", contrast: " John" } }
```
:::

:::question{id=gap-blank}
Fill in the blank from what you've learned: the gap is ___.

```yaml
free: true
model_answer: "The embedding's own direct push plus a few fixed numbers the model adds on every run. It isn't help through other parts, since that's already inside the later parts' bars."
```
:::

## What DLA can and can't show {id=s3-10 outline=P2.4.md#3.10}

:::slots
bars_total: { read: dla.bars_total, expect: 4.564 }
actual_logit: { read: dla.actual, expect: 3.362 }
:::

:::do{id=open-top-head}
Pry opens the head with the biggest push toward ' Mary' and shows its attention lines from ' to', the view from P2.1.

```actions
- open_head: { layer: $row.51.top_head_layer, head: $row.51.top_head }
```
:::

:::explain-result
DLA names the parts that pushed directly. A part that helped by changing what a later part did gets no bar for that help, so the bars aren't a full explanation, however close their total comes. Here, on :look{at=dla-total-line}[the total line], the bars total {bars_total} against a real logit difference of {actual_logit}.

:refutes{target=T6}[The bars come close to the real number, and they still don't say how the parts worked together.]

```yaml
supports: "Each bar is one part's direct push on the logit difference. Only direct pushes count, so treat the tall bars as suspects."
leaves_open: "Each bar is one part's own push. When a head helps by changing what a later part does, that help shows up in the later part's bar, not the head's."
tool: dla
skeptic: { says: "A skeptic would say the tallest head bar pushes ' Mary' only because it draws from ' Mary'.", check: "Check now: open that head's attention lines from ' to'. Check properly in P3.2: switch it off and watch the logit difference." }
```
:::

## Transfer {id=s5 outline=P2.4.md#5}

:::enter
prompt: "The nurse said that"
run: true
open_panel: dla
dla_target: { answer: " she" }
:::

:::slots
top_parts: { read: dla.top_parts, args: { n: 3 }, expect: [{ part: "L10.H9", contribution: 0.9301 }, { part: "L9.H7", contribution: 0.611 }, { part: "L9.H2", contribution: 0.3449 }] }
bars_total: { read: dla.bars_total, expect: 2.823 }
actual_logit: { read: dla.actual, expect: 2.12 }
gap: { read: dla.gap, expect: -0.703 }
he_p: { read: prediction, args: { token: " he" }, field: prob, format: probability, expect: 0.0228 }
:::

::::transfer{id=nurse-dla}
```yaml
prompt: "The nurse said that"
expect_if_explanation_holds: "Reading the bars the same way, you should find a few parts carrying the push, a total near the real logit difference, and a gap from the embedding and fixed numbers."
limits: "Each bar is one part's own push. When a head helps by changing what a later part does, that help shows up in the later part's bar, not the head's."
```

:::predict{id=she-he checks=she-he-obs}
Which kind of part pushes ' she' over ' he' hardest, heads or MLPs, and early or late?

```yaml
free: true
```
:::

:::task{id=pick-pair}
The nurse prompt is in and :look{at=dla-waterfall}[Why (DLA)] is open, explaining ' she' on its own. Pick the two tokens to compare in its Answer and Contrast menus, above the bars; the bars redraw on their own. Each has to be a single token; ' she' against ' he' is the pair to try first. Then press **Check my result**. Start over puts the nurse prompt back.

```yaml
target:
  - { read: dla.target, op: changed_from, value: $before.dla.target }
constraint:
  - { read: dla.target_token_count, args: { which: answer }, op: equals, value: 1, expect: learner }
  - { read: dla.target_token_count, args: { which: contrast }, op: equals, value: 1, expect: learner }
learner_actions: [run_dla]
reset: { prompt: "The nurse said that" }
```
:::

:::observe{id=she-he-obs}
The biggest pushes are {top_parts}. The bars total {bars_total}, the real logit difference is {actual_logit}, and the gap is {gap}, all three on :look{at=dla-total-line}[the total line] under the bars. For scale, ' he' gets {he_p} on this prompt, in :look{at=predictions-panel}[Predictions].

```yaml
journal: true
```
:::

::::

:::explain-result
Same reading routine on a new prompt: name the tall bars, then check their total against the real logit difference and the gap before you trust them.

```yaml
supports: "The tall bars are the parts that pushed ' she' over ' he' directly. Only direct pushes count."
leaves_open: "Each bar is one part's own push. When a head helps by changing what a later part does, that help shows up in the later part's bar, not the head's."
tool: dla
skeptic: { says: "A skeptic would say the tallest head on the nurse prompt is a 'she head' that does nothing else.", check: "Run it on `The doctor said that` with ' he' against ' she' and see whether the same head turns up." }
```
:::

## Explain the chain {id=s6 outline=P2.4.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what does a tall DLA bar for ' Mary' minus ' John' tell you, why don't the bars match the real logit difference exactly, and what can't the bars show?"
model_answer: "Every head and MLP adds to the last token's residual stream; DLA measures each addition straight to the logit difference; tall bars are direct pushes, so they're suspects; the bars total close to the real difference, and the gap is the embedding's own push plus a few fixed numbers, not missing help; a part that helps by changing a later part gets no bar of its own; switching parts off is the test."
```
:::
