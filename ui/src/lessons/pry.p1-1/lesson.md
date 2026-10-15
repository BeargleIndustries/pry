---
format: 1
id: pry.p1-1
title: "Is there a database in there?"
tool: pry
summary: "Where does GPT-2's next word come from? You'll run a sentence, read the chances it gives every next word, and see why nothing gets looked up."
minutes: 10
stage: 1
targets: [M1, M2, M11]
spine: [text, probabilities, training]
new_terms: [language model, training, interpretability]
prerequisites: []
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 2, 3, 40, 41]
slots:
  basketball: { read: prediction, args: { token: " basketball" }, field: prob, format: probability, expect: 0.42208 }
  football: { read: prediction, args: { token: " football" }, field: prob, format: probability, expect: 0.047189 }
  golf: { read: prediction, args: { token: " golf" }, field: prob, format: probability, expect: 0.041474 }
  the_jordan: { read: prediction, args: { token: " the" }, field: prob, format: probability, expect: 0.021034 }
  top_four: { from: [basketball, football, golf, the_jordan], formula: sum, format: probability }
  rest: { read: rest_mass, expect: 0.37020 }
---

## Commit to a picture {id=s3-1 outline=P1.1.md#3.1}

:::enter
prompt: "Michael Jordan played the sport of"
:::

:::explain
:look{at=prompt-input}[The prompt box] has a sentence in it: "Michael Jordan played the sport of". It hasn't run yet. Before it does, you'll make a call about what's going to happen when it runs.
:::

:::simplification
"The next word" is a simplification here. The model doesn't quite read words, and the next lesson shows what it reads.

```yaml
corrected_in: [pry.p1-2]
```
:::

:::predict{id=picture checks=top-is-basketball}
GPT-2 is about to finish this sentence. Where will its next word come from?

```yaml
choices:
  - { text: "It searches the internet for the answer.", target: M1 }
  - { text: "It finds the sentence in a stored table of facts.", target: M2 }
  - { text: "Someone programmed sports facts into it.", target: M11 }
  - { text: "It gives every possible next word a score, using numbers it already has.", feedback: "That's what happened: ' basketball' came out on top at {basketball}. Look at what comes next: ' football', ' golf'. Why sports?" }
  - { text: "Something else" }
free: true
on_skip: "No answer saved. You'll see the result next."
```
:::

## Run it {id=s3-2 outline=P1.1.md#3.2}

:::do{id=run-jordan}
Press Run, or let the lesson press it. Watch :look{at=run-button}[Run] while it works.

```actions
- run: {}
- open_panel: { panel: predictions }
```
:::

:::observe{id=top-is-basketball}
The bars are in :look{at=predictions-panel}[Predictions]. Each bar is one possible next word, and its length is that word's chance, all on the same fixed scale.

```yaml
check: { read: top_guess.token, op: equals, value: " basketball" }
```
:::

:::explain
" basketball" gets {basketball}. After it come " football" at {football}, " golf" at {golf} and " the" at {the_jordan}. Those four together hold {top_four}. The rest is spread thin: the panel's "everything else" row, every word outside the top ten, holds {rest}. So the model doesn't hand back one answer. It hands back a chance for every word it could say next.

```yaml
assert:
  - require: { slot: basketball, op: gt, value: 0.3 }
    say: "Here one of them is far out in front."
    else: "Here the top word leads the others."
```
:::

## No search, no table {id=s3-3 outline=P1.1.md#3.3}

:::explain
:refutes[Lots of people expect a search or a table. It's what you'd see if the model looked things up, and some chat products really do run a web search and paste the results in. GPT-2 in Pry has nothing like that: it ran on your computer, and nothing went out to compute it.]

What ran is a file of numbers that sits on your disk. It turns your text into a score for every possible next word, then turns the scores into the chances in :look{at=predictions-panel}[Predictions]. A fixed file of numbers that does that is called a **language model**. GPT-2 is one, and so is whatever sits underneath ChatGPT and its cousins, so it's the name you'll hear everywhere.
:::

:::analogy
```yaml
like: "your phone keyboard's next-word suggestions, scaled way up"
because: "both offer likely next words from what came before"
breaks: "it uses your whole prompt, not just the last word or two, and nobody wrote its numbers by hand."
```
:::

:::do{id=offline-run}
Optional: turn off your internet and press Run again. You'll get the same numbers.

```actions
- run: {}
```

```yaml
fresh: true
```
:::

:::explain-result
```yaml
supports: "The chances came from the language model's own numbers, worked out on your computer. Nothing got searched and no table got read."
leaves_open: "These are the chances for the next word only, for this exact prompt. They don't show how the numbers produced them."
tool: predictions
```
:::

## Where the numbers came from {id=s3-4 outline=P1.1.md#3.4}

:::question{id=why-sports}
Why are the next few guesses also sports?

```yaml
choices:
  - { text: "someone listed sports next to athletes' names" }
  - { text: "text that mentions athletes tends to mention sports, and the numbers were shaped by lots of text" }
  - { text: "it searched for \"Michael Jordan\"" }
```
:::

:::explain
Nobody typed "Jordan goes with basketball" anywhere. The numbers were set earlier, by showing the model a huge amount of real text and nudging every number, over and over, toward better guesses at the next word. That's called **training**. It's the only time the numbers change, and lesson P1.6 covers it properly. :look{at=lesson:spine box=training}[The spine strip] lights its "training set these numbers" box.

:refutes[So there's no rule about Jordan in the file. There are only numbers, and text about athletes tends to mention sports, so the numbers ended up favouring sports words.]
:::

## Why we can look inside this one {id=s3-5 outline=P1.1.md#3.5}

:::do{id=tab-row}
Look at :look{at=left-tab-strip}[the left panel's tab row]. Each tab measures something different about the same run.

```actions
- highlight: { anchor: left-tab-strip }
```
:::

:::explain
Pry exists to measure what goes on inside a model. GPT-2 small is small, open and well studied, which is why lessons use it. It's also plain: no chat training, no search and no tools. Measuring what goes on inside a model, to find out how it got to its guess, is called **interpretability**. It's the research field Pry's tools come from, and the word you'd search for to read more.
:::

:::analogy
```yaml
like: "a microscope"
because: "you point it at something too small to see and measure what's there"
breaks: "a microscope lets you see the cells themselves; Pry shows measurements of it, and some of them are rough."
```
:::

:::question{id=measure-first}
If you wanted to know why ' basketball' won, what would you want to measure first?

```yaml
free: true
```
:::

## Transfer {id=s5 outline=P1.1.md#5}

::::transfer{id=france}
```yaml
prompt: "The capital of France is"
expect_if_explanation_holds: "If the model looked facts up, ' Paris' would win easily. If it continues text, the top word could be anything that tends to follow these words."
limits: "One prompt shows how the chances spread for this sentence only. It doesn't show why each word got its score."
```

:::predict{id=france-top checks=france-obs}
What's the top next word?

```yaml
choices:
  - { text: "\" Paris\"", feedback: "The model went another way: ' now' came out on top with just {now}, and ' Paris' isn't in the top four. If the model looked facts up, ' Paris' would win easily. It continues text, and lots of different text could follow these words." }
  - { text: "\" the\"" }
  - { text: "\" now\"" }
  - { text: "something else" }
```
:::

:::do{id=run-france}
The lesson puts the new sentence in and runs it. Read the result in :look{at=predictions-panel}[Predictions].

```actions
- set_prompt: { text: "The capital of France is" }
- run: {}
```

```yaml
capture: france
```
:::

:::observe{id=france-obs}
```yaml
check: { read: top_guess.token, from: france, op: equals, value: " now" }
```
:::

::::

:::slots
now: { read: prediction, args: { token: " now" }, field: prob, format: probability, from_capture: france, expect: 0.047506 }
the_france: { read: prediction, args: { token: " the" }, field: prob, format: probability, from_capture: france, expect: 0.037447 }
a_france: { read: prediction, args: { token: " a" }, field: prob, format: probability, from_capture: france, expect: 0.035461 }
home: { read: prediction, args: { token: " home" }, field: prob, format: probability, from_capture: france, expect: 0.030921 }
paris: { read: prediction, args: { token: " Paris" }, field: prob, format: probability, expect: 0.097184 }
marse: { read: prediction, args: { token: " Marse" }, field: prob, format: probability, expect: 0.089123 }
paris_lead: { from: [paris, marse], formula: difference, format: probability }
:::

:::explain
" now" gets {now}, " the" gets {the_france}, " a" gets {a_france} and " home" gets {home}. A sentence like "The capital of France is" turns up in lots of different text, and plenty of it doesn't go on to name a city ("...is now home to", "...is a short train ride away"), so the chance gets shared out.

```yaml
assert:
  - require: { slot: now, op: lt, value: 0.1 }
    say: "None of the top four is far ahead."
    else: "' now' leads the rest."
```
:::

:::analogy
```yaml
like: "a well-read improviser finishing your sentence"
because: "it carries on in a way that fits what came before"
breaks: "there's no person in there, and nothing in it aims at being true."
```
:::

:::do{id=city-of}
Now add three words and run it again, to see what happens when the text points at a city.

```actions
- set_prompt: { text: "The capital of France is the city of" }
- run: {}
```
:::

:::explain
" Paris" gets {paris} and " Marse" (the start of Marseille) gets {marse}, a gap of {paris_lead}. Lesson P1.4 comes back to this one.

```yaml
assert:
  - require: { slot: paris_lead, op: lt, value: 0.02 }
    say: "' Paris' leads, barely."
    else: "' Paris' leads."
```
:::

:::question{id=city-why}
Why did adding 'the city of' bring ' Paris' up?

```yaml
choices:
  - { text: "it searched this time" }
  - { text: "the new words changed the text being continued, so the scores changed" }
  - { text: "someone fixed a bug" }
model_answer: "the new words changed the text being continued, so the scores changed"
```
:::

## Explain the chain {id=s6 outline=P1.1.md#6}

:::explain-chain
```yaml
prompt: "In two or three sentences: where did ' basketball' come from, and why didn't ' Paris' win for 'The capital of France is'?"
model_answer: "GPT-2 is a language model: a fixed file of numbers that training set by showing it lots of text. It turns a prompt into a chance for every possible next word, right on my computer. Nothing gets looked up, so ' basketball' wins because of how text about Jordan tends to go, and ' Paris' loses because 'The capital of France is' can go lots of ways."
```
:::
