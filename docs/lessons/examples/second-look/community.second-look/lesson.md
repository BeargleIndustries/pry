---
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/pry-front-matter.v1.schema.json
format: 1
id: community.second-look
title: "A long word, a short guess"
tool: pry
summary: "See how one long word gets cut into tokens, then guess what the model puts after it."
minutes: 6
model: gpt2-small
baseline: { prompt: "The longest word I know is antidisestablishmentarianism, which means" }
new_terms: [token]
permissions:
  network: [neuronpedia]
slots:
  chips: { read: token_count, expect: 15 }
  word_chips: { read: word_tokens, args: { word: "antidisestablishmentarianism" }, expect: 5 }
  top: { read: top_guess.token, expect: " that" }
  top_prob: { read: top_guess.prob, expect: 0.34, tolerance: 0.02 }
authors: ["Outsider Two"]
---

## Cut into pieces {id=pieces}

:::explain{id=intro}
The model never sees words. It sees a **token**: a chunk of text from a fixed list, sometimes a whole word, sometimes a piece of one. Look at :look{at=token-strip}[the word chips] once the prompt has run.
:::

:::analogy{id=lego}
```yaml
like: "Building a long word out of LEGO bricks from a fixed kit."
because: "The kit has bricks for common words and pieces, and a rare word gets built from several smaller bricks."
breaks: "LEGO bricks don't change meaning by sitting next to each other. The model reads each token in light of the ones before it."
```
:::

:::do{id=run-it}
Press **Do it** to run the prompt. It became {chips} tokens, counting the start marker Pry puts in front, and the long word alone took {word_chips}.

```actions
- set_prompt: { text: "The longest word I know is antidisestablishmentarianism, which means" }
- run: {}
```
:::

## Guess what comes next {id=guess}

:::predict{id=next checks=look-top}
After "which means", what do you think the model puts first?

```yaml
choices:
  - { text: "\" the\"", feedback: "The model put {top} first, at {top_prob}." }
  - { text: "\" a\"", feedback: "The model put {top} first, at {top_prob}." }
  - { text: "\" that\"", feedback: "The model put {top} first, at {top_prob}." }
remember: next-guess
```
:::

:::observe{id=look-top}
```yaml
check: { read: top_guess.token, op: equals, value: $slot.top }
```
:::

:::explain-result{id=what-it-shows}
```yaml
tool: predictions
supports: "After a long, rare word, the model still puts a short, common token first: {top}, at {top_prob}."
leaves_open: "Why that token wins. The Predictions tab ranks the guesses, but it doesn't say which parts of the model pushed for them."
```
:::

## Look the word up {id=lookup depth=optional}

:::explain{id=lookup-intro}
Neuronpedia keeps a catalogue of features people have found inside models. You can search it for the idea behind the long word. What comes back is Neuronpedia's answer, not something Pry measured on your run.
:::

:::do{id=search}
Press **Do it** to search Neuronpedia for "politics".

```actions
- search_concepts: { text: "politics" }
```
:::
