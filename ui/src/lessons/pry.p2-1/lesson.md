---
format: 1
id: pry.p2-1
title: "Where does each token pull information from?"
tool: pry
summary: "Watch where one token's numbers draw from, one head at a time, and find out why a thick line is a suspect, not a verdict."
minutes: 12
stage: 2
targets: [T2, M4]
spine: [residual-stream]
new_terms: [attention, attention head]
prerequisites: [pry.p1-3, pry.p1-6]
cold_entry: "Each token gets its own list of 768 numbers, its residual stream, and that list travels up through 12 layers. Every layer reads it and adds its own work into the same numbers. The model's weights were fixed when training ended; the numbers flowing through on your prompt are activations, worked out fresh on every Run."
model: gpt2-small
baseline: { prompt: "When Mary and John went to the store, John gave a drink to" }
verified_rows: [14, 23, 45, 46, 47]
---

## Recall {id=s3-1 depth=optional outline=P2.1.md#3.1}

:::recall{id=recall-same-lines}
```yaml
from: pry.p1-5
question: "At temperature 0 the same prompt gives the same text. Will the lines you're about to see look the same on a second Run?"
choices:
  - { text: "yes", feedback: "Same prompt in, same numbers out. Using the model doesn't change it, and what you're about to look at is activations, worked out fresh on each Run from the same fixed weights." }
  - { text: "no", feedback: "They'll come out the same. Using the model doesn't change it, and what you're about to look at is activations, worked out fresh on each Run from the same fixed weights. Only sampling at a temperature above 0 adds chance, and that happens after all of this." }
```
:::

## Looking inside gives suspects {id=s3-2 outline=P2.1.md#3.2}

:::slots
mary: { read: prediction, args: { token: " Mary" }, field: prob, expect: 0.677 }
john: { read: prediction, args: { token: " John" }, field: prob, expect: 0.0235 }
:::

:::do{id=run-ioi}
Run this prompt and look at :look{at=predictions-panel}[Predictions]: ' Mary' gets {mary} and ' John' gets {john}. You'd say Mary too, because John is the one doing the giving.

This whole stage asks how the model got there. Every token's residual stream is a long list of numbers that nobody can read straight off, so each view you'll meet from here on reads those numbers one particular way, and each one has a limit you'll hear about. None of them hands you a verdict, just a list of suspects.

```actions
- set_prompt: { text: "When Mary and John went to the store, John gave a drink to" }
- run: {}
- ensure_run: { prompt: "When Mary and John went to the store, John gave a drink to" }
```
:::

:::analogy
```yaml
like: "suspects, not a verdict"
because: "A detective's list of who was in the room is worth having, and you still have to test each name before you call anyone guilty."
breaks: "usually many parts share the work, so there's rarely one culprit."
```
:::

## Which word matters? {id=s3-3 outline=P2.1.md#3.3}

:::do{id=tap-token}
Before you learn what any tool measures, have a go on your own. Look along :look{at=token-strip}[the token strip] and pick the earlier word you'd bet on.

```actions
- highlight: { anchor: token-strip }
```
:::

:::predict{id=word-pick checks=word-pick-saved}
Which earlier word matters most for ' Mary' coming out on top?

```yaml
choices:
  - { text: "\" Mary\"", target: T2 }
  - { text: "\" John\" (second)" }
  - { text: "\" store\"" }
  - { text: "\" drink\"" }
  - { text: "something else" }
remember: word-pick
```
:::

:::observe{id=word-pick-saved}
Hold on to that. A later lesson tests it.

There's no reveal here, on purpose. Pry saves your pick, and when you get to switching parts off, you'll come back to it with a real test.

```yaml
journal: true
```
:::

## A layer's two halves {id=s3-4 outline=P2.1.md#3.4}

:::explain{id=two-halves}
Back in P1.3 each layer just "added its work". Here's the fuller picture: a layer has two halves. The first half moves information into a token's residual stream from that token itself and from the tokens before it. It never reaches forward to a later token. The second half works on each token's residual stream on its own, with no mixing; you'll get its name in P2.4.

The half of a layer that mixes information into a token's residual stream from itself and the tokens before it is called **attention**. Every paper uses the word, and so does Pry's Attention tab, which is where you're headed next.

That's the assembly line's 'stations draw from other dishes': we're done with that picture.

```yaml
withdraws: [assembly line]
image: images/layer-two-halves.svg
alt: "One layer drawn as two halves above a row of tokens. In the attention half, arrows run from each token back to itself and to earlier tokens, never forward. In the other half, each token has its own box with no arrows between tokens."
```
:::

## Attention lines from the last token {id=s3-5 outline=P2.1.md#3.5}

:::do{id=lines-from-to}
Pry now shows :look{at=panel-a-lines}[the attention lines] from the last token, ' to'. Each line runs back to an earlier token, and its thickness shows how much ' to' drew from that token, averaged over the whole model.

```actions
- open_panel: { panel: attention }
- set_attention_view: { view: lines }
- focus_token: { text: " to", occurrence: last }
- set_focus_mode: { mode: from }
```
:::

:::analogy
```yaml
like: "a mixing desk: each earlier token is a channel, and attention sets how much of each goes into this token's mix"
because: "A thick line is a fader pushed up: more of that channel ends up in what ' to' carries forward."
breaks: "a loud channel can carry nothing useful, and nobody set the faders by hand."
```
:::

:::observe{id=thickest}
Where does the thickest line go?

```yaml
check: { read: attention.avg_top_source, args: { from: $row.14.to_position }, op: contains, value: { position: 0 } }
```
:::

## The parking spot {id=s3-6 outline=P2.1.md#3.6}

:::slots
marker_share: { read: attention.avg_share, args: { from: $row.14.to_position, to: 0 }, expect: 0.44 }
:::

:::do{id=first-line}
Look at :look{at=panel-a-lines}[the line to the very first token]. That's the start-of-text marker from P1.2, and there's no word in it.

```actions
- highlight: { anchor: panel-a-lines }
```
:::

:::analogy
```yaml
like: "a parking spot"
because: "When nothing earlier stands out, the mix drifts to the marker, the way a car with nowhere to be sits in its usual space."
breaks: "heads aren't choosing a spot; it's a habit training left in the weights."
```
:::

::::fold{title="The name researchers use"}

:::explain
Researchers call a token that soaks up spare attention like this an **attention sink**. You won't need the name again in these lessons; it's here so you'll recognise it in a paper.
:::

::::

:::explain-result
Averaged over the whole model, {marker_share} of the mix at ' to' comes from the start-of-text marker, and the line to it is the thickest one on screen.

If you picked the word with the thickest line, the line to the marker shows why thickness alone can mislead.

```yaml
supports: "Thickness tells you where ' to' drew from. The heaviest draw here goes to a token that carries no word, so a thick line on its own says little about what mattered."
leaves_open: "The averaged lines blend the whole model into one picture, so they can't show which parts drew from ' Mary' or what came across."
tool: attention
skeptic: { says: "A skeptic would say the marker's big share is just how the average falls out, and single parts of the model draw from real words.", check: "Next section: split the average apart and look one part at a time." }
assert:
  - require: { slot: marker_share, op: gt, value: 0.3 }
    say: "No other token gets a bigger share, and the marker holds nothing about Mary or John."
    else: "This time the marker's share came out smaller than recorded, so check which line is thickest before you read anything into it."
```
:::

## One head at a time {id=s3-7 outline=P2.1.md#3.7}

:::explain
Attention isn't one mixer per layer. Each layer has 12 separate attention units, 144 in the whole model, and each one has its own pattern of which earlier tokens it draws from. One of those units is called an **attention head**, or **head** for short. The grid you're about to open and every later poke at the model work head by head, so you'll be seeing this word from now on.
:::

:::do{id=expert-grid}
Open :look{at=panel-a-heatmap}[the head grid]: one cell per head, 12 layers by 12 heads. Each cell's colour is one summary score for that head, picked in :look{at=panel-a-agg-selector}[the Score by menu]. Click a cell and the lines show just that head. Pry has opened one for you.

```actions
- set_attention_view: { view: expert }
- set_aggregation: { aggregation: max }
- set_lines_head: { layer: $row.14.mary_head_layer, head: $row.14.mary_head }
- open_head: { layer: $row.14.mary_head_layer, head: $row.14.mary_head }
```
:::

:::analogy
```yaml
like: "a wall of security monitors"
because: "Each cell is one screen, and clicking it brings that one camera up full size."
breaks: "each screen is one summary score, not the head's whole pattern."
```
:::

## What's the same? {id=s3-8 outline=P2.1.md#3.8}

:::task{id=find-mary-head}
Find a head whose line from ' to' goes mostly to ' Mary'.

Click around the grid, then read each head's lines from ' to'. The reset puts this prompt, the grid and the focus on ' to' back.

```yaml
target:
  - { read: lines_head, op: in, value: $row.14.mary_heads }
reset: { prompt: "When Mary and John went to the store, John gave a drink to", attention_view: expert, focus_token: { text: " to", occurrence: last } }
remember: { key: head-pick, read: lines_head }
```
:::

:::analogy
```yaml
like: "skimming back over what you've written so far"
because: "Different heads skim for different things on the same sentence, which is why one prompt gives you very different lines head to head."
breaks: "a head blends every earlier token at once, and a big weight doesn't mean that token mattered. Done with the mixing desk here."
```
:::

:::question{id=only-back}
If you typed more words after ' to', could any head at ' to' draw from them?

```yaml
choices:
  - { text: "yes", feedback: "Attention only reaches back. A token can draw from itself and the tokens before it, so new words typed after ' to' can't feed into ' to'." }
  - { text: "no" }
model_answer: "No: attention only reaches back."
```
:::

## What attention can and can't show {id=s3-9 outline=P2.1.md#3.9}

:::explain-result
You've found a head that draws heavily from ' Mary' at ' to'. Look back at :look{at=panel-a-lines}[the lines] and keep in mind what they measure: how much of each earlier token went into the mix. They don't say what information came across, and they don't say ' Mary' won because of it.

```yaml
supports: "Attention shows which earlier tokens a head drew from. A big weight doesn't mean that token mattered for the answer."
leaves_open: "Attention weights say where a head drew from, not what it carried or whether the answer depended on it. Only switching the head off can show that, and that's a later lesson."
tool: attention
skeptic: { says: "A skeptic would say the head you found draws from ' Mary', so it must be why ' Mary' wins.", check: "Here's a check you'll run in a later lesson: switch that head off and see whether ' Mary' drops." }
```
:::

## Transfer {id=s5 outline=P2.1.md#5}

:::slots
row23_token: { row: "23.token", format: string }
weight: { read: attention.weight, args: { layer: $row.23.layer, head: $row.23.head, from: $row.14.to_position, to: $row.23.position }, expect: 0.808 }
:::

::::transfer{id=other-head}
```yaml
prompt: "When Mary and John went to the store, John gave a drink to"
expect_if_explanation_holds: "If thick lines are suspects, this head can draw heavily from one word without telling you anything about whether ' Mary' needed it."
limits: "The lines show where this head drew from on this one prompt; whether ' Mary' depended on it waits for the knockout lesson."
```

:::do{id=row23-head}
Here's a head you haven't looked at yet. Pry shows :look{at=panel-a-lines}[its lines] from ' to'.

```actions
- set_lines_head: { layer: $row.23.layer, head: $row.23.head }
- focus_token: { text: " to", occurrence: last }
```
:::

:::predict{id=heaviest-line checks=heaviest-obs}
Where does this head's heaviest line from ' to' go: the start-of-text marker, ' Mary', or another word?

```yaml
choices:
  - { text: "the start-of-text marker" }
  - { text: "\" Mary\"", target: M4, feedback: "Lots of people expect every head to point at the answer. This one draws {weight} of its mix from {row23_token}. Heads draw from all sorts of tokens, and only some of them have anything to do with ' Mary'." }
  - { text: "another word" }
```
:::

:::observe{id=heaviest-obs}
This head draws {weight} of its mix at ' to' from {row23_token}. That's a heavy line to a word that isn't a name at all.

```yaml
check: { read: attention.top_source, args: { layer: $row.23.layer, head: $row.23.head, from: $row.14.to_position }, op: contains, value: { token: $row.23.token } }
```
:::

::::

:::question{id=hypothesis}
Would switching this head off move ' Mary'? Write your guess; a later lesson tests it.

```yaml
free: true
remember: hypothesis
```
:::

## Explain the chain {id=s6 outline=P2.1.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what does a thick attention line from ' to' to another token tell you, and what doesn't it tell you?"
model_answer: "Each head mixes information into a token's residual stream from itself and earlier tokens; the line shows how much it drew from each; many heads park on the start-of-text marker; a heavy line is a suspect, not proof that token mattered; switching the head off is the test."
```
:::
