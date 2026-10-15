---
format: 1
id: pry.p1-2
title: "Does the model read words?"
tool: pry
summary: "GPT-2 doesn't get your text as words. You'll see how it cuts text into pieces, and what list of numbers each piece starts with."
minutes: 12
stage: 1
targets: [M9, N1]
spine: [text, tokens, embedding]
new_terms: [token, vocabulary, start-of-text marker, embedding, positional embedding]
term_budget_exception: "round 7 #17"
prerequisites: [pry.p1-1]
model: gpt2-small
baseline: { prompt: "It was unbelievable, said Leclerc" }
verified_rows: [6, 7, 42]
limits: "The token strip shows how your text got cut. It doesn't show what the model does with the tokens afterwards."
---

## How many pieces? {id=s3-1 outline=P1.2.md#3.1}

:::enter
prompt: "It was unbelievable, said Leclerc"
:::

:::explain
Lesson 1 said 'the next word'. That was a simplification, and this lesson's where it gets fixed.

:look{at=prompt-input}[The prompt box] has a new sentence in it. It hasn't run yet, so you've got time to guess how Pry is going to cut it up.
:::

:::predict{id=pieces-unbelievable checks=pieces-obs}
Pry is about to cut this sentence into pieces. How many pieces will ' unbelievable' become?

```yaml
choices:
  - { text: "1" }
  - { text: "2", feedback: "The model went another way: ' unbelievable' is one piece and ' Leclerc' is three, ' Le', 'cl', 'erc'. Splitting doesn't go by how long a word is. It goes by how often letters show up together in text." }
  - { text: "3", feedback: "The model went another way: ' unbelievable' is one piece and ' Leclerc' is three, ' Le', 'cl', 'erc'. Splitting doesn't go by how long a word is. It goes by how often letters show up together in text." }
  - { text: "4+", feedback: "The model went another way: ' unbelievable' is one piece and ' Leclerc' is three, ' Le', 'cl', 'erc'. Splitting doesn't go by how long a word is. It goes by how often letters show up together in text." }
```
:::

:::predict{id=pieces-leclerc checks=pieces-obs}
What about ' Leclerc'?

```yaml
choices:
  - { text: "1", feedback: "The model went another way: ' unbelievable' is one piece and ' Leclerc' is three, ' Le', 'cl', 'erc'. Splitting doesn't go by how long a word is. It goes by how often letters show up together in text." }
  - { text: "2", feedback: "The model went another way: ' unbelievable' is one piece and ' Leclerc' is three, ' Le', 'cl', 'erc'. Splitting doesn't go by how long a word is. It goes by how often letters show up together in text." }
  - { text: "3" }
  - { text: "4+", feedback: "The model went another way: ' unbelievable' is one piece and ' Leclerc' is three, ' Le', 'cl', 'erc'. Splitting doesn't go by how long a word is. It goes by how often letters show up together in text." }
```
:::

:::predict{id=pieces-why checks=pieces-obs}
Why? Pick the reason closest to yours. If your answers already match how the cutting works, you'll get the option to skip ahead to the numbers half.

```yaml
choices:
  - { text: "long words get split" }
  - { text: "common words stay whole, rare ones get split" }
  - { text: "every word is one piece", target: M9, feedback: "Lots of people expect whole words; we read words, so it's a fair guess. ' Leclerc' got chopped into three, though." }
skip_check:
  when:
    - { step: pieces-unbelievable, choice: "1" }
    - { step: pieces-leclerc, choice: "3" }
    - { step: pieces-why, choice: "common words stay whole, rare ones get split" }
  skip: [s3-2, s3-4]
```
:::

## See the pieces {id=s3-2 outline=P1.2.md#3.2}

:::do{id=run-pieces}
The lesson runs the sentence. Look at :look{at=token-strip}[the strip] labelled "Words (tokens)" under the prompt.

```actions
- run: {}
- highlight: { anchor: token-strip }
```
:::

:::observe{id=pieces-obs}
' unbelievable' stays in one piece. ' Leclerc' comes out as three: ' Le', 'cl' and 'erc'. The dot on :look{at=token-chip text=" Le"}[a piece] means "starts with a space", so ' Le' carries the space in front of the name.

```yaml
check:
  - { read: word_tokens, args: { word: " unbelievable" }, op: equals, value: 1, expect: 1 }
  - { read: word_tokens, args: { word: " Leclerc" }, op: equals, value: 3, expect: 3 }
```
:::

## Tokens and the vocabulary {id=s3-3 outline=P1.2.md#3.3}

:::explain
GPT-2 cuts your text into pieces from a fixed list of about 50,000, so a common word with its space is one piece and a rare name gets built from scraps. These pieces are called **tokens**. AI companies' price lists and limits all count in tokens, so it's a word worth owning. That fixed list is the model's **vocabulary**: it's the list the model scores every time it picks what comes next. :look{at=token-strip}[The strip] shows your sentence as tokens.

When lesson 1 said 'the next word', it meant the next token.
:::

:::analogy
```yaml
like: "LEGO bricks from a fixed set"
because: "everything gets built from the same set of pieces"
breaks: "tokens are uneven, and the split follows how often letters show up together, not meaning."
```
:::

::::fold{title="What does the cutting?"}

:::explain
The tool that cuts text into tokens's called a tokenizer. GPT-2's was built once, before training, from how often letter groups showed up in a big pile of text, and it's been fixed ever since.
:::

::::

:::explain-result
```yaml
supports: "Your sentence reached the model as tokens from a fixed vocabulary, not as words: a common word stayed whole and a rare name got split."
leaves_open: "The strip shows how your text was cut. It doesn't show what the model does with the pieces."
tool: tokens
```
:::

## Your turn {id=s3-4 outline=P1.2.md#3.4}

:::do{id=own-prompt}
Try your own name, or a long word you like... it's a good way to get a feel for the cuts. :look{at=[prompt-input, run-button, token-strip]}[Type it in, press Run, then read the strip.]
:::

:::analogy
```yaml
like: "a phrasebook, where common phrases get their own entry and rare words are spelled out from bits"
because: "the things you see all the time get a shortcut, and everything else gets assembled"
breaks: "a phrasebook's entries mean something on their own; a token is just a piece."
```
:::

:::question{id=split-more}
Which got split more: the common words or the rare ones? Here's a hint: it's the same rule every time.

```yaml
choices:
  - { text: "the common words" }
  - { text: "the rare ones" }
```
:::

:::explain
So far: text becomes tokens. Next: tokens become numbers.
:::

## Same start? {id=s3-5 outline=P1.2.md#3.5}

:::explain
Before the model does any work on your sentence, each token gets a starting list of 768 numbers. Here's ' bank' in two sentences, "I like the river bank" and "I like the money bank". The rest of each sentence is different, and ' bank' sits in the same spot in both.
:::

:::do{id=bank-reader}
Press **Do it** to load ' bank' from both sentences into a reader for each token's starting list. The reader opens under the question below, with its numbers hidden until you answer.

```actions
- show_embedding: { a: { prompt: "I like the river bank", token: " bank" }, b: { prompt: "I like the money bank", token: " bank" } }
```
:::

:::predict{id=same-start checks=identical-obs}
Will ' bank' start with the same numbers in both sentences? :look{at=embedding-view}[The reader] shows them once you commit: each list one number at a time, a count of how many match, and a cosine similarity, one score for how closely the two lists line up, highest when they're the same.

```yaml
choices:
  - { text: "No: the model can see 'river' vs 'money'", target: N1 }
  - { text: "Yes, exactly the same" }
  - { text: "Almost the same" }
hides: [embedding-values]
on_skip: "Here's the answer: the next section shows both lists."
```
:::

## Identical {id=s3-6 outline=P1.2.md#3.6}

:::slots
bank_matches: { read: embedding.matches, args: { part: sum }, expect: 768 }
:::

:::observe{id=identical-obs}
{bank_matches} numbers match. :look{at=embedding-view}[The match count] compares the two lists one number at a time, and every one of them is the same.

```yaml
check: { read: embedding.matches, args: { part: sum }, op: equals, value: 768, expect: 768 }
```
:::

:::explain-result
:refutes[Lots of people expect the river bank to start different. Fair: you read the whole sentence at once. The starting numbers don't see the sentence. Whatever tells the two banks apart has to get added later (next lesson).]

Each token's starting list comes from its own entry in a fixed table, one entry for every token in the vocabulary. That entry is called the token's **embedding**. Every later step builds on it, and you'll run into the word anywhere people explain these models.

```yaml
supports: "' bank' starts from the same list in both sentences, because the list comes from the token's entry in a table, not from the sentence around it."
leaves_open: "The reader shows what each token starts with, nothing more. It says nothing about what they mean or what happens to them next."
tool: embedding
```
:::

:::analogy
```yaml
like: "looking a token up in a huge table"
because: "every time ' bank' shows up, it gets the same row"
breaks: "nobody wrote the entries; training set them."
```
:::

## Counting positions {id=s3-7 outline=P1.2.md#3.7}

:::slots
bank_pos: { read: focus.position, format: position, from_capture: river, expect: 5 }
bank_word: { read: focus.word_number, format: position, from_capture: river, expect: 6 }
the_bank_pos: { read: focus.position, format: position, from_capture: thebank, expect: 2 }
:::

:::do{id=count-positions}
The lesson runs "I like the river bank". Look at :look{at=token-strip}[the first entry] in the strip, then at :look{at=token-chip text=" bank"}[' bank'].

```actions
- set_prompt: { text: "I like the river bank" }
- run: {}
- highlight: { anchor: token-strip }
- focus_token: { text: " bank" }
```

```yaml
capture: river
```
:::

:::explain
That first entry's one Pry put there: a special token in front of everything you type, and positions count from it as 0. It's called the **start-of-text marker**. You'll see it at the front of every token strip, and later tools treat it specially. Pry's panels number words from 1, so ' bank' shows as word {bank_word}.
:::

:::predict{id=the-bank-pos checks=the-bank-obs}
Counting from the start-of-text marker as 0, ' bank' is at position {bank_pos} in 'I like the river bank'. What position is it in 'The bank'?

```yaml
free: true
```
:::

:::do{id=the-bank}
The lesson runs "The bank" and picks ' bank'.

```actions
- set_prompt: { text: "The bank" }
- run: {}
- focus_token: { text: " bank" }
```

```yaml
capture: thebank
```
:::

:::observe{id=the-bank-obs}
' bank''s at position {the_bank_pos}: the marker's 0, 'The' is 1, and ' bank' comes next.

```yaml
check: { read: focus.position, op: equals, value: 2, expect: 2 }
```
:::

## Position gets its own numbers {id=s3-8 outline=P1.2.md#3.8}

:::do{id=split-rows}
:look{at=embedding-view}[The reader] now splits each token's starting list into two rows. Look at the second one.

```actions
- show_embedding: { a: { prompt: "I like the river bank", token: " bank" }, b: { prompt: "I like the money bank", token: " bank" }, split: true }
```
:::

:::explain
The first row's the embedding you've already met. The second's another set of 768 numbers, one set for each position, added to the token's embedding. It's called the **positional embedding**, and it's the only part of what a token starts with that says where it sits. From here on, what a token starts with is its embedding plus positional embedding.
:::

:::analogy
```yaml
like: "a seat number added to a ticket"
because: "the same ticket gets a different seat depending on where you sit"
breaks: "it isn't a label the model reads off; it's 768 more numbers mixed into the same list."
```
:::

## Transfer {id=s5 outline=P1.2.md#5}

:::slots
embed_matches: { read: embedding.matches, args: { part: embed }, expect: 768 }
pos_matches: { read: embedding.matches, args: { part: pos }, expect: 0 }
cosine: { read: embedding.cosine, args: { part: sum }, expect: 0.95732 }
pos_two: { read: focus.position, format: position, from_capture: thebank, expect: 2 }
pos_five: { read: focus.position, format: position, from_capture: river, expect: 5 }
:::

::::transfer{id=bank-two-five}
```yaml
prompt: "The bank"
expect_if_explanation_holds: "The embedding comes from the token, so it matches. The positional embedding comes from where the token sits, so it differs, and so does the sum."
limits: "This compares what ' bank' starts with in two spots. It doesn't show what the model does with either one afterwards."
```

:::predict{id=match-or-not checks=split-obs}
' bank' in 'The bank' sits at position {pos_two}. Will its embedding plus positional embedding match ' bank' at position {pos_five}?

```yaml
choices:
  - { text: "exactly the same" }
  - { text: "different" }
  - { text: "similar but not the same" }
```
:::

:::predict{id=which-part checks=split-obs}
Which part will differ: the embedding, the positional embedding, or both?

```yaml
choices:
  - { text: "the embedding" }
  - { text: "the positional embedding" }
  - { text: "both" }
```
:::

:::do{id=bank-two-five-run}
The lesson puts ' bank' from "The bank" next to ' bank' from "I like the river bank". Read :look{at=embedding-view}[the two rows].

```actions
- show_embedding: { a: { prompt: "The bank", token: " bank" }, b: { prompt: "I like the river bank", token: " bank" }, split: true }
```
:::

:::observe{id=split-obs}
In the embedding row, {embed_matches} numbers match. In the positional embedding row, {pos_matches} match. Add the two rows together and compare the sums: their similarity is {cosine}, where 1 would mean the two lists point exactly the same way. It's shown beside the two rows it compares.

```yaml
assert:
  - require: { slot: cosine, op: gt, value: 0.9 }
    say: "So the sums are close, and still not the same."
    else: "So the sums differ."
```

```yaml
check:
  - { read: embedding.matches, args: { part: embed }, op: equals, value: 768, expect: 768 }
  - { read: embedding.matches, args: { part: pos }, op: equals, value: 768, not: true, expect: 0 }
```
:::

::::

:::question{id=swap-river}
If you swapped 'river' for 'money', what would change for ' bank' at the start: its embedding, its positional embedding, or neither?

```yaml
choices:
  - { text: "its embedding" }
  - { text: "its positional embedding" }
  - { text: "neither" }
model_answer: "neither"
```
:::

:::explain
So where does the difference between river bank and money bank come from? From the work the model does after the start, and that's lesson P1.3.
:::

## Explain the chain {id=s6 outline=P1.2.md#6}

:::explain-chain
```yaml
prompt: "How does GPT-2 turn 'I like the river bank' into numbers, and why can't ' bank''s embedding plus positional embedding tell river bank from money bank?"
model_answer: "The text gets cut into tokens from a fixed vocabulary, with a start-of-text marker in front. Each token starts as its own embedding, an entry from a fixed table, plus a positional embedding for where it sits. ' bank' gets the same entry and the same position in both sentences, so it starts out identical. Anything that separates the two banks has to come later."
```
:::
