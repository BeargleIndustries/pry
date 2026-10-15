---
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/front-matter.v1.schema.json
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
  top: { read: top_guess.token, expect: " Paris" }
  top_p: { read: top_guess.prob, expect: 0.35, tolerance: 0.1 }
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
  - { text: "\" Paris\"", feedback: "That's the answer a person gives. Run it and see if the model puts it first." }
  - { text: "\" London\"", feedback: "Another big city. Run it and see where it lands." }
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
check: { read: top_guess.token, op: equals, value: $prediction }
expect: top
```
:::

:::explain{id=what-you-saw}
The model's top token is {top}, at {top_p}. Look at :look{at=prediction-bar token=" Paris"}[the bar]: the token starts with a space. The space is part of the token.
:::

## Look it up {id=lookup depth=optional}

:::do{id=find-paris}
Want to see if Neuronpedia has a feature for Paris? Press **Do it** to search for it.

```actions
- open_panel: { panel: steering }
- search_concepts: { text: "Paris" }
```
:::
