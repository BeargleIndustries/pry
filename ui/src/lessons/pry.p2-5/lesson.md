---
format: 1
id: pry.p2-5
title: "What patterns can a tool find in the residual stream?"
tool: pry
summary: "Meet the separate network that splits the residual stream into patterns, guess one pattern's label from its examples, and test the label."
minutes: 12
stage: 2
targets: [T5, M4, N7]
spine: [residual-stream]
new_terms: [sparse autoencoder, feature, Neuronpedia]
prerequisites: [pry.p1-2, pry.p1-6, pry.p2-3]
cold_entry: "Each token's residual stream is a list of 768 numbers that every layer adds to. The model's weights are fixed; the numbers flowing through on your prompt are activations, worked out fresh each Run. The logit lens reads a layer's residual stream with the unembedding, the model's last step."
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 7, 53, 54, 55]
limits: "Features are patterns an SAE found in one layer's residual stream. Each label is an AI's guess from the top examples, so test it against them."
slots:
  fid: { row: "53.fid", format: count }
  preset: { row: "53.sae_layer", format: count }
---

## Recall {id=s3-1 depth=optional outline=P2.5.md#3.1}

:::recall{id=recall-lens}
Why this matters: the residual stream can hold more than one read shows, and this lesson uses a read built to find it.

```yaml
from: pry.p2-3
question: "The logit lens reads the residual stream with the unembedding. Could the residual stream hold things that read can't show?"
choices:
  - { text: "yes", feedback: "It can. The logit lens only asks which token a layer would put on top, and the residual stream holds plenty that isn't a next-token guess. This lesson tries a different read." }
  - { text: "no", feedback: "It can. The logit lens only asks which token a layer would put on top, and the residual stream holds plenty that isn't a next-token guess. This lesson tries a different read." }
```
:::

:::do{id=jordan-ensure}
Pry loads the Jordan prompt one more time.

```actions
- set_prompt: { text: "Michael Jordan played the sport of" }
- ensure_run: { prompt: "Michael Jordan played the sport of" }
```
:::

## More ideas than numbers {id=s3-2 outline=P2.5.md#3.2}

:::explain{id=shared-numbers}
Each token's residual stream has 768 numbers. It carries far more ideas than that: that this is a name, that it's a sports name, that a sport's coming up, what kind of sentence you're in. With more ideas than numbers, ideas have to share. Each idea is spread over many numbers, and each number moves for many ideas.

So there isn't a "basketball number" you can point at. That's a big part of why nobody can read the residual stream straight off.

```yaml
image: images/ideas-share-numbers.svg
alt: "A row of numbers standing for one token's residual stream. Three coloured bands, each one idea, overlap on many of the same numbers, so no single number belongs to just one idea."
```
:::

::::fold{title="The name researchers use"}

:::explain
Packing more ideas than numbers, so ideas share numbers, is called **superposition**. You won't need the word again on the main path.
:::

::::

:::question{id=sports-number}
If ideas share numbers, what goes wrong if you read number 37 as 'the sports number'?

```yaml
free: true
model_answer: "It also moves for other ideas."
```
:::

## A second network that splits the residual stream {id=s3-3 outline=P2.5.md#3.3}

:::explain
Researchers trained a second, separate network to take one layer's residual stream at one token and split it into thousands of patterns, with only a few active at once. It isn't part of GPT-2. It reads GPT-2's numbers from the side.

This network is called a **sparse autoencoder**, or **SAE**: "sparse" because few patterns are active at a time, "autoencoder" because it's trained to rebuild its input from those patterns. It's the tool behind Pry's "Features" tab, and you'll see it all over current research.
:::

:::analogy
```yaml
like: "a dictionary: a few letters make thousands of words, and a few active patterns describe a token's residual stream"
because: "A dictionary lets you say plenty with a short list of entries, and the SAE describes 768 tangled numbers with a short list of active patterns."
breaks: "an entry isn't an exact concept, its label is another AI's guess, and the SAE can't rebuild the residual stream perfectly."
```
:::

## The patterns are features {id=s3-4 outline=P2.5.md#3.4}

:::do{id=features-tab}
Each pattern the SAE found is called a **feature**. At each token a few features fire, each with its activation: how strongly it fires, worked out fresh on every run, like any activation from P1.6. The Features tab lists them, and the lessons where you poke at the model switch them off and turn them up. "Concept" stays the word for the human idea a label names.

:look{at=panel-b-layer-selector}[The layer menu] says which layer's residual stream the SAE reads. Then look at :look{at=panel-b-features-list}[the feature list] for ' Jordan'. "Features" = SAE features.

```actions
- open_panel: { panel: features }
- switch_sae_layer: { layer: $row.53.sae_layer }
- focus_token: { text: " Jordan" }
```
:::

## Guess the label {id=s3-5 outline=P2.5.md#3.5}

:::do{id=open-card}
Pry opens one feature from the ' Jordan' list with its label hidden. Look at :look{at=feature-row id=$row.53.fid}[its examples].

```actions
- open_feature: { id: $row.53.fid }
```
:::

:::explain
These are snippets of real text where this feature fired hardest, its top examples. Read the first five before you guess.

```yaml
when: { read: features.has_snippets, args: { id: $row.53.fid }, op: equals, value: true }
```
:::

:::explain
The examples haven't loaded, which happens when Pry can't reach the site it gets them from. Guess from where the feature fires on your own prompt instead: hover the tokens and watch its activation.

```yaml
when: { read: features.has_snippets, args: { id: $row.53.fid }, op: equals, value: true, not: true }
```
:::

:::predict{id=label-guess checks=label-obs}
What do these examples have in common?

```yaml
free: true
choices:
  - { text: "names of basketball players" }
  - { text: "proper nouns, specifically the name \"Jordan.\"" }
  - { text: "famous names or personalities" }
hides: [feature-labels]
```
:::

## The label, and where it comes from {id=s3-6 outline=P2.5.md#3.6}

:::slots
label: { row: "53.label", format: string }
:::

:::observe{id=label-obs}
The label's back: {label}. It comes from a public website that catalogues SAE features, with labels written by an AI from each feature's top examples, and that site's called **Neuronpedia**. Pry shows its labels and examples, and its name's on screen next to them.

Here's the label Neuronpedia gives it. How does your guess compare? Both of you worked from the same examples.

```yaml
journal: true
```
:::

:::explain-result
You and the labelling AI read the same snippets and came up with a name. That's all a label is: a good guess from the top examples.

```yaml
supports: "Each label is written by an AI from the top examples. Labels are best guesses from Neuronpedia, not certainties. Treat a label as a summary of the examples, which means they're a best guess, not a guarantee."
leaves_open: "A label sums up the top examples. It doesn't tell you what the feature does on text unlike those examples."
tool: features
skeptic: { says: "A skeptic would say the label is close enough, so you can trust it from here on.", check: "Next section: go through the examples one by one and look for one the label doesn't fit." }
```
:::

## An example the label doesn't cover {id=s3-7 outline=P2.5.md#3.7}

:::question{id=label-miss}
Go back through the examples, and the :look{at=feature-histogram}[little chart] of where it fires, and pick one where the feature fires but the label doesn't fit.

:refutes{target=T5}[The label doesn't cover every example the feature fires on: one of its top snippets is about Drew Brees, a football quarterback.]

```yaml
free: true
```
:::

:::analogy
The label fits four of those five examples and misses one, the way any short name does. That's where we're done with the dictionary.

```yaml
like: "a tuner app splitting a chord into named notes"
because: "The app hears a mix and tells you which notes are in it, the way the SAE splits a residual stream into a few named features."
breaks: "the names are ours, and some sound is always left over."
```
:::

::::fold{title="The name for a feature with more than one idea"}

:::explain
A feature that fires for more than one idea is called **polysemantic**. Lots of features are a bit like that, which is one more reason to check a label against its examples.
:::

::::

## Firing isn't causing {id=s3-8 outline=P2.5.md#3.8}

:::explain-result
A feature firing at ' Jordan' shows the SAE found that pattern in the residual stream there. It doesn't show the model used it to put ' basketball' on top.

:refutes{target=[M4, N7]}[Lots of people read features as what the model is thinking about. Features are patterns a separate tool found, and many line up with ideas a person can name. Whether one affects the output is a separate test, and it comes in Stage 3.]

```yaml
supports: "Features are patterns an SAE found in one layer's residual stream. Each label is an AI's guess from the top examples, so test it against them. Labels are best guesses from Neuronpedia, not certainties."
leaves_open: "An active feature shows a pattern the SAE found here. It doesn't show the feature affects the output, and the SAE can't rebuild the residual stream perfectly, so some of what's there isn't in any feature."
tool: features
skeptic: { says: "A skeptic would say this feature only fires for the word ' Jordan', not for anything about basketball.", check: "Check: run `Jordan is a country in the Middle East` and see whether {fid} fires at ' Jordan'." }
```
:::

:::analogy
```yaml
like: "a snapshot vs the whole movie"
because: "The list at one token is a single frame; the little chart across your prompt is closer to watching the whole scene."
breaks: "the \"movie\" still shows only each token's top features."
```
:::

## Transfer {id=s5 outline=P2.5.md#5}

::::transfer{id=bank-features}
```yaml
prompt: "I like the river bank"
expect_if_explanation_holds: "By the SAE's layer, attention has mixed ' river' or ' money' into ' bank', so the residual streams differ and some features should differ with them."
limits: "An active feature shows a pattern the SAE found here. It doesn't show the feature affects the output, and the SAE can't rebuild the residual stream perfectly, so some of what's there isn't in any feature."
```

:::predict{id=bank-same checks=bank-obs}
In P1.2, ' bank' had the same embedding plus positional embedding in both sentences. At layer {preset}, will the same features fire at ' bank'?

```yaml
choices:
  - { text: "identical", feedback: "Lots of people expect that, since ' bank' started out with exactly the same numbers in both. By this layer, attention's had several layers to mix in the word before it, so the lists come out different." }
  - { text: "some shared, some different" }
  - { text: "completely different" }
```
:::

:::do{id=bank-compare}
Pry puts both sentences side by side in :look{at=compare-panel}[Compare] and focuses ' bank'. Read the two feature lists against each other.

```actions
- set_compare_mode: { on: true }
- set_compare: { a: "I like the river bank", b: "I like the money bank" }
- run_compare: {}
- focus_token: { text: " bank", side: b }
```
:::

:::observe{id=bank-obs}
Which features show up for ' bank' in both sentences, and which in only one? Note one that's only on one side and what its label says.

```yaml
journal: true
```
:::

::::

:::explain-result
In P1.2 the meaning difference between the two banks had to come from somewhere, since ' bank' started out identical. This is the place it shows up: by layer {preset}, attention has mixed in ' river' or ' money', the residual streams differ, and the features differ with them. When Pry recorded this, the money sentence's ' bank' had features about money and banks that the river sentence's didn't.

```yaml
supports: "The meaning difference P1.2 said \"must come from somewhere\" got mixed in by attention from ' river' or ' money', and the features at ' bank' differ between the sentences. Labels are best guesses from Neuronpedia, not certainties."
leaves_open: "An active feature shows a pattern the SAE found here. It doesn't show the feature affects the output, and the SAE can't rebuild the residual stream perfectly, so some of what's there isn't in any feature."
tool: features
skeptic: { says: "A skeptic would say a feature only on the money side proves the model reads ' bank' as a money bank there.", check: "Look at that feature's top examples and test its label first, the way you did with the Jordan feature." }
```
:::

## Explain the chain {id=s6 outline=P2.5.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what is a feature, where does its label come from, and why doesn't a feature firing at ' Jordan' show it caused ' basketball'?"
model_answer: "The residual stream packs in more ideas than numbers; an SAE, a separate network, splits one layer's residual stream at a token into thousands of patterns with few active; each is a feature; Neuronpedia's labels are an AI's guess from top examples, and some examples don't fit; firing shows the pattern is there, not that it's used; switching features off or turning them up is the test (Stage 3)."
```
:::
