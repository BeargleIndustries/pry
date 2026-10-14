---
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/front-matter.v1.schema.json
format: 1
id: my.first-lesson
title: "What comes after the capital of France?"
tool: pry
summary: "Guess what the model says next, then run it and look."
minutes: 5
model: gpt2-small
baseline: { prompt: "The capital of France is" }
---

## Guess first {id=guess-first}

:::explain{id=intro}
This is a lesson you can copy. Rename the folder and the `id` to a name of your own, like `yourname.first-lesson`, then change the words.

After you run it, look at :look{at=prediction-bar token=" Paris"}[the bar for " Paris"].
:::

:::predict{id=guess checks=look-top}
What do you think the model puts first after "The capital of France is"?

```yaml
choices:
  - { text: "\" Paris\"", feedback: "That's what a person would say. Run it and see if the model agrees." }
  - { text: "\" the\"", feedback: "Short, common words come up a lot. Run it and see where it ends up." }
remember: first-guess
```
:::

:::do{id=run-it}
Press **Do it** to run the prompt.

```actions
- set_prompt: { text: "The capital of France is" }
- run: {}
```
:::

:::observe{id=look-top}
```yaml
check: { read: top_guess.token, op: equals, value: $prediction }
```
:::
