---
format: 1
id: pry.p3-6
title: "Case study: where does a fact come from?"
tool: pry
summary: "Point three tools at one fact, read what each one shows and leaves over, and see why no single spot holds it."
minutes: 12
stage: 3
targets: [N2]
spine: [residual-stream, logits]
new_terms: []
prerequisites: [pry.p2-3, pry.p2-4, pry.p3-3]
cold_entry: "Three tools from before. Each layer has an MLP, the other half of the layer next to its attention heads, and DLA splits a logit into each part's direct push (P2.4). The logit lens reads what each layer would guess if the model stopped there (P2.3). And the Swap test gives three logits for every cell: clean, corrupted and patched, plus where the patched one lands between the other two (P3.3)."
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 18, 20, 34, 35, 66, 67]
limits: "Each tool narrows the suspects for where ' basketball' comes from. None of them finds a place where the fact is stored, so treat 'the fact is in layer N' as a claim none of these can make."
---

## Recall {id=s3-1 depth=optional outline=P3.6.md#3.1}

:::recall{id=recall-knockout}
Why this matters: this lesson points three tools at one sentence, and each one leaves something open like that.

```yaml
from: pry.p3-4
question: "A feature knockout changed nothing. What couldn't that rule out?"
free: true
```
:::

## The pair {id=s3-2 outline=P3.6.md#3.2}

:::slots
jordan_bb: { read: compare.prediction, args: { side: a, token: " basketball" }, field: prob, format: probability, expect: 0.42208388447761536, tolerance: 0.02 }
jordan_fb: { read: compare.prediction, args: { side: a, token: " football" }, field: prob, format: probability, expect: 0.0471893772482872, tolerance: 0.02 }
jordan_golf: { read: compare.prediction, args: { side: a, token: " golf" }, field: prob, format: probability, expect: 0.041473932564258575, tolerance: 0.02 }
brady_fb: { read: compare.prediction, args: { side: b, token: " football" }, field: prob, format: probability, expect: 0.4862939715385437, tolerance: 0.02 }
brady_bb: { read: compare.prediction, args: { side: b, token: " basketball" }, field: prob, format: probability, expect: 0.022681239992380142, tolerance: 0.02 }
:::

:::predict{id=pair-guess checks=pair-obs}
Start with a fact GPT-2 small gets right, so you're not chasing a mistake. Swap Michael Jordan for Tom Brady in "Michael Jordan played the sport of". What happens to ' basketball'?

```yaml
choices:
  - { text: "it stays on top" }
  - { text: "' football' takes over" }
  - { text: "both drop to almost nothing" }
```
:::

:::do{id=pair-compare}
Press **Do it** to run Michael Jordan beside Tom Brady, then read the A and B columns of :look{at=compare-panel}[Compare's Next-token guesses table].

```actions
- set_compare_mode: { on: true }
- set_compare: { a: "Michael Jordan played the sport of", b: "Tom Brady played the sport of" }
- run_compare: {}
```
:::

:::observe{id=pair-obs}
For Jordan, ' basketball' gets {jordan_bb}, well ahead of ' football' at {jordan_fb} and ' golf' at {jordan_golf}. For Brady it flips: ' football' gets {brady_fb} and ' basketball' gets {brady_bb}. Both prompts come out the same number of tokens long, so each position lines up with the same position in the other. That's what lets the Swap test copy one position across.

```yaml
check: { read: compare.token_count, args: { side: a }, op: equals, value: $read.compare.token_count, value_args: { side: b } }
```
:::

:::question{id=minimal-pair}
Is this a minimal pair?

```yaml
free: true
model_answer: "Close: two tokens differ, not one (Michael Jordan vs Tom Brady), with the same token count."
```
:::

## Which MLP? {id=s3-3 outline=P3.6.md#3.3}

:::enter
compare_mode: false
open_panel: patching
patching: { clean: "Michael Jordan played the sport of", corrupted: "Tom Brady played the sport of", type: mlp }
:::

:::predict{id=which-mlp checks=mlp-obs}
Swap one layer's MLP at a time from the Jordan run into the Brady run, measuring ' basketball''s logit. Which layer's bar will be biggest? (Pry labels layers `L0` to `L11`.)

```yaml
choices:
  - { text: "one middle layer (where the fact is stored)", target: N2 }
  - { text: "L0" }
  - { text: "the last layer, L11" }
  - { text: "several about equally" }
```
:::

## MLP swaps {id=s3-4 outline=P3.6.md#3.4}

:::slots
clean: { read: patch.peak, args: { type: mlp }, field: clean, format: logit, expect: 15.96245288848877, tolerance: 0.05 }
corrupted: { read: patch.peak, args: { type: mlp }, field: corrupted, format: logit, expect: 13.080302238464355, tolerance: 0.05 }
patched_l: { read: patch.peak, args: { type: mlp }, field: patched, format: logit, expect: 15.456536293029785, tolerance: 0.05 }
share: { from: [clean, corrupted, patched_l], formula: share, format: probability }
l2_patched: { read: patch.cell, args: { layer: 2, position: 0 }, field: patched, format: logit, expect: 14.2425, tolerance: 0.05 }
l11_patched: { read: patch.cell, args: { layer: 11, position: 0 }, field: patched, format: logit, expect: 11.9707, tolerance: 0.05 }
l2_share: { from: [clean, corrupted, l2_patched], formula: share, format: probability }
l11_share: { from: [clean, corrupted, l11_patched], formula: share, format: probability }
:::

:::do{id=mlp-swaps}
Press **Do it** to run the Swap test on MLPs, Jordan as the Original prompt and Brady as the Changed one. Find :look{at=patching-grid}[the biggest bar], then read :look{at=patch-three-logits}[its three logits].

```actions
- open_panel: { panel: patching }
- run_patching: { clean: "Michael Jordan played the sport of", corrupted: "Tom Brady played the sport of", type: mlp }
- set_patch_view: { type: mlp }
```
:::

:::observe{id=mlp-obs}
All three are ' basketball''s logit at the last token, and you've read numbers like these before. Clean: {clean}. Corrupted: {corrupted}. Swap in the Jordan run's MLP at the biggest bar and it becomes {patched_l}, {share} of the way back. Two more bars to read: swapping `L2`'s MLP gives {l2_patched}, {l2_share} of the way back, and swapping `L11`'s gives {l11_patched}, {l11_share}, below zero, so swapping it pushes ' basketball' the other way.

```yaml
check: { read: patch.peak, args: { type: mlp }, op: contains, value: { layer: 0 } }
assert:
  - require: { slot: share, op: gt, value: 0.8 }
    say: "`L0` wins by a mile."
    else: "`L0` leads."
  - require: { slot: l2_share, op: gt, value: 0.3 }
    say: "`L2` brings back a good chunk."
    else: "`L2` brings back some."
```
:::

## Why L0 {id=s3-5 outline=P3.6.md#3.5}

:::explain-result
Lots of people pick a middle layer, and it's a fair guess: Meng and colleagues found middle MLPs mattered for facts like this, in bigger models. Here's what rules it out on this run. Pry's MLP swap covers every token at once, and the `L0` MLP acts more or less like part of the embedding. Swapping it puts "Michael Jordan" back into the sentence. That doesn't mean the fact lives in `L0`. Meng's group restored one spot at a time, at the last token of the name, and that's a different experiment.

A pale middle bar doesn't settle anything either. It doesn't show that MLP is unused: several layers can share a job, and swapping one alone moves little, the way it did with heads in P3.3.

```yaml
supports: "The MLP swap shows which layer's MLP, copied at every token, moves ' basketball''s logit back toward the Jordan run. A big `L0` bar fits the name coming back, not a stored fact."
leaves_open: "Each bar copies one MLP at every token at once, so it can't say which token mattered, and it can't show layers that only matter together."
tool: patching
skeptic: { says: "A skeptic would say the `L0` bar is just the name being swapped back in, so it tells you nothing about the fact.", check: "Here's the check: copy the residual stream one token at a time and see where the effect sits in the later layers." }
```
:::

## One token at a time {id=s3-6 outline=P3.6.md#3.6}

:::predict{id=resid-where checks=resid-obs}
Now copy the residual stream at one token, one layer at a time. Where will ' basketball' come back?

```yaml
choices:
  - { text: "at ' Jordan' in every layer" }
  - { text: "at ' Jordan' early, at ' of' late" }
  - { text: "at ' of' only" }
```
:::

:::do{id=resid-swaps}
Press **Do it** to switch the Swap test to the residual stream. Look at :look{at=patching-grid}[the ' Jordan' column, then the ' of' column].

```actions
- run_patching: { clean: "Michael Jordan played the sport of", corrupted: "Tom Brady played the sport of", type: resid }
- set_patch_view: { type: resid }
```
:::

:::observe{id=resid-obs}
' basketball' comes back at ' Jordan' through the early and middle layers, and at ' of' in the last ones. The start-of-text marker column, which comes before both names, stays at zero all the way up, just like ' store' did in P3.3. Nothing before the change can differ between the two runs, so there's nothing there to copy.

```yaml
check:
  - { read: patch.cell, args: { layer: 0, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 1, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 2, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 3, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 4, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 5, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 6, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 7, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 8, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 9, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 10, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
  - { read: patch.cell, args: { layer: 11, position: 0 }, field: share, op: within, value: 0, tolerance: 0.0001, expect: 0 }
```
:::

## DLA with a contrast {id=s3-7 outline=P3.6.md#3.7}

:::slots
bars: { read: dla.bars_total, expect: 3.119221771368757, tolerance: 0.05 }
actual: { read: dla.actual, expect: 2.191035270690918, tolerance: 0.05 }
gap: { read: dla.gap, expect: -0.9281865006778389, tolerance: 0.05 }
:::

:::do{id=dla-contrast}
Now a different question: which parts push ' basketball' over ' football' directly, at the very end? Press **Do it** to leave Compare, open Why (DLA) on the Jordan prompt and split the logit difference.

```actions
- set_compare_mode: { on: false }
- ensure_run: { prompt: "Michael Jordan played the sport of" }
- open_panel: { panel: dla }
- run_dla: { answer: " basketball", contrast: " football" }
```
:::

:::observe{id=dla-obs}
On :look{at=dla-total-line}[the total line], the bars for ' basketball' minus ' football' total {bars}. The real logit difference is {actual}. The {gap} left over is the embedding's own direct push plus a few fixed numbers the model adds on every run.

Here the gap's below zero: the bars add up to more than the real difference, so that leftover pushes the other way. Among the biggest bars you'll find heads and an MLP.

```yaml
check: { read: dla.target, op: equals, value: { answer: " basketball", contrast: " football" } }
```
:::

:::explain-result
DLA splits the logit difference at the last token into each part's own push. MLPs show up among the biggest pushes here, next to a couple of late heads. It's a different question from the Swap test's, so don't expect the same answer.

```yaml
supports: "DLA shows which parts push ' basketball' over ' football' at the last token, each bar its own push. Only direct pushes count."
leaves_open: "A part that helps by changing what a later part does gets no credit in its own bar, so DLA can't show the early steps that carry Jordan's name to the end."
tool: dla
skeptic: { says: "A skeptic would say the biggest bars are just the parts closest to the output, so of course they push hardest.", check: "Here's the check: compare them with the Swap test, which found `L0` and the ' Jordan' column, far from the output." }
```
:::

## The logit lens {id=s3-8 outline=P3.6.md#3.8}

:::slots
first_top: { read: lens.first_top_layer, args: { token: " basketball" }, expect: 8 }
peak: { read: lens.peak_layer, args: { token: " basketball" }, expect: 9 }
:::

:::do{id=lens-run}
There's one more tool. Press **Do it** to run the logit lens and find ' basketball' in :look{at=logit-lens-heatmap}[its last column, ' of'].

```actions
- open_panel: { panel: logit-lens }
- run_logit_lens: {}
```
:::

:::observe{id=lens-obs}
' basketball' first tops the lens at {first_top} and peaks at {peak}, then falls back by the last layer. The chances in the lens's readout are the cells of :look{at=logit-lens-heatmap}[that last column], one per layer; hover a cell to see its token and chance. Before that, the early layers guess plain words like ' the', and they don't favour any sport.

```yaml
check: { read: lens.first_top_layer, args: { token: " basketball" }, op: equals, value: 8, expect: 8 }
```
:::

:::explain-result
The logit lens says when a rough read of the residual stream first favours ' basketball'. That's late, long after the name's information showed up at ' Jordan' in the Swap test. They're not contradicting each other: one's asking where, the other's asking when.

```yaml
supports: "The logit lens shows ' basketball' coming out on top only in the later layers. So read the early rows as a rough hint."
leaves_open: "The lens reads each layer as if it were the last, which the middle layers weren't built for, so it can show when ' basketball' wins a rough read, not where it came from."
tool: logit-lens
skeptic: { says: "A skeptic would say the fact only appears at the layer where ' basketball' first tops the lens.", check: "Here's the check: the Swap test brought ' basketball' back from the ' Jordan' column well before that layer." }
```
:::

## Three tools, three remainders {id=s3-9 outline=P3.6.md#3.9}

:::compare{id=three-tools}
The three readings side by side. The swap says where copying moves the logit, DLA says which parts push directly at the end, and the logit lens says when a rough read first favours ' basketball'.

```yaml
columns:
  - { read: patch.peak, args: { type: mlp } }
  - { read: dla.top_parts, args: { n: 3 } }
  - { read: lens.first_top_layer, args: { token: " basketball" } }
  - { view: summary-table, args: {} }
```
:::

:::explain-result
Put together, they don't point at one place. They point at a story spread over layers and tokens. The name's information sits at ' Jordan' early, reaches ' of' late, and a handful of parts push the answer out at the end. None of them points at one storage spot, and there's no reason to think one exists.

```yaml
supports: "Each tool narrows the suspects for where ' basketball' comes from. None of them finds a place where the fact is stored, so treat 'the fact is in layer N' as a claim none of these can make."
leaves_open: "The MLP swap covers every token at once, DLA counts only direct pushes, and the logit lens is a rough read of middle layers. What carries 'Jordan plays basketball' from the name to the answer, step by step, isn't shown by any of them."
tool: patching
skeptic: { says: "A skeptic would say the Swap test only shows that ' Jordan' and ' Brady' are different tokens, not anything about the fact.", check: "Here's the check: in the residual view, does the effect stay at the name's column, or move to ' of' in later layers?" }
```
:::

## Transfer {id=s5 outline=P3.6.md#5}

:::enter
open_panel: patching
patching: { clean: "Michael Jordan played the sport of", corrupted: "Andy Murray played the sport of", type: mlp }
:::

::::transfer{id=serena}
```yaml
prompt: "Andy Murray played the sport of"
expect_if_explanation_holds: "If `L0` wins because it brings the name back, it wins again with a different athlete, and the next-biggest MLP may sit somewhere else."
limits: "One more athlete. Whichever MLP comes second here, it's one more pair, not where the fact is kept."
```

:::predict{id=apart-from-l0 checks=serena-obs}
Apart from `L0`, which MLP will move ' basketball''s logit most?

```yaml
free: true
```
:::

:::task{id=find-mlp}
Find the MLP layer, other than `L0`, whose swap moves ' basketball' furthest back toward the clean value. The lesson has put `Michael Jordan played the sport of` in :look{at=patching-panel}[the Swap test] as the Original prompt and `Andy Murray played the sport of` as the Changed one, with MLPs picked. Press **Run swap test** in the panel. Both prompts need the same number of tokens; the panel says "same length" when they do. Click bars and read each one's three logits before you trust its colour, then press **Check my result**. You'll know you've got it when the bar you've picked is the biggest one that isn't `L0`.

```yaml
target:
  - { read: patch.focused, field: layer, op: equals, value: $row.35.best_mlp_not_l0 }
constraint:
  - { read: patch.token_count, args: { side: corrupted }, op: equals, value: $read.patch.token_count, value_args: { side: clean }, expect: learner }
learner_actions: [run_patching, focus_patch_cell]
reset: { patching: { clean: "Michael Jordan played the sport of", corrupted: "Andy Murray played the sport of", type: mlp } }
```
:::

:::observe{id=serena-obs}
Write down which layer came second, and how it compares with the Brady run's.

```yaml
journal: true
```
:::

::::

## Explain the chain {id=s6 outline=P3.6.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what did the three tools each show about where ' basketball' comes from, why did `L0` win the MLP swap, and why doesn't any of this say where the fact is stored?"
model_answer: "The MLP swap copies a layer at every token, and `L0` behaves like part of the embedding, so swapping it brings back the name; the residual view shows the name's information at its own token early and at the last token later; DLA shows MLPs among the biggest direct pushes; the logit lens shows ' basketball' rising late; each leaves a remainder, and together they point at many parts, not one spot."
```
:::
