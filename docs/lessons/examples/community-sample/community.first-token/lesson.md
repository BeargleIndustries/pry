---
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/pry-front-matter.v1.schema.json
format: 1
id: community.first-token
title: "The model's first guess has a space in it"
tool: pry
summary: "Guess the next token, run it, and notice the leading space."
minutes: 5
model: gpt2-small
baseline: { prompt: "The Eiffel Tower is in the city of" }
permissions:
  network: [neuronpedia]
slots:
  top: { read: top_guess.token, expect: " London" }
  top_p: { read: top_guess.prob, expect: 0.0805, tolerance: 0.02 }
  paris_p: { read: prediction, args: { token: " Paris" }, field: prob, expect: 0.0687, tolerance: 0.02 }
new_terms: [token]
authors: ["A curious learner"]
---

## Guess first {id=guess}

:::explain{id=intro}
GPT-2 small doesn't write words. It writes tokens: chunks of text, often a whole word with the space in front of it.

Here's a prompt: "The Eiffel Tower is in the city of". What comes next?
:::

:::analogy{id=autocomplete}
```yaml
like: "Your phone's autocomplete suggesting the next word."
because: "Both look at what's typed so far and rank what could come next."
breaks: "Your phone suggests whole words. The model ranks tokens, and a token can be half a word or carry a space."
```
:::

:::predict{id=guess-top checks=look-top}
What do you think the model puts first?

```yaml
choices:
  - { text: "\" Paris\"", feedback: "That's the answer a person gives. The model gave it {paris_p}, and put {top} above it." }
  - { text: "\" London\"", feedback: "That's what the model put first, at {top_p}. Paris came in at {paris_p}." }
remember: first-guess
```
:::

## Run it {id=run}

:::do{id=run-it}
Press **Do it** to run the prompt.

```actions
- set_prompt: { text: "The Eiffel Tower is in the city of" }
- run: {}
```
:::

:::observe{id=look-top}
```yaml
check: { read: top_guess.token, op: equals, value: $slot.top }
```
:::

:::explain{id=what-you-saw}
The model's top token is {top}, at {top_p}. Paris gets {paris_p}. GPT-2 small is a small model, and the city a person would name isn't always the one it ranks first.

Look at :look{at=prediction-bar token=" London"}[the bar]: the token starts with a space. The space is part of the token, so " London" and "London" are two different tokens to the model.
:::

## Look it up {id=lookup depth=optional}

:::do{id=find-paris}
Want to see if Neuronpedia has a feature for Paris? Press **Do it** to search for it. Pry opens the Steering tab and shows what Neuronpedia sends back.

```actions
- search_concepts: { text: "Paris" }
```
:::
