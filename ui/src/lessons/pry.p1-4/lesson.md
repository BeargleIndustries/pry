---
format: 1
id: pry.p1-4
title: "Is the top guess the right answer?"
tool: pry
summary: "GPT-2 says ' one' after 'Two plus two equals'. You'll read Predictions as probabilities and logits, and see why a fluent wrong answer isn't a lie or a glitch."
minutes: 10
stage: 1
targets: [M10, M8, T1]
spine: [residual-stream, logits, probabilities]
new_terms: [probability, logit, hallucination]
prerequisites: [pry.p1-3]
cold_entry: "What you need from before: the last token's residual stream, after 12 layers, gets turned into a chance for every token in the vocabulary."
model: gpt2-small
baseline: { prompt: "Two plus two equals" }
verified_rows: [3, 4, 5]
slots:
  one_p: { read: prediction, args: { token: " one" }, field: prob, format: probability, expect: 0.34206 }
  two_p: { read: prediction, args: { token: " two" }, field: prob, format: probability, expect: 0.16224 }
  four_p: { read: prediction, args: { token: " four" }, field: prob, format: probability, expect: 0.069509 }
  three_p: { read: prediction, args: { token: " three" }, field: prob, format: probability, expect: 0.068916 }
  top_four: { from: [one_p, two_p, four_p, three_p], formula: sum, format: probability }
  rest: { read: rest_mass, expect: 0.24460 }
---

## Recall {id=s3-0 depth=optional outline=P1.4.md#3.0}

:::recall{id=recall-pieces}
Why this matters: common text gets short, familiar tokens, and this lesson asks whether the top guess follows what's common or what's true.

```yaml
from: pry.p1-2
question: "Why is ' unbelievable' one token and ' Leclerc' three?"
choices:
  - { text: "long words get split" }
  - { text: "common words stay whole, rare ones get built from pieces" }
  - { text: "names always split" }
```
:::

## Two plus two {id=s3-1 outline=P1.4.md#3.1}

:::enter
prompt: "Two plus two equals"
:::

:::explain
:look{at=prompt-input}[The prompt box] says "Two plus two equals". You know the answer. It hasn't run yet, so make your call before GPT-2 makes its own.
:::

:::predict{id=top-sum checks=one-obs}
What will GPT-2 put on top?

```yaml
choices:
  - { text: "\" four\"", target: M8, feedback: "The model went another way: ' one' got {one_p}, and your pick ' four' got {four_p}. A probability is about what text tends to follow, not what's true." }
  - { text: "\" one\"", feedback: "That's what happened: ' one' on top at {one_p}, and ' four' back at {four_p}. Why would that be?" }
  - { text: "\" two\"" }
  - { text: "something else" }
```
:::

:::predict{id=top-share checks=one-obs}
How much of the 100% will the top token get?

```yaml
choices:
  - { text: "under 10%" }
  - { text: "10-50%" }
  - { text: "over 50%", target: T1 }
```
:::

## It says " one" {id=s3-2 outline=P1.4.md#3.2}

:::do{id=run-sum}
The lesson runs it and opens Predictions.

```actions
- run: {}
- open_panel: { panel: predictions }
```
:::

:::observe{id=one-obs}
Read the bars in :look{at=predictions-panel}[Predictions], then look at :look{at=everything-else-row}[the everything-else row] at the bottom.

```yaml
check:
  - { read: top_guess.token, op: equals, value: " one" }
  - { read: prediction, args: { token: " four" }, op: contains, value: { rank: 3 }, expect: { rank: 3 } }
```
:::

:::explain
' one' gets {one_p}. ' two' gets {two_p}, ' four' gets {four_p} and ' three' gets {three_p}. Those four hold {top_four} between them. Everything outside the top ten holds {rest}. So the top token isn't the right answer, and even it doesn't get anywhere near all of the 100%.
:::

## What the percentages are {id=s3-3 outline=P1.4.md#3.3}

:::slots
shape: { read: shape, expect: "few" }
:::

:::explain
Each percentage says how likely that token is to come next as a continuation of this text, and across the whole vocabulary they add up to 100%. That's called a **probability**, and the whole spread across the vocabulary is the probability distribution. Every number in Predictions is one, and they're about text, not truth. Pry's one-word summary of this spread is {shape}. Look at :look{at=prediction-bar token=" one"}[a bar], then at :look{at=everything-else-row}[the everything-else row].

Each bar's length is its probability on a 0-100% scale. The 'everything else' row is the rest.

```yaml
assert:
  - require: { slot: shape, op: equals, value: "few" }
    say: "'few' means no single token gets over half, though the top ten together do."
    else: "Read the bars to see how it's spread this time."
```
:::

:::analogy
```yaml
like: "a weather forecast's \"70% chance of rain\""
because: "it gives every outcome a chance instead of one flat answer"
breaks: "a forecast gets checked against the weather; these get checked against nothing. They describe what text tends to follow."
```
:::

:::explain-result
```yaml
supports: "Predictions is a probability distribution over the next token: ' one' gets the biggest share, the rest is spread across other tokens, and none of it says which answer is true."
leaves_open: "These are probabilities for the next token only. They don't say what's true, and they don't show how the model got them."
tool: predictions
```
:::

## The raw scores underneath {id=s3-4 outline=P1.4.md#3.4}

:::explain
Before they're probabilities, the numbers start as raw scores. Every token in the vocabulary gets one at the top of the last token's residual stream, and a bigger score means a bigger probability. That score is called a **logit**. Plenty of the tools in later lessons measure in logits, so it's worth knowing where to find them: click :look{at=prediction-bar token=" one"}[the ' one' bar] to see its logit.
:::

::::fold{title="How do scores become probabilities?"}

:::explain
The step that turns logits into probabilities that add up to 100% is called softmax.
:::

::::

:::predict{id=bigger-logit checks=bigger-obs}
Now click :look{at=prediction-bar token=" one"}[' one'] and :look{at=prediction-bar token=" four"}[' four'] and compare their logits. Which is bigger?

```yaml
choices:
  - { text: "\" one\"" }
  - { text: "\" four\"" }
```
:::

:::observe{id=bigger-obs}
' one''s logit is bigger, and so is its probability. The order of the logits is the order of the bars.

```yaml
check: { read: prediction, args: { token: " one" }, field: logit, op: gt, value: $read.prediction, value_args: { token: " four" }, value_field: logit }
```
:::

## A near-tie {id=s3-5 outline=P1.4.md#3.5}

:::slots
paris: { read: prediction, args: { token: " Paris" }, field: prob, format: probability, expect: 0.097184 }
marse: { read: prediction, args: { token: " Marse" }, field: prob, format: probability, expect: 0.089123 }
saint: { read: prediction, args: { token: " Saint" }, field: prob, format: probability, expect: 0.030925 }
st: { read: prediction, args: { token: " St" }, field: prob, format: probability, expect: 0.027857 }
city_four: { from: [paris, marse, saint, st], formula: sum, format: probability }
paris_lead: { from: [paris, marse], formula: difference, format: probability }
:::

:::predict{id=paris-half checks=paris-obs}
For 'The capital of France is the city of', will ' Paris' get more than half?

```yaml
choices:
  - { text: "yes" }
  - { text: "no" }
```
:::

:::do{id=run-city}
The lesson runs lesson 1's near-tie again. Read :look{at=predictions-panel}[Predictions].

```actions
- set_prompt: { text: "The capital of France is the city of" }
- run: {}
```
:::

:::observe{id=paris-obs}
' Paris' gets {paris} and ' Marse' gets {marse}. ' Saint' gets {saint} and ' St' gets {st}. The top four together hold {city_four}, and everything else, spread thin across thousands of tokens, holds what's left. ' Paris' leads ' Marse' by {paris_lead}.

```yaml
check: { read: prediction, args: { token: " Paris" }, op: contains, value: { rank: 1 }, expect: { rank: 1 } }
assert:
  - require: { slot: paris_lead, op: lt, value: 0.02 }
    say: "So ' Paris' barely leads."
    else: "So ' Paris' leads."
```
:::

:::question{id=whats-same}
In both prompts, what's true of the top token?

```yaml
choices:
  - { text: "it holds well under half, and plenty of the 100% sits elsewhere" }
  - { text: "it's the right answer, and it gets nearly all of the 100%" }
```
:::

:::analogy
```yaml
like: "betting odds on every horse in a race"
because: "every horse gets a price, and the favourite can still be a long way from certain"
breaks: "nobody's betting, and the odds aren't about who should win."
```
:::

## A fluent wrong answer {id=s3-6 outline=P1.4.md#3.6}

:::question{id=why-one}
Why did ' one' beat ' four'?

```yaml
choices:
  - { text: "GPT-2 was built to be bad at sums", target: M10 }
  - { text: "a bug", target: M10 }
  - { text: "the same process that put ' basketball' on top gave ' one' the higher probability here, and nothing checks the sum" }
```
:::

:::explain-result
' one' is a fluent wrong answer, and it came from the same process as a right one. That's called a **hallucination**. It's the word people use for chatbots' made-up answers, and it comes back in lesson P4.1. :look{at=predictions-panel}[Predictions] still shows it.

:refutes[Lots of people read a wrong answer as a lie or a glitch. A lie needs someone aiming to mislead, and nothing in here aims at anything. A glitch would be a bug, and this is the same arithmetic that put ' basketball' on top in lesson 1.]

From here on we'll drop the keyboard, improviser, weather and betting pictures and talk about probabilities and logits directly.

```yaml
supports: "' one' won because its logit came out highest for this text, by the same arithmetic that puts right answers on top. Nothing in the process checks the sum."
leaves_open: "Predictions shows which tokens got which probabilities. It doesn't show why ' one' got the bigger logit."
tool: predictions
```
:::

## Transfer {id=s5 outline=P1.4.md#5}

:::slots
brains: { read: prediction, args: { token: " brains" }, field: prob, format: probability, expect: 0.12701 }
energy: { read: prediction, args: { token: " energy" }, field: prob, format: probability, expect: 0.11460 }
body: { read: prediction, args: { token: " body" }, field: prob, format: probability, expect: 0.10270 }
bodies: { read: prediction, args: { token: " bodies" }, field: prob, format: probability, expect: 0.072989 }
myth_four: { from: [brains, energy, body, bodies], formula: sum, format: probability }
:::

::::transfer{id=myth}
```yaml
prompt: "Humans only use ten percent of their"
expect_if_explanation_holds: "If probabilities describe what text tends to follow, the model carries the myth on, because lots of text repeats it, and no single token gets anywhere near all of the 100%."
limits: "One prompt shows how the probability spreads for this sentence. It doesn't show what the model would do with a prompt that pushes back."
```

:::predict{id=myth-push checks=myth-obs}
'Humans only use ten percent of their'. Will GPT-2 continue the myth, or push back on it?

```yaml
choices:
  - { text: "continue it" }
  - { text: "push back" }
  - { text: "neither" }
```
:::

:::predict{id=myth-half checks=myth-obs}
Will the top token get over `50%`?

```yaml
choices:
  - { text: "yes" }
  - { text: "no" }
```
:::

:::do{id=myth-set}
The lesson puts the sentence in the box. Press :look{at=run-button}[Run], then look at :look{at=predictions-panel}[Predictions].

```actions
- set_prompt: { text: "Humans only use ten percent of their" }
```
:::

:::observe{id=myth-obs}
' brains' gets {brains}, ' energy' gets {energy}, ' body' gets {body} and ' bodies' gets {bodies}. The top four hold {myth_four} together. It's a popular myth, carried on fluently, with the probability spread over four close options.

```yaml
check: { read: top_guess.prob, op: lt, value: 0.5, expect: 0.12701 }
```
:::

::::

:::question{id=myth-true}
If the ten-percent claim were true, would these probabilities need to look any different?

```yaml
choices:
  - { text: "yes" }
  - { text: "no" }
model_answer: "no: they describe text, not truth."
```
:::

## Explain the chain {id=s6 outline=P1.4.md#6}

:::explain-chain
```yaml
prompt: "How does GPT-2 end up putting ' one' on top for 'Two plus two equals', and why isn't that a lie or a glitch?"
model_answer: "The last token's residual stream is turned into a logit for every token in the vocabulary, and the logits are turned into probabilities that add up to 100%. A probability says how likely a token is as a continuation of the text, not whether it's true. ' one' got the most, but only about 1 in 3, and nothing in the process checks the sum. A hallucination comes from the same process as a right answer."
```
:::
