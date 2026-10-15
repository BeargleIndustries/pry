---
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/pry-front-matter.v1.schema.json
format: 1
id: community.third-time
title: "Look before you steer"
tool: pry
summary: "See what the model does on its own first, then find a concept you could steer it toward."
minutes: 6
model: gpt2-small
baseline: { prompt: "On a hot day at the beach, I like to eat" }
new_terms: [steering]
permissions:
  network: [neuronpedia]
authors: ["Outsider Three"]
slots:
  top_tok: { read: top_guess.token, expect: " a" }
  top_p: { read: top_guess.prob, expect: 0.1158, tolerance: 0.02 }
---

## The starting point {id=starting-point}

:::explain{id=why-look}
Before you push a model somewhere new, you need to know where it already goes. So start with a plain run and look at :look{at=predictions-panel}[the Predictions tab].
:::

:::analogy{id=steering-wheel}
```yaml
like: "Checking which way a car rolls on its own before you touch the wheel."
because: "You can only tell what your push did if you saw where it was heading without one."
breaks: "A car has one direction. The model ranks every token at once, so a push can move many of them, not just the top one."
```
:::

:::predict{id=guess-food checks=see-top}
What do you think the model puts first after "On a hot day at the beach, I like to eat"?

```yaml
choices:
  - { text: "\" ice\"", feedback: "Ice cream is what a person would say. The model puts {top_tok} first, at {top_p}." }
  - { text: "\" a\"", feedback: "Short words come up a lot, and this time the model puts {top_tok} first, at {top_p}. It's setting up a noun, not naming the food yet." }
remember: first-food
```
:::

:::do{id=run-plain}
Press **Do it** to run the prompt.

```actions
- set_prompt: { text: "On a hot day at the beach, I like to eat" }
- run: {}
```
:::

:::observe{id=see-top}
```yaml
check: { read: top_guess.token, op: equals, value: $slot.top_tok }
```
:::

## What steering means {id=what-steering}

:::explain{id=steering-defined}
**Steering** means adding a direction to the model's numbers partway through a run, so its next guesses lean toward some concept. Each direction comes from a feature: a pattern the model's numbers show when that concept is in the text.

The model put {top_tok} first, at {top_p}. That's the starting point you'd compare a steered run against.
:::

## Find a concept {id=find-concept depth=optional}

:::explain{id=lookup-intro}
Neuronpedia keeps a searchable list of features with plain labels. A lookup sends your search text to Neuronpedia, so it only runs when you press **Do it**.
:::

:::do{id=look-up}
Press **Do it** to look up "cold" on Neuronpedia. The results open in :look{at=concept-search}[the Find a concept box].

```actions
- search_concepts: { text: "cold" }
```
:::
