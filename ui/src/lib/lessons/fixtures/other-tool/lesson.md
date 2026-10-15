---
format: 1
id: someone.shout
title: "What does the engine do to a word?"
tool: other
summary: "Guess the output, then run it and look."
minutes: 2
model: tiny
baseline: { input: "hello" }
---

## Guess first {id=guess-first}

:::predict{id=guess checks=look}
What comes out when the engine reads "hello"?

```yaml
choices:
  - { text: "\"HELLO\"", feedback: "Run it and see." }
  - { text: "\"hello\"", feedback: "Run it and see." }
```
:::

:::do{id=go}
Press **Do it** to run the word.

```actions
- set_input: { text: "hello" }
- run: {}
```
:::

:::observe{id=look}
```yaml
check: { read: result, op: equals, value: $prediction }
```
:::

## A second word {id=second}

:::enter
input: "bank"
:::

:::do{id=go-again}
Press **Do it** to run the new word.

```actions
- run: {}
```
:::
