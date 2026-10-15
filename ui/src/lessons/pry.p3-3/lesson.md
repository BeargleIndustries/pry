---
format: 1
id: pry.p3-3
title: "Which part carries the difference?"
tool: pry
summary: "Copy one slice of one run into another, read three logits, and find where the difference between two prompts travels."
minutes: 12
stage: 3
targets: [T6]
spine: [residual-stream, logits]
new_terms: [activation patching, clean run, corrupted run]
prerequisites: [pry.p3-1, pry.p3-2, pry.p2-1]
cold_entry: "Four things from before. Each token has its own residual stream, a list of numbers every layer reads and adds to (P1.3). A logit is a token's raw score before the scores turn into probabilities (P1.4). Attention only reaches back: a token draws from itself and the tokens before it, never after (P2.1). And ablation switches a part off for one run to see whether the answer changes (P3.2)."
model: gpt2-small
baseline: { prompt: "When Mary and John went to the store, John gave a drink to" }
verified_rows: [14, 27, 32, 59, 60]
limits: "A bright cell shows that copying that slice moves ' Mary''s logit back toward the clean run, on this pair. It doesn't show that the slice is the mechanism, so treat it as a strong suspect."
slots:
  clean: { read: patch.cell, args: { layer: $row.27.peak_layer, position: $row.27.peak_position }, field: clean, format: logit, expect: 18.466388702392578, tolerance: 0.05 }
  corrupted: { read: patch.cell, args: { layer: $row.27.peak_layer, position: $row.27.peak_position }, field: corrupted, format: logit, expect: 14.966815948486328, tolerance: 0.05 }
  patched: { read: patch.cell, args: { layer: $row.27.peak_layer, position: $row.27.peak_position }, field: patched, format: logit, expect: 18.474945068359375, tolerance: 0.05 }
  share: { from: [clean, corrupted, patched], formula: share, format: probability }
  peak_layer: { row: "27.peak_layer", format: layer }
  word: { row: "27.peak_word", format: string }
---

## Recall {id=s3-1 depth=optional outline=P3.3.md#3.1}

:::recall{id=recall-compare}
Why this matters: this lesson's tool narrows a change in the answer down to one layer at one token.

```yaml
from: pry.p3-1
question: "Compare showed ' Mary' fall when the second name changed. What couldn't it tell you?"
free: true
```
:::

## Activation patching {id=s3-2 outline=P3.3.md#3.2}

:::do{id=swap-tab}
In P3.2 you zeroed a part. This time you'll copy one instead. Run two prompts that differ by one name. Copy one part's activations from the first run into the second, then see where the answer ends up. That's called **activation patching**, and papers that trace how a model does a task keep coming back to it. Pry's "Swap test" tab does it. Press **Do it** to open :look{at=patching-panel}[the Swap test].

```actions
- open_panel: { panel: patching }
```
:::

:::analogy
```yaml
like: "two machines that behave differently; swap one part at a time between them to see which part makes the difference"
because: "If moving one part from the first machine into the second makes the second behave like the first, that part's a good suspect for the difference."
breaks: "the parts aren't separate modules, and a head or MLP swap in Pry covers every token at once."
```
:::

## Clean run and corrupted run {id=s3-3 outline=P3.3.md#3.3}

:::do{id=patch-resid}
Researchers call the run on the first prompt the **clean run** and the run on the second the **corrupted run**. Nothing's broken: "corrupted" just means changed. Papers say clean and corrupted, and Pry's boxes say "Original prompt" and "Changed prompt". The Original prompt here is P3.1's Mary and John sentence, and the Changed prompt swaps the second ' John' for ' Mary'. Press **Do it** to run the Swap test, then find :look{at=patch-three-logits}[the three logits].

```actions
- run_patching: { clean: "When Mary and John went to the store, John gave a drink to", corrupted: "When Mary and John went to the store, Mary gave a drink to", type: resid }
```
:::

:::explain
Start with two of them. In the clean run, ' Mary' gets a logit of {clean}. In the corrupted run it's {corrupted}. They're logits, not probabilities. The logit's the score before the scores turn into probabilities, and it's the better ruler for a swap: one token's logit doesn't shift just because other tokens' scores did.
:::

## Which word and which layer? {id=s3-4 outline=P3.3.md#3.4}

:::predict{id=where-back checks=peak-obs}
Copy one layer's residual stream, at one word, from the clean run into the corrupted run. Where will ' Mary''s logit come back most?

```yaml
choices:
  - { text: "at the swapped name, at every layer", target: T6 }
  - { text: "at the swapped name early, then at the last word ' to' in later layers" }
  - { text: "at ' to' only" }
  - { text: "everywhere about equally" }
hides: [patching-grid]
```
:::

## Three logits first, colours second {id=s3-5 outline=P3.3.md#3.5}

:::do{id=peak-cell}
Each cell in :look{at=patching-grid}[the grid] is one layer at one word. Press **Do it** to select the brightest one, then read :look{at=patch-three-logits}[the three logits] before you look at its colour.

```actions
- focus_patch_cell: { layer: $row.27.peak_layer, position: $row.27.peak_position }
```
:::

:::observe{id=peak-obs}
All three are the logit for ' Mary' at the last token. Clean: {clean}. Corrupted: {corrupted}. Copy layer {peak_layer}'s residual stream at ' {word}' into the corrupted run, and it becomes {patched}, {share} of the way from {corrupted} back to {clean}.

Formula on screen: ({patched} - {corrupted}) / ({clean} - {corrupted}).

A share can come out a hair over the whole way back. That just means the patched logit overshot the clean one. A share below zero would mean the copy pushed ' Mary' further away, and you'll meet one of those in P3.6. Now run your eye along the grid's rows: the bright cells sit at the swapped name in the early layers and move to ' to' in the later ones.

```yaml
check: { read: patch.peak, args: { type: resid }, op: contains, value: { layer: $row.27.peak_layer } }
```
:::

## The control column {id=s3-6 outline=P3.3.md#3.6}

:::predict{id=store-column checks=store-obs}
Copy the residual stream at ' store', which comes before the swapped name. What happens to ' Mary''s logit?

```yaml
choices:
  - { text: "some of it comes back" }
  - { text: "none" }
```
:::

:::do{id=store-cell}
Press **Do it** to select the ' store' column in :look{at=patching-grid}[the grid], at the same layer.

```actions
- focus_patch_cell: { layer: $row.27.peak_layer, position: $row.14.store_position }
```
:::

:::observe{id=store-obs}
The patched logit equals the corrupted one, so the share's zero. It isn't just this layer, either: every cell in the ' store' column reads the same. Didn't expect nothing at all? Lots of people don't.

```yaml
check: { read: patch.cell, args: { layer: $row.27.peak_layer, position: $row.14.store_position }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
```
:::

:::question{id=why-nothing}
Why exactly nothing?

```yaml
free: true
model_answer: "Attention only draws from a token and earlier ones, so ' store''s residual stream is identical in both runs; copying it changes nothing. Every token after the swapped name differs."
```
:::

## What the grid shows {id=s3-7 outline=P3.3.md#3.7}

:::explain-result
The first choice is the one lots of people pick, and it's a fair guess, since the name's the only word you changed. The grid rules it out. The difference shows up at the name in the early layers and at the last word in the later ones. That fits heads carrying information from the name's residual stream over to the last token's, where the answer gets read off.

A pale cell needs care too. It means copying that one slice alone moved the logit little. When two slices carry the same information, copying either one alone can look small.

```yaml
supports: "A bright cell shows that copying that slice moves ' Mary''s logit a long way back toward the clean run, on this pair. It doesn't show that the slice is the mechanism, so treat it as a strong suspect."
leaves_open: "Each cell is one slice copied alone, measured on one logit, for one pair of prompts. It can't show parts that only matter together, and it doesn't say what information the slice carries."
tool: patching
skeptic: { says: "A skeptic would say these cells light up because of this one pair of names.", check: "Here's the check: run a different pair of names and see whether the same layers and words light up." }
```
:::

## Heads, one at a time {id=s3-8 outline=P3.3.md#3.8}

:::slots
top_head_layer: { read: patch.peak, args: { type: head }, field: layer, format: layer, expect: 8 }
top_head: { read: patch.peak, args: { type: head }, field: position, format: count, expect: 10 }
head_clean: { read: patch.peak, args: { type: head }, field: clean, format: logit, expect: 18.466388702392578, tolerance: 0.05 }
head_corrupted: { read: patch.peak, args: { type: head }, field: corrupted, format: logit, expect: 14.966815948486328, tolerance: 0.05 }
head_patched: { read: patch.peak, args: { type: head }, field: patched, format: logit, expect: 16.252490997314453, tolerance: 0.05 }
:::

:::do{id=patch-heads}
Now swap heads instead of the residual stream. A head swap covers every token at once, so this grid has a cell per head, not per word. Press **Do it** to run it and open :look{at=patching-grid}[the head grid].

```actions
- run_patching: { clean: "When Mary and John went to the store, John gave a drink to", corrupted: "When Mary and John went to the store, Mary gave a drink to", type: head }
- set_patch_view: { type: head }
```
:::

:::task{id=find-head}
Find the head whose swap moves ' Mary''s logit furthest back toward the clean value. Click cells and read each one's three logits before you trust its colour. You've found it when the selected cell is the one with the biggest share.

```yaml
target:
  - { read: patch.focused, op: equals, value: $read.patch.peak, value_args: { type: head } }
learner_actions: [focus_patch_cell]
reset: { prompt: "When Mary and John went to the store, John gave a drink to", patching: { clean: "When Mary and John went to the store, John gave a drink to", corrupted: "When Mary and John went to the store, Mary gave a drink to", type: resid } }
```
:::

:::question{id=name-mover}
Is it one of the name movers from P3.2?

```yaml
choices:
  - { text: "yes" }
  - { text: "no" }
model_answer: "No. The top head is layer {top_head_layer}, head {top_head}: clean {head_clean}, corrupted {head_corrupted}, patched {head_patched}. It sits in layers `L8` to `L9`, right where the name movers are, and `L9H9`, one of P3.2's name movers, comes second. So the difference runs through more heads than the three you knocked out."
```
:::

## Transfer {id=s5 outline=P3.3.md#5}

::::transfer{id=tom-sarah}
```yaml
prompt: "When Tom and Sarah went to the park, Sarah gave a ball to"
expect_if_explanation_holds: "If the grid's pattern comes from the sentence's shape and not these two names, the bright cells sit at the second name early and at ' to' late, for ' Tom' this time."
limits: "Two pairs of names in one sentence shape. A matching pattern makes the suspects stronger, and it still doesn't show what the heads carry."
```

:::predict{id=same-cells checks=tom-obs}
Will the bright cells sit at the same layers and the same position (the second name, then the last word)?

```yaml
free: true
```
:::

:::do{id=patch-tom}
Press **Do it** to run the Swap test on the Tom and Sarah pair. The Changed prompt swaps the second ' Sarah' for ' Tom', and both prompts have the same number of tokens as Mary and John's.

```actions
- run_patching: { clean: "When Tom and Sarah went to the park, Sarah gave a ball to", corrupted: "When Tom and Sarah went to the park, Tom gave a ball to", type: resid }
```
:::

:::observe{id=tom-obs}
Look along the rows the way you did before. Where are the bright cells in the early layers, and where do they move to? Write down what you see.

```yaml
journal: true
```
:::

::::

:::question{id=same-shape}
If the same layers light up for different names, what's the same about the two sentences?

```yaml
free: true
model_answer: "Their shape: two names, one repeated, the answer is the other."
```
:::

## Explain the chain {id=s6 outline=P3.3.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what does the Swap test do, what do the three numbers in a cell mean, and why did copying ' store' change nothing?"
model_answer: "Two prompts differ by one name; copy one slice from the clean run into the corrupted run; read ' Mary''s logit clean, corrupted and patched, and where patched lands between them; ' store' comes before the change, so its residual stream is the same in both runs; the bright cells are suspects on one pair, checked by a second pair."
```
:::
