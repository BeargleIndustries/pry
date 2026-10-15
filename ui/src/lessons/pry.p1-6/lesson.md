---
format: 1
id: pry.p1-6
title: "Does it learn from you? Where did its numbers come from?"
tool: pry
summary: "GPT-2 in Pry won't remember you tomorrow. You'll see why using it never changes it, where its numbers came from, and why some famous text comes back word for word."
minutes: 12
stage: 1
targets: [M3, M11, M2]
spine: [training]
new_terms: [weights, activations]
prerequisites: [pry.p1-5]
cold_entry: "What you need from before: GPT-2 is a fixed file of numbers that turns a prompt into probabilities for the next token; sampling picks one."
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 8, 9, 10, 28, 29]
---

## Recall {id=s3-0 depth=optional outline=P1.6.md#3.0}

:::recall{id=recall-one}
Why this matters: if nothing checks the sum, the next question is where those numbers came from in the first place.

```yaml
from: pry.p1-4
question: "Why did ' one' beat ' four' for 'Two plus two equals'?"
choices:
  - { text: "a bug" }
  - { text: "a probability is about what text tends to follow, and nothing checks the sum" }
  - { text: "it was lying" }
```
:::

## Will it remember you? {id=s3-1 outline=P1.6.md#3.1}

:::predict{id=remember-you checks=sam-obs}
If you tell GPT-2 in Pry your name today, will it still have it tomorrow?

```yaml
choices:
  - { text: "yes, it learns from what you type", target: M3, feedback: "Lots of people expect that, and some chat products do keep notes about you between chats. The model in Pry has nowhere to keep anything: the second prompt shows no trace of Sam, and the Jordan numbers are the ones you saw in lesson 1." }
  - { text: "only while Pry stays open", feedback: "Lots of people expect that, and some chat products do keep notes about you between chats. The model in Pry has nowhere to keep anything: the second prompt shows no trace of Sam, and the Jordan numbers are the ones you saw in lesson 1." }
  - { text: "no" }
```
:::

## Same text, then gone {id=s3-2 outline=P1.6.md#3.2}

:::slots
basketball: { read: prediction, args: { token: " basketball" }, field: prob, format: probability, expect: 0.42208 }
sam_a: { read: compare.prediction, args: { side: a, token: " Sam" }, field: prob, format: probability, expect: 0.19151 }
:::

:::do{id=sam-compare}
The lesson runs two prompts side by side in :look{at=compare-panel}[Compare]. The first one tells the model a name, and the second one doesn't.

```actions
- set_compare_mode: { on: true }
- set_compare: { a: "My name is Sam. Nice to meet you. My name is", b: "Nice to meet you. My name is" }
- run_compare: {}
```
:::

:::observe{id=sam-obs}
' Sam' gets {sam_a} in the first prompt, where the name is right there in the text. In the second prompt, a separate run, ' Sam' isn't in the top ten at all.

```yaml
check:
  - { read: compare.prediction, args: { side: a, token: " Sam" }, field: rank, op: lt, value: 11, expect: 1 }
  - { read: compare.prediction, args: { side: b, token: " Sam" }, field: rank, op: lt, value: 11, not: true, expect: absent }
```
:::

:::explain-result
```yaml
supports: "Earlier text in the same prompt raised ' Sam'. A separate run carried none of it over. This view only shows what changed, not why."
leaves_open: "It shows the two sets of probabilities. It doesn't show why ' Sam' rose."
tool: compare
```
:::

:::do{id=jordan-again}
Now the Jordan sentence from lesson 1, on its own. Read :look{at=predictions-panel}[Predictions].

```actions
- set_compare_mode: { on: false }
- set_prompt: { text: "Michael Jordan played the sport of" }
- run: {}
- open_panel: { panel: predictions }
```
:::

:::explain
' basketball' gets {basketball}, the same number lesson P1.1 showed, however long ago that was. Try it yourself if you like: close Pry, open it again and run the Jordan prompt. Still {basketball}.
:::

## The fixed numbers {id=s3-3 outline=P1.6.md#3.3}

:::explain
The numbers in the model's file were set during training, and using the model never changes them. They're called the **weights**, or the parameters: when people say a model has so many parameters, these are what they're counting. :look{at=lesson:spine box=training}[The spine strip] lights the training bracket around them.

Same prompt in, same numbers out.
:::

:::analogy
```yaml
like: "a calculator that doesn't remember yesterday's sums"
because: "you can use it all day and it's the same calculator tomorrow"
breaks: "earlier text in the *same* prompt does change the answer, as \" Sam\" just showed."
```
:::

:::explain-result
```yaml
supports: "Running the model reads the weights and never writes them, so nothing you type stays in it. The Jordan numbers match lesson 1 because the weights haven't moved."
leaves_open: "Pry can show that the weights stay put while you use it. It can't show how training set them; that part is a picture."
tool: predictions
```
:::

## The fresh numbers {id=s3-4 outline=P1.6.md#3.4}

:::explain
Everything else gets worked out fresh on every run: each token's residual stream, the logits at the top, the probabilities in :look{at=predictions-panel}[Predictions]. Those fresh numbers are called **activations**, as opposed to the weights. Everything Pry's tools measure is activations.

The weights never change; the activations are computed fresh each run.
:::

:::question{id=what-changed}
When you ran 'My name is Sam...', what changed: the weights, the activations, or both?

```yaml
choices:
  - { text: "the weights" }
  - { text: "the activations" }
  - { text: "both" }
model_answer: "the activations only."
```
:::

## How training set the weights {id=s3-5 outline=P1.6.md#3.5}

:::question{id=who-decided}
Who decided ' basketball' should follow 'Michael Jordan played the sport of'?

```yaml
choices:
  - { text: "an engineer", target: M11 }
  - { text: "nobody: training nudged numbers until guesses like that scored well" }
  - { text: "a list of facts" }
```
:::

:::explain{id=training-image}
Here's training as a loop. Take a piece of real text, have the model guess the next token, compare the guess with what really came next, then nudge every weight a little toward a better guess. Do that again, billions of times. :look{at=lesson:image:training-image}[The picture] shows the loop.

:refutes[Nobody wrote the rules. There aren't any rules in the file, only weights.]

```yaml
image: images/training-loop.svg
alt: "A loop of four boxes joined by arrows: 1. Guess the next token of real text. 2. Compare with what really came next. 3. Nudge every weight a little. 4. Repeat, billions of times. In the middle: training happened once, before you ever ran it, and using the model never runs this loop."
```
:::

:::analogy
```yaml
like: "practising with an answer key: guess, check, adjust"
because: "you get better at guessing by checking every guess against the real answer"
breaks: "no reasons get learned, and each nudge is tiny and automatic; nobody marks the answers."
```
:::

:::simplification
Chat assistants get a second round of training on example conversations and people's ratings. GPT-2 only had this one.

```yaml
corrected_in: [pry.p4-1]
```
:::

## No database, some memory {id=s3-6 outline=P1.6.md#3.6}

:::analogy
```yaml
like: "a lossy zip of a huge library"
because: "it squeezes huge amounts of text into a much smaller file, and you can't get every word back out"
breaks: "some text comes back almost exactly, and you can't search it like an index."
```
:::

:::explain
:refutes[No database, but some memorisation. Training doesn't keep a copy of the text you could search. Text the model saw many times, though, can come back nearly word for word.]

That's the last of the training pictures; from here on, weights and activations.
:::

## Transfer {id=s5 outline=P1.6.md#5}

::::transfer{id=openings}
```yaml
prompt: "The MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy"
expect_if_explanation_holds: "Text that probably appeared many times in training comes back closely, maybe word for word. Text made up for this lesson can't, so it gets a generic continuation."
limits: "Three openings show what GPT-2 reproduces at temperature 0. They don't show how often any text appeared in training."
```

:::predict{id=which-exact checks=openings-obs}
Three openings, temperature 0. Which will GPT-2 continue exactly as the real text goes? (a) The MIT License's opening, (b) the Declaration of Independence's opening, or (c) "Our quiet street was named for a baker who" (made up for this lesson).

```yaml
choices:
  - { text: "a only" }
  - { text: "b only" }
  - { text: "a and b" }
  - { text: "all three", target: M2 }
  - { text: "none" }
```
:::

:::do{id=write-mit}
First, the opening of the MIT License, a software licence copied into a huge number of projects. The lesson runs it, then writes on at temperature 0.

```actions
- set_prompt: { text: "The MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy" }
- run: {}
- write_it: { temperature: 0 }
```

```yaml
capture: mit
```
:::

:::do{id=write-decl}
Next, the opening of the US Declaration of Independence.

```actions
- set_prompt: { text: "We hold these truths to be self-evident, that all men are" }
- run: {}
- write_it: { temperature: 0 }
```

```yaml
capture: decl
```
:::

:::do{id=write-baker}
Last, the baker sentence from lesson P1.5, which nobody wrote before this lesson.

```actions
- set_prompt: { text: "Our quiet street was named for a baker who" }
- run: {}
- write_it: { temperature: 0 }
```

```yaml
capture: baker
```
:::

:::observe{id=openings-obs}
The licence comes back word for word: " of this software and associated documentation files (the "Software"), to deal in the". The Declaration comes back close: " created equal, that every man is endowed by his Creator with certain unalienable". The real text says "that they are endowed by their Creator". The baker sentence gets " was a great friend of mine", then loops.

```yaml
check:
  - { read: write_it.text, from: mit, op: contains, value: "obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the" }
  - { read: write_it.text, from: decl, op: contains, value: "all men are created equal, that every man is endowed by his Creator" }
  - { read: write_it.text, from: baker, op: contains, value: "a baker who was a great friend of mine" }
```
:::

::::

:::compare{id=against-real}
```yaml
columns:
  - { read: write_it.text, from: mit }
  - { text: " of this software and associated documentation files (the \"Software\"), to deal in the" }
  - { read: write_it.text, from: decl }
  - { text: "that they are endowed by their Creator" }
  - { read: write_it.text, from: baker }
```
:::

:::compare{id=marked}
```yaml
columns:
  - { view: text-diff, args: { a: mit, text: " of this software and associated documentation files (the \"Software\"), to deal in the" } }
  - { view: text-diff, args: { a: decl, text: "that they are endowed by their Creator" } }
  - { text: "Read each one against the real text beside it: the licence matches, and the Declaration swaps \"they are\" and \"their\" for \"every man is\" and \"his\"." }
```
:::

:::explain-result
```yaml
supports: "The licence came back word for word and the Declaration nearly, while the made-up sentence got a generic loop. So the weights can reproduce text that's common in training, without any stored copy to look it up in."
leaves_open: "A word-for-word match shows GPT-2 reproduces this text. It doesn't show how often the text appeared in training, which Pry can't see."
tool: write-it
```
:::

:::question{id=why-exact}
Why does the license come back exact and the Declaration only nearly?

```yaml
free: true
model_answer: "text that showed up many times in training can be reproduced closely; the weights hold patterns, not a stored copy, so some comes back slightly altered, and new text gets generic continuations."
```
:::

## Explain the chain {id=s6 outline=P1.6.md#6}

:::explain-chain
```yaml
prompt: "Where did GPT-2's numbers come from, and why won't it remember you tomorrow?"
model_answer: "Training set the weights earlier: billions of guesses at the next token of real text, with every weight nudged a little after each batch. Nobody wrote rules. Using the model only reads the weights; each run computes fresh activations and throws them away, so nothing I type gets saved. Text that probably appeared many times in training, like the MIT License, can come back word for word, but there's no database to search."
```
:::
