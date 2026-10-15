---
format: 1
id: broken.lesson
title: "A lesson with mistakes in it"
tool: pry
summary: "Every section has something for the linter to find."
minutes: 5
model: gpt2-small
baseline: { prompt: "The capital of France is" }
---

## No breaks {id=no-breaks}

:::analogy{id=desk}
```yaml
like: a mixing desk
because: each earlier token is a channel
```
:::

## Misspelt action {id=misspelt}

:::do{id=run-it}
Run it.

```actions
- set_promt: { text: "The capital of France is" }
- run: {}
```
:::

## Nothing checks it {id=unchecked}

:::predict{id=guess}
What comes first?

```yaml
free: true
```
:::
