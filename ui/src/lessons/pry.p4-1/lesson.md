---
format: 1
id: pry.p4-1
title: "Why doesn't GPT-2 act like ChatGPT?"
tool: pry
summary: "Give GPT-2 an instruction, then a document opening, and see what a chat assistant adds on top of a model like this one."
minutes: 10
stage: 4
targets: [M1, M5, N3]
spine: [text, tokens, embedding, residual-stream, logits, probabilities, sampling, append, repeat]
new_terms: [base model, fine-tuning, system prompt]
prerequisites: [pry.p1-5, pry.p1-6]
model: gpt2-small
baseline: { prompt: "Write a short poem about the sea." }
verified_rows: [11, 12, 21, 28, 37, 38, 39]
limits: "These lessons use GPT-2 small, a base model. Fine-tuning, system prompts in trained assistants, search tools and filters are described here, not shown."
---

## Recall {id=s3-0 depth=optional outline=P4.1.md#3.0}

:::recall{id=recall-learn}
Why this matters: chat assistants seem to follow instructions, and this lesson shows where that comes from.

```yaml
from: pry.p1-6
question: "If you type an instruction into Pry, does GPT-2 learn to follow it?"
free: true
```
:::

## An instruction {id=s3-1 outline=P4.1.md#3.1}

:::enter
open_panel: watch-it-write
:::

:::predict{id=poem-or-not checks=instruction-obs}
Type `Write a short poem about the sea.` and let GPT-2 write. What will it do?

```yaml
choices:
  - { text: "it writes a poem", target: M5, feedback: "Lots of people expect that. It's what a chat assistant does. Run it and see what GPT-2 does." }
  - { text: "it says it can't", feedback: "Saying it can't is a chat assistant's habit. Run it and see what GPT-2 does." }
  - { text: "it carries on as if the line were part of a longer page", feedback: "Run it and see. If it does, where'd you find a page like that?" }
  - { text: "something else", feedback: "Run it and see what it did." }
free: true
remember: poem-pick
```
:::

:::do{id=write-instruction}
Press **Do it** to put the instruction in the prompt box and let :look{at=watch-it-write}[Watch it write] add tokens at temperature 0, so it takes the top token every time.

```actions
- set_prompt: { text: "Write a short poem about the sea." }
- run: {}
- write_it: { temperature: 0, seed: 1 }
```

```yaml
capture: instruction
```
:::

:::observe{id=instruction-obs}
Here's what you said: :earlier{key="pry.p4-1.poem-pick"}[nothing]. In :look{at=watch-it-write}[Watch it write], it didn't write a poem. It started a new line and wrote the instruction again, then again, like it's copying out a list. If you picked the poem, that's a fair guess: it's what ChatGPT would do. The text on screen is what rules it out.

```yaml
check: { read: write_it.text, op: starts_with, value: "Write a short poem about the sea.\n\nWrite a short poem about the sea." }
```
:::

:::question{id=what-page}
What kind of page on the internet might have this line followed by more lines like it?

```yaml
free: true
model_answer: "Accept any page where instructions are listed, not answered (a list of writing exercises, a worksheet, a forum of prompts)."
```
:::

## What GPT-2 is {id=s3-2 outline=P4.1.md#3.2}

:::explain-result
GPT-2 only ever learned to continue text, so an instruction is just more text to continue. A model trained only to continue text, with no extra training to act as an assistant, is called a **base model**. It's the word labs and papers use for a model before it's turned into an assistant, and every assistant starts as one. GPT-2 small is a base model, small and well studied, which is why Pry can look inside it. Look at :look{at=watch-it-write}[the generated text] again: it's continuing a page.

```yaml
supports: "GPT-2 is a base model, so it continued the instruction the way a page of instructions would go on, with more of them."
leaves_open: "Temperature 0 shows one path, the top token every time. A sampled run can wander somewhere else; the sampled runs we recorded wandered, and none of them wrote a poem either."
tool: write-it
```
:::

## The same request as a document {id=s3-3 outline=P4.1.md#3.3}

:::predict{id=as-document checks=document-obs}
Now the same request, written as the start of a page: `Here is a short poem about the sea:` and a new line. What will GPT-2 write?

```yaml
choices:
  - { text: "another repeat" }
  - { text: "a poem" }
  - { text: "something unrelated" }
remember: document-pick
```
:::

:::do{id=write-document}
Press **Do it** to change :look{at=prompt-input}[the prompt box] and write again in :look{at=watch-it-write}[Watch it write], still at temperature 0.

```actions
- set_prompt: { text: "Here is a short poem about the sea:\n" }
- run: {}
- write_it: { temperature: 0 }
```

```yaml
capture: document
```
:::

:::compare{id=both-texts}
What's the same? Same weights, same temperature, same spine. Only the text in the prompt box changed, and with it the probabilities at every step.

```yaml
columns:
  - { read: write_it.text, from: instruction }
  - { read: write_it.text, from: document }
same_question: journal
```
:::

:::observe{id=document-obs}
Here's your pick: :earlier{key="pry.p4-1.document-pick"}[nothing]. This time it wrote a poem, with the same model and the same numbers; only the text in the box changed. It isn't a good poem, it repeats itself, but it's poem-shaped, because a poem is what usually follows a line like that on a page.

```yaml
check: { read: write_it.text, from: document, op: starts_with, value: "Here is a short poem about the sea:\n\nThe sea is a sea of water" }
```
:::

:::question{id=which-document}
Which document does each prompt look like the start of, and what usually comes next on that kind of page?

```yaml
free: true
model_answer: "The first looks like an item in a list of instructions (more instructions follow); the second looks like the line before a poem (a poem follows)."
```
:::

:::explain-result
The model didn't change between the two runs. The prompt did, and so did the page it looks like the start of. That's the whole difference, and it's a big one.

```yaml
supports: "The same base model wrote a poem once the prompt looked like the start of a page where a poem comes next. Framing changes what's likely to follow."
leaves_open: "Two prompts, one path each at temperature 0. Larger base models tend to continue too, which is shown elsewhere (Ouyang and colleagues, 2022), not here."
tool: write-it
skeptic: { says: "Maybe GPT-2 is just too small to follow instructions.", check: "The check you just ran: the same small model wrote a poem once the framing changed, so size isn't the whole story." }
```
:::

## One token at a time, revisited {id=s3-4 outline=P4.1.md#3.4}

:::do{id=poem-lines}
You just watched GPT-2 write a poem one token at a time. Look at :look{at=watch-it-write}[the poem's line breaks]: that's where a rhyme would land, if it had one.

```actions
- highlight: { anchor: watch-it-write }
```
:::

:::simplification
P1.5 said the model writes one token at a time. That's true of the output: sampling picks one token, it goes on the end, and everything runs again. It doesn't mean nothing about later words can be in the residual stream yet. In a larger model, Lindsey and colleagues (2025) found information about a rhyme word already active in the residual stream before the line that needs it was written. We checked GPT-2 small with rhyme prompts, and it didn't show up, so that's shown elsewhere, not here.

```yaml
corrected_in: [pry.p4-1]
```
:::

## Where a chat assistant comes from {id=s3-5 outline=P4.1.md#3.5}

:::simplification
P1.6 said training was the earlier process. For GPT-2 that's the whole story: one round of next-token guessing on real text gives a base model. A chat assistant gets a second round.

```yaml
corrected_in: [pry.p4-1]
```
:::

:::explain{id=two-rounds}
The second round's more training on example conversations and on people's ratings of replies. It changes the same weights, so a request now tends to be followed by an answer. More training on a smaller, chosen set of examples, after the first round, is called **fine-tuning**. It's how every chat assistant you've used was made from a base model, and you'll see the word in nearly every AI announcement. See :look{at=lesson:image:two-rounds}[the picture].

Fine-tuning changes which continuations get high probabilities. It doesn't add a fact-checker, so a fluent wrong answer still comes from the same process as a right one.

```yaml
image: images/two-rounds.png
alt: "Training split into two boxes. First round: guess the next token of real text and nudge the weights; GPT-2 stopped here, a base model. Extra training: example conversations and people's ratings of replies, changing the same weights; chat assistants get this round too."
```
:::

::::fold{title="Training on people's ratings"}

:::explain
Training on people's ratings of replies has a name: reinforcement learning from human feedback, or **RLHF**.
:::

::::

:::analogy
```yaml
like: "an actor coached into one role, the helpful assistant"
because: "Coaching makes one part come out every time."
breaks: "there's no actor behind the role. The coaching changed the same numbers that do the guessing; nothing underneath is choosing to play along."
```
:::

## Hidden instructions {id=s3-6 outline=P4.1.md#3.6}

:::predict{id=told-to checks=hidden-obs}
Chat products put instructions before your text that you don't see. Try one: put `You are a poet. You answer every request with a short poem.` on the line before the poem request. What happens?

```yaml
choices:
  - { text: "now it writes a poem, because it was told to", target: N3 }
  - { text: "it continues the text like a document, maybe a different document than before" }
  - { text: "no change from the first run" }
```
:::

:::do{id=write-hidden}
Press **Do it** to add :look{at=prompt-input}[the first line] and write again in :look{at=watch-it-write}[Watch it write].

```actions
- set_prompt: { text: "You are a poet. You answer every request with a short poem.\nWrite a short poem about the sea." }
- run: {}
- write_it: { temperature: 0 }
```
:::

:::observe{id=hidden-obs}
Read what it wrote, and compare it with the first run. Did the line about being a poet get a poem? Don't peek ahead till you've decided.

```yaml
journal: true
```
:::

:::question{id=line-changed}
Did the first line change the output? Why would a line of text change the output at all, if the model doesn't obey settings?

```yaml
free: true
model_answer: "Every token in the prompt feeds into the residual streams that the logits come from; the first line is just more of them."
```
:::

:::explain-result
No poem. GPT-2 went back to repeating the instruction, the way a page of writing prompts would. To the model the first line is just more text placed first. It changes the probabilities the way any earlier text does, and a model follows a line like that only as far as its training made text like that tend to be followed. Instructions a product places before your text, usually hidden from you, are called a **system prompt**. Every chat product has one.

```yaml
supports: "A system prompt is text placed first. It changes the probabilities like any other text, and here it didn't get a poem out of a base model."
leaves_open: "GPT-2 never got the training that makes assistants tend to follow these lines, so this run shows that the line is text that changes probabilities, not how strongly a fine-tuned assistant follows one."
tool: write-it
```
:::

## The product around the model {id=s3-7 outline=P4.1.md#3.7}

:::explain{id=product-image}
:refutes{target=M1}["ChatGPT can search the web now" is true of the product, not the model.] The product can run a search, then paste the results into the text the model reads, next to the system prompt and your message. The model reads that pasted text like any other text and continues it. Some products also run separate filters on what goes in or comes out, which you can't see from outside. :look{at=lesson:image:product-image}[The picture] puts it together, and the middle of it is :look{at=lesson:spine}[the spine strip], the part Pry shows.

We're done with the actor and the engine.

Pry stops at the model; if you want to run the same kind of controlled experiment on chat assistants, where the prompt is your only lever, that takes a companion tool.

```yaml
image: images/product-around-model.png
alt: "The system prompt, your message and pasted search results all feed into one box, the model's spine, from tokens through the residual stream to sampling, which is the part Pry shows. Its output can pass through a filter before it becomes the reply."
```
:::

:::explain-result
Every run in this lesson used Watch it write at temperature 0, so each one shows a single path.

```yaml
supports: "temperature 0 gives one path (the top token at every step). A different seed at a higher temperature can go elsewhere, so one run is one sample, not the model's only behaviour."
leaves_open: "These lessons use GPT-2 small, a base model. Fine-tuning, system prompts in trained assistants, search tools and filters are described here, not shown."
tool: write-it
```
:::

:::analogy
```yaml
like: "same engine, different tuning and a different dashboard"
because: "A chat assistant and GPT-2 run the same engine design. The assistant's had extra tuning, and the product's bolted a dashboard on around it."
breaks: "fine-tuning changes the engine's own numbers, not a setting on top of them, and the dashboard (search, filters) is a separate program, not part of the engine."
```
:::

## Transfer {id=s5 outline=P4.1.md#5}

:::slots
qa_top: { read: top_guess.prob, expect: 0.1572200357913971, tolerance: 0.02 }
:::

::::transfer{id=french}
```yaml
prompt: "Q: What is the opposite of hot?\nA:"
expect_if_explanation_holds: "If GPT-2 continues whatever page the prompt looks like the start of, the bare question gets treated like a line on a page, and the Q-and-A version gets an answer-shaped line straight away."
limits: "One pair of prompts, one path each. Answer-shaped isn't the same as right: framing changes the shape of what follows, not what the model has the numbers for."
```

:::predict{id=which-answer checks=french-obs}
Which of these will GPT-2 answer?

```yaml
choices:
  - { text: "What is the opposite of hot?" }
  - { text: "Q: What is the opposite of hot?, with A: on the next line" }
```
:::

:::do{id=write-translate}
Start with the bare question. Press **Do it** to let GPT-2 write after it.

```actions
- set_prompt: { text: "What is the opposite of hot?" }
- run: {}
- write_it: { temperature: 0 }
```

```yaml
capture: translate
```
:::

:::do{id=run-french}
Now the same question written as a page of questions and answers, ending on "A:". Press **Do it** to run it and read the next-token guesses.

```actions
- set_prompt: { text: "Q: What is the opposite of hot?\nA:" }
- run: {}
```
:::

:::task{id=own-opening}
Your turn: take the bare question, or an instruction of your own, and rewrite it as the opening of a page where an answer comes next. Type it in :look{at=prompt-input}[the Prompt box], press **Run**, then **Write it** in Watch it write, and see whether the text changes. Then press **Check my result**.

```yaml
target:
  - { read: write_it.text, op: changed_from, value: $before.write_it.text }
learner_actions: [set_prompt, write_it]
reset: { prompt: "What is the opposite of hot?" }
```
:::

:::observe{id=french-obs}
After "A:", the top guess is ' The', at {qa_top}: the start of an answer sentence. The bare question got a blank line first, the way a page goes on after a heading. Look at what came after, though. Neither version says "cold". The framing changed the shape of what follows, not what GPT-2 gets right.

```yaml
check: { read: top_guess.token, op: equals, value: " The" }
```
:::

::::

:::question{id=document-each}
Which document does each prompt look like the start of, and what usually follows on a page like that?

```yaml
free: true
model_answer: "The bare question looks like a heading or a line in a list, so the page carries on after it; the Q-and-A version looks like a page of questions with their answers, so an answer comes next."
```
:::

## Explain the chain {id=s6 outline=P4.1.md#6}

:::explain-chain
```yaml
prompt: "In your own words: why did GPT-2 repeat 'Write a short poem about the sea.' when ChatGPT would write the poem? Use what GPT-2 learned to do, what ChatGPT got on top, and what the hidden first text is."
model_answer: "GPT-2 is a base model: it learned only to continue text, so an instruction is continued like a page that lists instructions. A chat assistant is the same kind of model plus fine-tuning on conversations and ratings, which makes a reply the likely continuation of a request, plus a system prompt placed before your text, and sometimes tools that paste in text and filters. None of that changes the spine: text in, probabilities out, one token at a time, with the prompt as the only thing a user can change."
```
:::
