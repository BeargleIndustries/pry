---
format: 1
id: pry.p2-3
title: "What would each layer guess?"
tool: pry
summary: "Read every layer's residual stream with the model's last step and see where ' basketball' starts to lead, and why that read is rough."
minutes: 10
stage: 2
targets: [T3, M4]
spine: [residual-stream, logits]
new_terms: [unembedding, logit lens]
prerequisites: [pry.p1-3, pry.p1-4, pry.p2-1]
cold_entry: "Each token's residual stream is a list of 768 numbers that every layer adds to. At the top, the last token's list becomes a logit for every token, and the logits become probabilities. Attention is the half of each layer that mixes information in from earlier tokens."
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 14, 17, 20, 21, 50]
limits: "The logit lens reads each layer with the model's last step. The middle layers weren't built to be read this way, so early rows are a rough hint."
slots:
  first_top_layer: { read: lens.first_top_layer, args: { token: " basketball" }, from_capture: jordan_lens, expect: 8 }
  peak_layer: { read: lens.peak_layer, args: { token: " basketball" }, from_capture: jordan_lens, expect: 9 }
  peak_p: { read: lens.peak_prob, args: { token: " basketball" }, from_capture: jordan_lens, expect: 0.932 }
  final_p: { read: lens.final_prob, args: { token: " basketball" }, from_capture: jordan_lens, expect: 0.4221 }
---

## Recall {id=s3-1 depth=optional outline=P2.3.md#3.1}

:::recall{id=recall-attention}
Why this matters: this lesson's tool reads the residual stream partway up, so you can see what each layer would guess.

```yaml
from: pry.p2-1
question: "In P2.1, could attention lines show whether a token's information mattered? What would you want from a tool that reads the residual stream partway up?"
free: true
```
:::

## The model's last step {id=s3-2 outline=P2.3.md#3.2}

:::enter
open_panel: predictions
:::

:::explain{id=top-box}
At the very top of the model there's one fixed step. It takes the last token's residual stream and turns it into a logit for every token in the vocabulary, about fifty thousand of them. Those logits are what've been turning into the probabilities you've been reading in Predictions.

The model's last step, which turns a residual stream into a logit for every token in the vocabulary, is called the **unembedding**. The name mirrors the embedding from P1.2: the embedding turns tokens into numbers at the bottom, and the unembedding turns numbers back into scores for tokens at the top. The next tool's built out of it.

```yaml
image: images/spine-top-box.svg
alt: "The model drawn as a column: the embedding at the bottom, 12 layers stacked above it, and at the top a highlighted box labelled unembedding that turns the last token's residual stream into a logit for every token."
```
:::

::::fold{title="One more step at the top"}

:::explain
Right before the unembedding there's a normalising step called LayerNorm, which rescales the residual stream so its numbers sit in a steady range. Pry runs it whenever it applies the unembedding, so you're fine treating the two as one step here.
:::

::::

## Read any layer with it {id=s3-3 outline=P2.3.md#3.3}

:::explain
The unembedding only runs once, at the top. There's nothing stopping you from running it on the residual stream partway up, though, after `L0`, after `L1`, all the way to `L11`, as if the model had to answer right there. Reading any layer's residual stream with the unembedding like this is called the **logit lens**. The same name sits on :look{at=left-tab-strip}[Pry's Logit Lens tab], which you'll open once you've made a guess.
:::

:::analogy
```yaml
like: "a photo developing in a tray"
because: "Pull the print out early and you see a faint, rough version; leave it longer and the picture gets clearer."
breaks: "the middle layers' residual stream wasn't built to be read this way, and the picture can sharpen and then fade."
```
:::

:::do{id=run-jordan}
Run the Jordan prompt from P1.1 again. You've seen ' basketball' come out on top there, at the very end; now you'll see what the layers below would've said.

```actions
- set_prompt: { text: "Michael Jordan played the sport of" }
- run: {}
```
:::

## Predict {id=s3-4 outline=P2.3.md#3.4}

:::predict{id=first-top checks=first-top-obs}
At which layer does ' basketball' first come out on top?

```yaml
choices:
  - { text: "L0-L2", target: M4, feedback: "Lots of people expect an early lead, since Jordan and basketball go together so often. ' basketball' first tops the logit lens at {first_top_layer}. Early rows mostly show common short words, because not much has been added to the residual stream yet." }
  - { text: "L3-L5" }
  - { text: "L6-L8" }
  - { text: "L9-L11" }
  - { text: "only at the end", target: T3, feedback: "Lots of people expect that, since Predictions only ever shows the end. ' basketball' first tops the logit lens at {first_top_layer}, several layers before the last one, and peaks at {peak_layer} with {peak_p}." }
```
:::

:::question{id=early-made-from}
What was the top guess at `L2` made from?

```yaml
free: true
model_answer: "Only the residual stream so far: its embedding plus positional embedding, plus three layers' additions."
```
:::

## The reveal {id=s3-5 outline=P2.3.md#3.5}

:::do{id=lens-run}
Pry runs the logit lens and focuses ' of'. Read :look{at=logit-lens-heatmap}[the Logit Lens chart], last column, from the bottom row up: each row is one layer's top guess.

```actions
- open_panel: { panel: logit-lens }
- run_logit_lens: {}
- focus_token: { text: " of" }
```

```yaml
capture: jordan_lens
```
:::

:::observe{id=first-top-obs}
' basketball' first comes out on top at {first_top_layer}. It peaks at {peak_layer} with {peak_p}, then ends at {final_p} after the last layer, the same number Predictions shows.

```yaml
check: { read: lens.first_top_layer, args: { token: " basketball" }, op: equals, value: 8, expect: 8 }
```
:::

## Sharpen, then fade {id=s3-6 outline=P2.3.md#3.6}

:::explain-result
Why does {peak_p} drop to {final_p}? The layers after {peak_layer} added things to the residual stream that raised other tokens, so ' basketball' kept the top spot with a smaller share. This view doesn't show which part added them; the next lesson's tool does.

Read each row as what that layer would guess, read through the logit lens.

:refutes[Being on top partway up didn't settle anything: the last two layers still changed the probabilities.]

```yaml
supports: "The logit lens shows ' basketball' leading from the middle-to-late layers and losing probability at the end. It's an approximation, since the middle layers weren't built to be read this way. It's a hint, not proof."
leaves_open: "The rows show what the unembedding makes of each layer, not which part of the model raised or lowered ' basketball'."
tool: logit-lens
skeptic: { says: "A skeptic would say the drop at the end means the late layers are working against the answer.", check: "Check where ' basketball' sits at the end: it's still the top token, just with a smaller share." }
```
:::

## What's the same? {id=s3-7 outline=P2.3.md#3.7}

:::slots
she_first: { read: lens.first_top_layer, args: { token: " she" }, expect: 10 }
she_final: { read: lens.final_prob, args: { token: " she" }, expect: 0.1897 }
:::

:::do{id=nurse-run}
Your turn on a second prompt. Pry runs the nurse prompt from P1.3 through the logit lens; find where ' she' first tops.

```actions
- set_prompt: { text: "The nurse said that" }
- run: {}
- run_logit_lens: {}
- focus_token: { text: " that" }
```
:::

:::observe{id=she-obs}
' she' first tops at {she_first}, ending at {she_final} after the last layer.

```yaml
check: { read: lens.first_top_layer, args: { token: " she" }, op: equals, value: 10, expect: 10 }
```
:::

:::question{id=both-prompts}
In both prompts, where does the answer first lead, and what happens at the last layer?

```yaml
free: true
model_answer: "Late, then the last layer lowers it."
```
:::

## Does the residual stream run ahead? {id=s3-8 depth=optional outline=P2.3.md#3.8}

::::fold{title="Optional: does the residual stream run ahead of the text? Open this for a rhyme test in the logit lens."}

:::explain
The model writes one token at a time, as you saw in P1.5. Its residual stream can still carry information about tokens further ahead. Researchers at Anthropic showed this in a larger model (Lindsey et al., 2025): asked for a rhyming couplet, the model already had the rhyme word active before it wrote the line that ends in it. That was in a larger model, not shown here.
:::

:::do{id=rabbit-run}
Here's the same kind of couplet for GPT-2 small. Pry runs it through the logit lens; look for ' rabbit' in the last column.

```actions
- set_prompt: { text: "He saw a carrot and had to grab it,\nHis hunger was like a starving" }
- run: {}
- run_logit_lens: {}
```
:::

:::explain
' rabbit' isn't the top guess in any row. This tool, on this model, doesn't show it. Pry's chart only shows each row's top token, so a word sitting lower down stays out of sight; what you can say is that GPT-2 small doesn't put the rhyme on top anywhere.
:::

::::

## Transfer {id=s5 outline=P2.3.md#5}

:::slots
mary_first: { read: lens.first_top_layer, args: { token: " Mary" }, expect: 9 }
mary_final: { read: lens.final_prob, args: { token: " Mary" }, expect: 0.677 }
bb_rank_l5: { row: "50.rank_L5", format: count }
bb_rank_l6: { row: "50.rank_L6", format: count }
bb_rank_l7: { row: "50.rank_L7", format: count }
:::

::::transfer{id=mary-lens}
```yaml
prompt: "When Mary and John went to the store, John gave a drink to"
expect_if_explanation_holds: "' Mary' should first lead in a late layer and lose some probability at the last layer, the same shape as ' basketball' and ' she'."
limits: "It shows what the unembedding would make of each layer's residual stream. It doesn't show which part added the answer, or what else the residual stream holds that this read can't see."
```

:::predict{id=mary-early checks=mary-obs}
Will ' Mary' first lead early or late? Will the last layer raise or lower it?

```yaml
free: true
```
:::

:::do{id=mary-run}
Pry runs the Mary and John prompt from P2.1 through the logit lens and focuses the last ' to'.

```actions
- set_prompt: { text: "When Mary and John went to the store, John gave a drink to" }
- run: {}
- run_logit_lens: {}
- focus_token: { text: " to", occurrence: last }
```
:::

:::observe{id=mary-obs}
' Mary' first leads at {mary_first} and ends at {mary_final} after the last layer.

```yaml
check: { read: lens.first_top_layer, args: { token: " Mary" }, op: equals, value: 9, expect: 9 }
```
:::

::::

:::explain-result
Same shape a third time: the answer shows up late, and the last layer lowers it. Even close to certain partway up isn't the answer you'd get out the other end. So read the early rows as a rough hint.

Pry also ranked ' basketball' among all the tokens in the earlier rows of the Jordan prompt: rank {bb_rank_l5} at `L5`, {bb_rank_l6} at `L6` and {bb_rank_l7} at `L7`, before it reaches the top at `L8`. It was climbing, not missing.

```yaml
supports: "The middle layers weren't built to be read this way, so early rows are a rough hint. It's a hint, not proof."
leaves_open: "It shows what the unembedding would make of each layer's residual stream. It doesn't show which part added the answer, or what else the residual stream holds that this read can't see."
tool: logit-lens
skeptic: { says: "A skeptic would say ' basketball' wasn't there at all before `L8`, it was just invisible to this read.", check: "Check: look at ' basketball''s rank in the `L5`-`L7` rows, not just the top token." }
```
:::

## Explain the chain {id=s6 outline=P2.3.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what is a logit lens row, and why is {peak_p} at {peak_layer} not what GPT-2 'believed' there?"
model_answer: "Each layer adds to the residual stream; the logit lens reads it with the unembedding, the model's last step; that step was built for the top, so middle reads are rough; ' basketball' climbs late, peaks at {peak_layer} and falls at the end because later layers add more; the row is a measurement, not a belief."
```
:::
