---
format: 1
id: pry.p1-3
title: "What happens between your prompt and the guess?"
tool: pry
summary: "Between your tokens and the model's chances sit 12 fixed steps that each add to every token's numbers. You'll see why changing an early word changes the guess at the end."
minutes: 10
stage: 1
targets: [M5]
spine: [embedding, residual-stream, probabilities]
new_terms: [layer, residual stream]
prerequisites: [pry.p1-2]
cold_entry: "What you need from before: GPT-2 cuts text into tokens; each token starts as its embedding (its entry from a fixed table) plus a positional embedding (a set of numbers for where it sits); the model ends with a chance for every token in the vocabulary."
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 18, 30]
---

## Recall {id=s3-0 depth=optional outline=P1.3.md#3.0}

:::recall{id=recall-basketball}
Why this matters: this lesson opens up that file of numbers and follows your prompt through it.

```yaml
from: pry.p1-1
question: "Where did ' basketball' come from in lesson 1?"
choices:
  - { text: "a search" }
  - { text: "a fixed file of numbers set by training" }
  - { text: "a fact table" }
free: true
```
:::

:::explain
Here's the answer lesson 1 ended on, to compare with yours: GPT-2 is a language model, a fixed file of numbers that training set by showing it lots of text. It turns a prompt into a chance for every possible next word, right on your computer, and nothing gets looked up.
:::

## What's in the gap? {id=s3-1 outline=P1.3.md#3.1}

:::do{id=jordan-run}
The Jordan sentence is back, and it's run. :look{at=lesson:spine}[The spine strip] shows tokens and their embeddings on one side, the chances on the other, and :spine{mask=residual-stream} in between. This lesson fills in that gap.

```actions
- set_prompt: { text: "Michael Jordan played the sport of" }
- ensure_run: { prompt: "Michael Jordan played the sport of" }
```
:::

:::predict{id=gap checks=gap-reveal}
Between each token's embedding plus positional embedding and the chances, what happens?

```yaml
choices:
  - { text: "one program reads the sentence, works out the meaning and decides", target: M5 }
  - { text: "the same fixed steps run in order, each adding a bit to every token's numbers" }
  - { text: "it compares your sentence with stored examples", target: M2 }
```
:::

## Twelve steps {id=s3-2 outline=P1.3.md#3.2}

:::observe{id=gap-reveal}
```yaml
journal: true
```
:::

:::explain{id=twelve-image}
Here's the gap filled in. Every token gets its own column, and the same 12 steps run over all of them, bottom to top. You'll meet these step numbers again in :look{at=panel-b-layer-selector}[the layer menu] later.

```yaml
image: images/spine-twelve-steps.svg
alt: "The spine drawn as 12 stacked steps labelled by layer number, bottom to top, with one column of dots for each token of 'Michael Jordan played the sport of'. Each column starts at the token's embedding plus positional embedding, and an arrow from the top of the last column, ' of', points to the chances for the next token."
```
:::

:::explain-result
:refutes[Lots of people picture one program that decides; chatbots talk like one. What actually runs is the same fixed arithmetic, every time, in 12 steps. Nothing in there chooses.]

Each of those 12 steps runs in order, reads every token's numbers and adds its own work. One step is called a **layer**. Pry's tools are organised by layer, so you'll see the word everywhere. Pry numbers them `L0` to `L11`.

From here on it's just tokens.

```yaml
supports: "The middle of the model is the same 12 layers running in order on every token's numbers. There's no separate program in there that reads your meaning and picks an answer."
leaves_open: "The picture shows the order the layers run in. It doesn't show what any one layer adds."
tool: predictions
```
:::

:::simplification
A layer has two kinds of parts. We'll meet them in lessons P2.1 and P2.4.

```yaml
corrected_in: [pry.p2-1, pry.p2-4]
```
:::

## The residual stream {id=s3-3 outline=P1.3.md#3.3}

:::explain{id=column-image}
Each token gets its own list of 768 numbers, and that list travels up through all 12 layers. Every layer reads it and adds its own work into the same numbers. Nothing gets replaced, and a later addition can cancel an earlier one. That list is called the **residual stream**. Many of the tools you'll use later in Pry read it, split it up or change it, so you'll see the name again and again. :look{at=lesson:image:column-image}[The highlighted column] is ' Jordan''s residual stream.

```yaml
image: images/residual-column.svg
alt: "The same 12-layer picture with one column highlighted: ' Jordan''s list of numbers, rising from its embedding plus positional embedding through every layer, bottom to top."
```
:::

:::analogy
```yaml
like: "running notes that every layer adds to"
because: "each layer reads what's there so far and writes a bit more"
breaks: "there's one set of notes per token; additions mix into the same numbers instead of making the list longer; and nobody can read these numbers as words."
```
:::

:::question{id=how-many-numbers}
After `layer 6` adds its work, how many numbers are in that token's residual stream?

```yaml
choices:
  - { text: "768" }
  - { text: "768 × 6" }
  - { text: "more each time" }
model_answer: "768; additions mix in."
```
:::

## How the last token hears about Jordan {id=s3-4 outline=P1.3.md#3.4}

:::explain{id=last-column}
Look at the end of :look{at=token-strip}[the strip]: the last token is :look{at=token-chip text=" of" occurrence=last}[' of']. The picture now highlights the top of its column.

```yaml
image: images/last-token-column.svg
alt: "The 12-layer picture with the last column, ' of', highlighted, and the arrow from the top of that column to the chances for the next token highlighted too."
```
:::

:::predict{id=which-stream checks=which-stream-reveal}
Which token's residual stream gets turned into the chances for the next token?

```yaml
choices:
  - { text: "all tokens, averaged" }
  - { text: "the first" }
  - { text: "the last" }
  - { text: "whichever word matters most" }
```
:::

:::observe{id=which-stream-reveal}
It's the last one. Only the top of ' of''s residual stream turns into the chances. So anything about ' Jordan' that affects the guess has to get into ' of''s numbers somewhere on the way up.

```yaml
journal: true
```
:::

:::analogy
```yaml
like: "an assembly line where each station adds to the dish and never takes anything off"
because: "the dish that comes off the end carries everything every station put in"
breaks: "stations also draw from other tokens' dishes (that's how \" Jordan\" reaches \" of\"; lesson P2.1), and an addition can cancel an earlier one."
```
:::

:::simplification
How information crosses between tokens is part of a layer we meet in P2.1.

```yaml
corrected_in: [pry.p2-1]
```
:::

## Same last token, different guess {id=s3-5 outline=P1.3.md#3.5}

:::slots
jordan_bb: { read: compare.prediction, args: { side: a, token: " basketball" }, field: prob, format: probability, expect: 0.42208 }
jordan_fb: { read: compare.prediction, args: { side: a, token: " football" }, field: prob, format: probability, expect: 0.047189 }
brady_fb: { read: compare.prediction, args: { side: b, token: " football" }, field: prob, format: probability, expect: 0.48629 }
brady_bb: { read: compare.prediction, args: { side: b, token: " basketball" }, field: prob, format: probability, expect: 0.022681 }
:::

:::predict{id=same-chances checks=differ-obs}
In 'Michael Jordan played the sport of' and 'Tom Brady played the sport of', ' of' is the same token in the same position, so it starts with the same embedding plus positional embedding. Will its chances for the next token match?

```yaml
choices:
  - { text: "yes, same start, same chances", feedback: "The model went another way: same start for ' of', but ' basketball' gets {jordan_bb} in one and {brady_bb} in the other. The difference got added on the way up." }
  - { text: "no" }
```
:::

:::do{id=compare-athletes}
The lesson turns on :look{at=compare-panel}[Compare] and runs both sentences side by side.

```actions
- set_compare_mode: { on: true }
- set_compare: { a: "Michael Jordan played the sport of", b: "Tom Brady played the sport of" }
- run_compare: {}
```
:::

:::observe{id=differ-obs}
In :look{at=compare-panel}[Compare's next-token table], the A column is Jordan and the B column is Brady. After Jordan, ' basketball' gets {jordan_bb} and ' football' gets {jordan_fb}. After Brady, ' football' gets {brady_fb} and ' basketball' gets {brady_bb}. Same last token, same start, different chances at the top.

```yaml
check: { read: compare.top, args: { side: a }, op: equals, value: $read.compare.top, value_args: { side: b }, not: true }
```
:::

:::question{id=what-differed}
What made them differ, given the same start?

```yaml
free: true
model_answer: "work the layers added from earlier tokens"
```
:::

:::explain-result
```yaml
supports: "' of' started the same in both sentences and ended with different chances, so the difference got added on the way up, from the earlier tokens. This view only shows what changed, not why."
leaves_open: "Compare shows the two sets of chances side by side. It doesn't show where inside the model the difference came in."
tool: compare
```
:::

## Transfer {id=s5 outline=P1.3.md#5}

:::slots
tiger_golf: { read: prediction, args: { token: " golf" }, field: prob, format: probability, expect: 0.55911 }
:::

::::transfer{id=tiger}
```yaml
prompt: "Tiger Woods played the sport of"
expect_if_explanation_holds: "The guess changes again, because the layers add what they draw from ' Tiger' and ' Woods' into ' of''s residual stream on the way up."
limits: "One more prompt shows the guess moving with the athlete. It doesn't show which layer carried the name to ' of'."
```

:::predict{id=tiger-top checks=tiger-obs}
Change the athlete again: 'Tiger Woods played the sport of'. Top guess? Does ' of' still start with the same embedding plus positional embedding?

```yaml
free: true
```
:::

:::do{id=tiger-run}
Compare's off again, so the token strip is back. Type "Tiger Woods played the sport of" in the prompt box and press :look{at=run-button}[Run], then read :look{at=predictions-panel}[Predictions].

```actions
- set_compare_mode: { on: false }
```
:::

:::observe{id=tiger-obs}
' golf' comes out on top at {tiger_golf}. Look at the strip, though: "Tiger" got split into two tokens, 'T' and 'iger'. So ' of' moved one position, so its positional embedding changed too.

```yaml
check: { read: top_guess.token, op: equals, value: " golf" }
```
:::

::::

:::question{id=what-carried}
What carried 'Tiger Woods' to the last token?

```yaml
free: true
model_answer: "what the layers added to the last token's residual stream from earlier tokens"
```
:::

## Explain the chain {id=s6 outline=P1.3.md#6}

:::explain-chain
```yaml
prompt: "How does information about 'Michael Jordan' reach the guess at the end of the sentence?"
model_answer: "Each token starts as its embedding plus positional embedding, and that becomes its own residual stream. Twelve layers each read the residual streams and add to them, and some of what gets added to the last token comes from earlier tokens like ' Jordan'. The top of the last token's residual stream is turned into the chances for the next token."
```
:::
