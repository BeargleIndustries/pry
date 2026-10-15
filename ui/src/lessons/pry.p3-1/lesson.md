---
format: 1
id: pry.p3-1
title: "Did the change cause it?"
tool: pry
summary: "Change one word, watch what moves, and find out why a difference between two runs isn't a cause yet."
minutes: 10
stage: 3
targets: [T6, N7]
spine: [logits, probabilities]
new_terms: [correlation, minimal pair]
prerequisites: [pry.p1-6, pry.p2-4]
cold_entry: "Two things from before. A probability is the share of the next-token chances one token gets, and it comes from the token's logit, the raw score the model gives it before the scores turn into chances (P1.4). And there's no randomness in those scores: same prompt in, same numbers out (P1.6)."
model: gpt2-small
baseline: { prompt: "The nurse said that" }
verified_rows: [14, 17, 27, 31, 56]
---

## Recall {id=s3-1 depth=optional outline=P3.1.md#3.1}

:::recall{id=recall-dla}
```yaml
from: pry.p2-4
question: "DLA showed which parts pushed ' Mary' over ' John' directly. Did that show those parts caused ' Mary' to win?"
free: true
```
:::

## How does ' she' move? {id=s3-2 outline=P3.1.md#3.2}

:::slots
she_nurse: { read: prediction, args: { token: " she" }, field: prob, format: probability, expect: 0.1896977424621582, tolerance: 0.02 }
she_doctor: { read: compare.prediction, args: { side: b, token: " she" }, field: prob, format: probability, expect: 0.04582584276795387, tolerance: 0.02 }
:::

:::do{id=nurse-ensure}
Run `The nurse said that` and look at :look{at=predictions-panel}[Predictions]. Find :look{at=prediction-bar token=" she"}[' she'] near the top. Pry runs it for you if you haven't yet.

```actions
- set_prompt: { text: "The nurse said that" }
- run: {}
- ensure_run: { prompt: "The nurse said that" }
```
:::

:::predict{id=she-moves checks=she-obs}
With ' nurse', ' she' gets {she_nurse}. Swap in ' doctor'. What happens to ' she'?

```yaml
choices:
  - { text: "rises", feedback: "The model went another way: ' she' fell to {she_doctor}, and ' he' took the top spot." }
  - { text: "barely moves", feedback: "The model went another way: ' she' fell to {she_doctor}, and ' he' took the top spot." }
  - { text: "drops to a few percent", feedback: "That's what happened. Why would one word move a pronoun two tokens later?" }
  - { text: "vanishes from the list", feedback: "The model went another way: ' she' fell to {she_doctor}, and ' he' took the top spot." }
```
:::

## Compare {id=s3-3 outline=P3.1.md#3.3}

:::slots
she_nurse: { read: compare.prediction, args: { side: a, token: " she" }, field: prob, format: probability, expect: 0.1896977424621582, tolerance: 0.02 }
she_doctor: { read: compare.prediction, args: { side: b, token: " she" }, field: prob, format: probability, expect: 0.04582584276795387, tolerance: 0.02 }
he_doctor: { read: compare.prediction, args: { side: b, token: " he" }, field: prob, format: probability, expect: 0.14450117945671082, tolerance: 0.02 }
she_delta: { read: compare.delta, args: { token: " she" }, expect: -0.14387189704179764, tolerance: 0.02 }
he_delta: { read: compare.delta, args: { token: " he" }, expect: 0.12173311971127987, tolerance: 0.02 }
:::

:::do{id=nurse-doctor}
Compare runs two prompts and puts their Predictions side by side. Press **Do it** to run the nurse prompt and the doctor prompt, then read ' she' and ' he' in :look{at=compare-panel}[Compare's two columns].

```actions
- set_compare_mode: { on: true }
- set_compare: { a: "The nurse said that", b: "The doctor said that" }
- run_compare: {}
```
:::

:::observe{id=she-obs}
Look at the shape first: neither run gives any token more than about 1 in 5, so both lists are spread out. With ' nurse', ' she' gets {she_nurse}. With ' doctor', it gets {she_doctor}, and ' he' tops the doctor run at {he_doctor}. The delta row says the same thing as one number per token: ' she' moved by {she_delta} and ' he' by {he_delta}. That's the doctor run minus the nurse run.

```yaml
check:
  - { read: compare.top, args: { side: b }, op: contains, value: { token: " he" } }
  - { read: compare.delta, args: { token: " she" }, op: lt, value: 0, expect: -0.14387189704179764 }
```
:::

## The minimal pair {id=s3-4 outline=P3.1.md#3.4}

:::do{id=changed-word}
The two prompts match except for :look{at=compare-prompt-b}[the changed word]. Two prompts that are the same except for one word are called a **minimal pair**. Linguists use the name, interpretability papers use it too, and every tool from here to the end of Stage 3 runs on one. Compare will run any two prompts you like. The lessons fill it with a minimal pair.

```actions
- highlight: { anchor: compare-prompt-b }
```
:::

:::explain
It's a controlled experiment. You keep everything the same except one thing, so anything that moves moved with that one change. Here the change is ' nurse' to ' doctor', and ' she' fell while ' he' climbed. Hang on to the words "moved with", though. They're going to matter in a minute, and they don't say quite what you'd like them to.
:::

## The control {id=s3-5 outline=P3.1.md#3.5}

:::slots
control_delta: { read: compare.delta, args: { token: " she" }, expect: 0, tolerance: 0.000001 }
:::

:::predict{id=control-differ checks=control-obs}
Put `The nurse said that` in both slots. Will any number differ?

```yaml
choices:
  - { text: "a little (randomness)" }
  - { text: "not at all" }
```
:::

:::do{id=same-twice}
Before you trust a difference, check what no change looks like. Press **Do it** to run the nurse prompt on both sides.

```actions
- set_compare: { a: "The nurse said that", b: "The nurse said that" }
- run_compare: {}
```
:::

:::observe{id=control-obs}
The delta for ' she' is {control_delta}. Not a little: none at all. You've seen why in P1.6. The logits and probabilities don't involve any randomness, so the same prompt gives the same numbers every time. Randomness only comes in when Pry samples text, and Compare doesn't sample. That's what makes the control useful: if it's zero here, a delta that isn't zero can't be noise.

```yaml
check: { read: compare.delta, args: { token: " she" }, op: within, value: 0, tolerance: 0.000001, expect: 0 }
```
:::

:::question{id=drop-from}
So where did the drop in `3.3` come from?

```yaml
free: true
model_answer: "Only from the one changed word and whatever changed along with it inside."
```
:::

## What does the drop show? {id=s3-6 outline=P3.1.md#3.6}

:::predict{id=drop-shows checks=drop-reveal}
' she' fell from about 1 in 5 to about 1 in 22. What does that show?

```yaml
choices:
  - { text: "the word ' nurse' is what makes the model say ' she'", target: T6 }
  - { text: "one part inside reacts to ' nurse' and pushes ' she'", target: N7 }
  - { text: "' she' moved along with the word, and we don't yet know which part inside, if any single one, did it" }
```
:::

## Correlation {id=s3-7 outline=P3.1.md#3.7}

:::observe{id=drop-reveal}
```yaml
journal: true
```
:::

:::explain-result
Lots of people pick the first answer, and it's a fair guess: one word changed, one number moved, so what else could it be? Here's what rules it out. Inside the model ' nurse' and ' doctor' differ in more than gender. They're not equally common, and they turn up in different kinds of text. Compare can't pull those apart. Two things that move together, which on its own doesn't show one caused the other, are called a **correlation**. You've heard "correlation isn't causation", and this is exactly that. You'll spend the rest of Stage 3 getting past it.

It works the other way too. A pair where ' she' doesn't move doesn't show the word's unused. Other words in the prompt can set the pronoun, and they'd cover for it.

```yaml
supports: "Compare shows what moved when one word changed. It doesn't show which part inside moved it, so treat the delta as a lead. This view only shows what changed, not why. On their own they don't show what causes the model's answer."
leaves_open: "Compare sees only the two outputs. It can't show which parts inside produced the difference, or whether the changed word mattered through one route or many."
tool: compare
skeptic: { says: "A skeptic would say a feature that's active on ' nurse' and not on ' doctor' must be what pushes ' she'. Those two also just moved together.", check: "Here's the check: switch those features off and see whether ' she' drops (P3.4)." }
```
:::

:::analogy
```yaml
like: "along for the ride"
because: "When two people always show up together, you can't tell from that alone who's driving. ' nurse' showed up, and so did ' she'. Lots of other differences inside came along too."
breaks: "only a test shows which one is driving and which is riding."
```
:::

## Transfer {id=s5 outline=P3.1.md#5}

:::slots
mary: { read: compare.prediction, args: { side: a, token: " Mary" }, field: prob, format: probability, expect: 0.6769932508468628, tolerance: 0.02 }
them: { read: compare.prediction, args: { side: a, token: " them" }, field: prob, format: probability, expect: 0.12825962901115417, tolerance: 0.02 }
john: { read: compare.prediction, args: { side: a, token: " John" }, field: prob, format: probability, expect: 0.02347848005592823, tolerance: 0.02 }
tokens_a: { read: compare.token_count, args: { side: a }, expect: 15 }
tokens_b: { read: compare.token_count, args: { side: b }, expect: learner }
:::

:::task{id=make-pair}
Make a minimal pair from the Mary and John sentence where the top guess changes. Change one word in prompt B and keep the same number of tokens on both sides, so the pair stays minimal. Side A has {tokens_a} tokens; side B has {tokens_b}. Stuck after a try? Swap the second ' John' for ' Mary'.

```yaml
target:
  - { read: compare.top, args: { side: b }, op: equals, value: $read.compare.top, value_args: { side: a }, not: true }
constraint:
  - { read: compare.word_diff_count, op: equals, value: 1, expect: learner }
  - { read: compare.token_count, args: { side: b }, op: equals, value: $read.compare.token_count, value_args: { side: a } }
one_change: set_compare
reset: { compare: { a: "When Mary and John went to the store, John gave a drink to", b: "" } }
```
:::

::::transfer{id=mary-swap}
```yaml
prompt: "When Mary and John went to the store, Mary gave a drink to"
expect_if_explanation_holds: "If a minimal pair works the way this lesson says, swapping one name moves the answer, and the delta shows what moved with the swap, nothing more."
limits: "This pair tests one sentence. Its delta still can't say which part inside did the work."
```

:::predict{id=swap-john checks=swap-obs}
Swap the second ' John' for ' Mary'. What happens to ' Mary' and ' John'?

```yaml
free: true
```
:::

:::do{id=swap-run}
Press **Do it** to run the original sentence on side A and the swapped one beside it.

```actions
- set_compare: { a: "When Mary and John went to the store, John gave a drink to", b: "When Mary and John went to the store, Mary gave a drink to" }
- run_compare: {}
```
:::

:::observe{id=swap-obs}
On the original sentence, side A, ' Mary' gets {mary}, ' them' gets {them} and ' John' gets {john}. Swap the second name and ' John' takes the top spot on side B. One word moved the answer, and the delta still can't say where inside that happened.

```yaml
check: { read: compare.top, args: { side: b }, op: contains, value: { token: " John" } }
```
:::

::::

:::question{id=where-inside}
Does this delta tell you where inside the swap does its work?

```yaml
choices:
  - { text: "yes" }
  - { text: "no" }
model_answer: "No; that's P3.3's question."
```
:::

## Explain the chain {id=s6 outline=P3.1.md#6}

:::explain-chain
```yaml
prompt: "In a few sentences: what does Compare's delta for ' she' tell you, what doesn't it, and what would you have to do to find the cause?"
model_answer: "A minimal pair changes one word; the logits and probabilities involve no randomness, so the same prompt twice gives a delta of zero and any delta comes with the change; but one changed word changes many things inside at once, so the delta is a correlation; finding the cause means changing something inside the model and watching the answer."
```
:::
