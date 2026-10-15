---
format: 1
id: pry.p1-5
title: "Why doesn't it say the same thing every time?"
tool: pry
summary: "GPT-2 writes one token at a time, and the same prompt can still give different text. You'll see where the randomness comes in, and how temperature and the seed control it."
minutes: 10
stage: 1
targets: [M7, M6]
spine: [probabilities, sampling, append, repeat]
new_terms: [sampling, temperature, seed]
prerequisites: [pry.p1-4]
cold_entry: "What you need from before: for any prompt, GPT-2 gives every token in the vocabulary a probability for coming next, and those add up to 100%."
model: gpt2-small
baseline: { prompt: "Michael Jordan played the sport of" }
verified_rows: [1, 8, 28, 41, 43, 44]
limits: "Watch it write shows the picked token and the runner-up at each step. It doesn't show the paths other runs would take."
---

## Recall {id=s3-0 depth=optional outline=P1.5.md#3.0}

:::recall{id=recall-last}
Why this matters: that last token's chances are what the model picks from when it writes, one token at a time.

```yaml
from: pry.p1-3
question: "Which token's residual stream gets turned into the probabilities for the next token?"
choices:
  - { text: "first" }
  - { text: "last" }
  - { text: "all averaged" }
```
:::

## Whole reply, or one token at a time? {id=s3-1 outline=P1.5.md#3.1}

:::enter
prompt: "Michael Jordan played the sport of"
run: true
open_panel: watch-it-write
:::

:::slots
first_tok: { read: top_guess.token, format: string, expect: " basketball" }
first_p: { read: top_guess.prob, expect: 0.42208 }
:::

:::predict{id=whole-or-one checks=write-obs}
When GPT-2 writes a sentence, does it produce the whole thing at once, or one token at a time?

```yaml
choices:
  - { text: "whole sentence, planned first", target: M6 }
  - { text: "one token at a time" }
  - { text: "one word at a time" }
```
:::

:::do{id=write-zero}
The lesson writes on from the Jordan sentence in :look{at=watch-it-write}[Watch it write]. Step through it with :look{at=write-it-step}[its step buttons], one step at a time.

```actions
- set_prompt: { text: "Michael Jordan played the sport of" }
- highlight: { anchor: watch-it-write }
- write_it: { temperature: 0 }
```
:::

:::observe{id=write-obs}
Each step adds one token. Step 1 picked {first_tok}, the top token in Predictions at {first_p}, and every step after it does the same thing again: the model runs on the text so far, one token gets picked, and that token goes on the end. Each step also shows the runner-up, the token that'd have come second.

```yaml
journal: true
```
:::

:::analogy
```yaml
like: "laying track in front of a moving train"
because: "each new piece goes down just before it's needed"
breaks: "here the train also picks the next piece of track, one piece at a time."
```
:::

:::simplification
One token at a time is true of what comes out. What goes on inside can carry information about later tokens; there's an optional fold on that in P2.3.

```yaml
corrected_in: [pry.p2-3]
```
:::

:::explain-result
```yaml
supports: "GPT-2 wrote the continuation one token at a time: pick a token, put it on the end, run again. Nothing wrote the whole reply first."
leaves_open: "Watch it write shows the token picked at each step and the runner-up. It doesn't show what any other run would have picked."
tool: write-it
```
:::

## The rule that picks {id=s3-2 outline=P1.5.md#3.2}

:::explain
For a given prompt, the probabilities don't change from run to run. Something separate has to pick one token from them, and that rule is called **sampling**. Since the probabilities don't change, sampling's the only place any randomness can come in. Step back to step 1 in Watch it write and look at :look{at=write-it-step}[step 1's token and its probability].
:::

:::question{id=always-top}
Step 1 picked the top token. Does that mean it always will?

```yaml
choices:
  - { text: "yes, the top token always wins" }
  - { text: "it depends on how sampling is set" }
```
:::

## How random {id=s3-3 outline=P1.5.md#3.3}

:::explain
It depends on a setting. At 0, sampling won't take anything but the top token. Higher numbers make the probabilities less lopsided, so lower-ranked tokens get picked more often, and the text won't come out the same twice. That setting is called **temperature**, and it's the name Pry and plenty of other AI tools use for it. It's :look{at=write-it-temperature}[the Temperature control] in :look{at=watch-it-write}[Watch it write], and the line under it says what each value does.
:::

:::analogy
```yaml
like: "rolling weighted dice, which get less lopsided as temperature rises"
because: "a heavier side still comes up more, but not every time"
breaks: "at temperature 0 there's no roll at all, and the dice get re-weighted at every step."
```
:::

## Repeating a random run {id=s3-4 outline=P1.5.md#3.4}

:::do{id=seeded-run}
Randomness in a computer starts from a number. Keep that number, and you'll get the same "random" draws again. The number is called the **seed**: with the same prompt, temperature and seed, you get the same text back. The lesson writes at temperature 1 with seed 1. Find :look{at=write-it-seed}[the seed label and the "keep seed" box] in :look{at=watch-it-write}[Watch it write].

```actions
- write_it: { temperature: 1, seed: 1 }
```
:::

## Which runs match? {id=s3-5 outline=P1.5.md#3.5}

:::slots
text_a: { read: write_it.text, from_capture: a, format: string, expect: "Michael Jordan played the sport of basketball for the first time in his life in the 1980s. He was a member of the NBA" }
text_c: { read: write_it.text, from_capture: c, format: string, expect: "Michael Jordan played the sport of football in 1974. He did not return from the 1976 Olympics to Arizona, but he was Deacon" }
text_d: { read: write_it.text, from_capture: d, format: string, expect: "Michael Jordan played the sport of shot who cared about red as a kid or A-game for his team. Those days are gone" }
:::

:::predict{id=which-match checks=match-obs}
Four runs of the same prompt. Which will match? A: temperature 0. B: temperature 0 again. C: temperature 1, seed 1. D: temperature 1, seed 2.

```yaml
choices:
  - { text: "all four", target: M7 }
  - { text: "A and B only" }
  - { text: "A and B, and C and D differ" }
  - { text: "none" }
```
:::

:::do{id=run-a}
Run A: temperature 0.

```actions
- write_it: { temperature: 0 }
```

```yaml
capture: a
fresh: true
```
:::

:::do{id=run-b}
Run B: temperature 0 again.

```actions
- write_it: { temperature: 0 }
```

```yaml
capture: b
fresh: true
```
:::

:::do{id=run-c}
Run C: temperature 1, seed 1.

```actions
- write_it: { temperature: 1, seed: 1 }
```

```yaml
capture: c
fresh: true
```
:::

:::do{id=run-d}
Run D: temperature 1, seed 2.

```actions
- write_it: { temperature: 1, seed: 2 }
```

```yaml
capture: d
```
:::

:::compare{id=four-rows}
Here are :look{at=lesson:step:four-rows}[the four rows], A to D, top to bottom.

```yaml
columns:
  - { read: write_it.text, from: a }
  - { read: write_it.text, from: b }
  - { read: write_it.text, from: c }
  - { read: write_it.text, from: d }
```
:::

:::compare{id=marked}
```yaml
columns:
  - { view: text-diff, args: { a: a, b: b } }
  - { view: text-diff, args: { a: c, b: d } }
```
:::

:::do{id=run-e}
One more, E: temperature 1 and seed 1 again, the same settings as C.

```actions
- write_it: { temperature: 1, seed: 1 }
```

```yaml
capture: e
fresh: true
```
:::

:::observe{id=match-obs}
A and B match: {text_a}. C and D don't. C reads {text_c}, and D reads {text_d}. E matches C word for word, because it's got the same seed.

```yaml
check:
  - { read: write_it.text, from: a, op: equals, value: $capture.b.write_it.text }
  - { read: write_it.text, from: c, op: equals, value: $capture.e.write_it.text }
  - { read: write_it.text, from: c, op: equals, value: $capture.d.write_it.text, not: true }
```
:::

:::explain-result
:refutes[Lots of people expect the same question to get the same answer, and read variety as the model being broken. Same prompt in, same probabilities out, every time. The variety comes from sampling, on purpose.]

That's the last of the train track and the dice; from here on, sampling, temperature and seed.

```yaml
supports: "All five runs started from the same probabilities. At temperature 0 the text matched every time; at temperature 1 it matched only when the seed matched."
leaves_open: "Five runs show which settings repeat. They don't show how the probabilities themselves were worked out."
tool: write-it
```
:::

## Transfer {id=s5 outline=P1.5.md#5}

:::slots
baker_text: { read: write_it.text, format: string, expect: learner }
:::

::::transfer{id=baker}
```yaml
prompt: "Our quiet street was named for a baker who"
expect_if_explanation_holds: "At temperature 0 sampling always takes the top token, so the text can't wander off: if the top token leads back into words it's already written, it goes round again."
limits: "One prompt at temperature 0 shows what always taking the top token does here. It doesn't show what any other temperature would write."
```

:::predict{id=baker-next checks=baker-obs}
'Our quiet street was named for a baker who' at temperature 0. What happens over the next `16` tokens?

```yaml
choices:
  - { text: "a sensible little story" }
  - { text: "it repeats itself" }
  - { text: "it stops early" }
```
:::

:::do{id=baker-set}
The lesson puts the baker sentence in and runs it. The writing's up to you.

```actions
- set_prompt: { text: "Our quiet street was named for a baker who" }
- run: {}
```
:::

:::task{id=baker-write}
This one's yours, in the app: in Watch it write, drag :look{at=write-it-temperature}[Temperature] to 0 and press **Write it**. Then come back and press **Check my result**.

```yaml
target:
  - { read: write_it.text, op: contains, value: "a baker who was a great friend of mine" }
learner_actions: [write_it]
```
:::

:::observe{id=baker-obs}
Read what it wrote in :look{at=watch-it-write}[Watch it write] and hold it against your guess above.

```yaml
check: { read: write_it.text, op: contains, value: "a baker who was a great friend of mine" }
assert:
  - require: { slot: baker_text, op: contains, value: "great friend of mine. He was a great friend of mine" }
    say: "It goes \" was a great friend of mine. He was a great friend of mine,\" and on from there. It's repeating itself."
    else: "It didn't loop this time. Check Temperature reads 0, then write again."
```
:::

::::

:::explain
Always taking the top token tends to give dull, repetitive text, and that's one reason sampling usually runs above temperature 0. Researchers who studied this found the same thing at scale (Holtzman and colleagues, 2020).
:::

:::question{id=own-temperature}
Now pick a temperature yourself and write again. What changed?

```yaml
free: true
```
:::

:::question{id=why-loop}
Why does temperature 0 loop here?

```yaml
free: true
model_answer: "the top token keeps leading back into the same words, and at temperature 0 nothing else ever gets picked."
```
:::

## Explain the chain {id=s6 outline=P1.5.md#6}

:::explain-chain
```yaml
prompt: "How does GPT-2 write a whole sentence, and why can the same prompt give different text?"
model_answer: "GPT-2 writes one token at a time. It turns the prompt into probabilities, sampling picks one token, that token goes on the end, and the whole thing runs again. The probabilities for a given prompt never change. Temperature decides how random the pick is (at 0 it's always the top token), and the seed fixes the random draws, so a run with the same seed repeats exactly."
```
:::
