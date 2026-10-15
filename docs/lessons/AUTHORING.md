# Writing a Pry lesson

> **Preview.** Writing your own lessons is a preview in Pry 0.4.x. The format is `format: 1` and it's frozen: anything added to format 1 later is extra, never a change to what you already wrote. Format 1 lessons will keep opening; when format 2 ships, Pry converts them automatically.

A Pry lesson is one Markdown file, `lesson.md`, in a folder named after the lesson's id. Pry reads it, drives the app section by section, asks the learner to guess before it shows a result, and shows every number next to the measurements it came from. You don't write code. You'll write prose, plus small blocks of YAML that name Pry's actions and readouts, and that's it.

This page walks you from the template to a lesson that's installed and running. After that it's a reference for every part of the format.

## Contents

1. [From the template to an installed lesson](#from-the-template-to-an-installed-lesson)
2. [The front matter](#the-front-matter)
3. [Sections and section state](#sections-and-section-state)
4. [Step kinds](#step-kinds)
5. [Inline marks](#inline-marks)
6. [Action arguments: `$row` and `$earlier`](#action-arguments-row-and-earlier)
7. [Slots and asserts](#slots-and-asserts)
8. [Checks](#checks)
9. [Captures](#captures)
10. [What replays when a learner goes back](#what-replays-when-a-learner-goes-back)
11. [`when`: showing a step only sometimes](#when-showing-a-step-only-sometimes)
12. [Tasks](#tasks)
13. [Permissions and the install sheet](#permissions-and-the-install-sheet)
14. [Drafts and author mode](#drafts-and-author-mode)
15. [Strict and lenient](#strict-and-lenient)
16. [The copy rules](#the-copy-rules)
17. [Voice](#voice)
18. [Getting real expected values](#getting-real-expected-values)
19. [Set up the sidecar for recording](#set-up-the-sidecar-for-recording)
20. [Checking your lesson](#checking-your-lesson)
21. [Versions](#versions)

## From the template to an installed lesson

1. **Find the template.** The first time Pry starts, it writes a `_template` folder into your lessons folder. On Windows that's `%APPDATA%\com.beargle.pry\lessons\_template`. It holds `lesson.md` (a small lesson that works) and `README.md`.
2. **Copy it somewhere of your own.** Work in a folder outside Pry's app data, like `Documents\my-lessons\yourname.first-lesson`. `my-lessons` is then your lesson set, the folder the recorder and the checker work on (see [Getting real expected values](#getting-real-expected-values)). Uninstalling Pry can remove its app data, lessons folder included, so keep your own copy.
3. **Pick an id.** Ids look like `yourname.first-lesson`: lowercase letters, digits and dashes, with at least one dot, up to 64 characters, and no leading `_`. Ids starting `pry.` belong to the lessons that ship with Pry, and Pry won't load yours under that prefix. The folder name and the `id` must match, and the checker fails a lesson whose folder has another name. (Folders starting with `_`, like `_template`, are skipped: Pry never loads them as lessons.) Never change an id once people have it: progress is saved against it.
4. **Write.** Change the title, the summary and the steps. The rest of this page says what each part does.
5. **Get real numbers.** Every `expect` in your lesson should be a value Pry actually showed, not a guess. See [Getting real expected values](#getting-real-expected-values).
6. **Check it.** In Pry, open Settings > Lessons and use **Check this lesson**, or run the bundled checker from a terminal (see [Checking your lesson](#checking-your-lesson)). Fix every error. Each one tells you the section, the step and the line, so you won't have to hunt.
7. **Add it.** In the lesson list, choose **Add a lesson...** and pick your folder. Pry copies it into its lessons folder. It skips links and junctions, refuses any image over 1 MB, and refuses a folder over 20 MB.
8. **OK the permissions.** If your lesson declares any `permissions`, Pry shows an install sheet the next time the learner opens the lesson list or Settings > Lessons ("1 new lesson needs your OK"). A lesson with no permissions installs without asking.
9. **Edit while it runs.** Pry watches its lessons folder. Save `lesson.md` there and the lesson reloads within about half a second, on the same section. **Reload lessons** does the same thing by hand.

If a lesson won't load, it still shows in the list. It's greyed out, with the file, the line and the first error, so you'll know where to look.

## The front matter

The YAML block between the `---` lines at the top. Put the schema line first so your editor can autocomplete the fields. Copy it exactly as `_template` has it:

```yaml
---
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/pry-front-matter.v1.schema.json
format: 1
id: yourname.first-lesson
title: "What comes after the capital of France?"
tool: pry
summary: "Guess what the model says next, then run it and look."
minutes: 5
model: gpt2-small
baseline: { prompt: "The capital of France is" }
---
```

The schema covers the front matter only. It can't check the steps inside the body. That's the lesson checker's job. You'll see a second file in the same folder, `front-matter.v1.schema.json`. That one is for tools other than Pry, and it leaves `baseline` open. For a Pry lesson, use `pry-front-matter.v1.schema.json`, which knows Pry's `baseline` keys.

**Required:** `format` (always `1`), `id`, `title`, `tool` (`pry`), `summary` (one line), `minutes`.

**Optional:**

| Field | What it does |
|---|---|
| `draft` | `true` hides the lesson unless author mode is on. See [Drafts and author mode](#drafts-and-author-mode). |
| `presentation` | `sidebar` (the default) or `overlay` (a short view-only tour). |
| `stage` | 1, 2 or 3. Stage 2 and 3 results need a skeptic (see `explain-result`). |
| `targets` | Misconception ids this lesson works on. Each needs a predict choice tagged with it. |
| `spine` | Spine boxes this lesson lights, as a list or a range. |
| `new_terms` | The terms this lesson introduces. For your lessons, this list is what the term budget counts. See [The copy rules](#the-copy-rules). |
| `term_budget_exception` | Lets a lesson introduce more than three new terms. Write the reason as one sentence. On your own lesson that's your call, and the checker only looks for it being there. |
| `prerequisites` | Lesson ids to do first. No cycles. |
| `cold_entry` | Markdown shown when the prerequisites aren't done ("What you need from before"). |
| `model` | The model the lesson expects, e.g. `gpt2-small`. Required when anything carries `expect`. |
| `baseline` | The app state every section starts from, e.g. `{ prompt: "..." }`. Setting a prompt doesn't run the model. Add `run: true` if the lesson should open with results already on screen. |
| `slots` | Live numbers used anywhere in the lesson. See [Slots and asserts](#slots-and-asserts). |
| `permissions` | What the lesson may do beyond looking and computing. See [Permissions](#permissions-and-the-install-sheet). |
| `verified_rows` | The recorded rows this lesson cites. Pry's own lessons use it; you can leave it out. |
| `tool_min` | The oldest Pry version the lesson works in. |
| `limits` | What the lesson's results don't show. |
| `authors` | Credit, as a list of names: `authors: ["Sam Lee", "Ada"]`. The install sheet shows them ("by Sam Lee, Ada"), so use the name you want learners to see, or leave the field out. |
| `license`, `version` | Licence and your own version number. |

## Sections and section state

Each `## heading` starts a section. Add attributes in braces at the end of the heading:

```markdown
## Guess first {id=guess-first}
## A bigger model {id=bigger depth=optional}
```

`id` names the section (a slug of the heading if you leave it out). `depth=optional` marks a section learners may skip; sections are core by default.

**Section state.** Each section opens where the one before left off, after its steps. A section's own steps wait for the learner. Put `reset: true` in `enter` to start from the lesson's baseline.

An `:::enter` block at the top of a section changes the app before the learner reads anything. Its body is YAML: Pry's own state keys, like opening a panel or setting the prompt, plus `reset: true`. Like the baseline, setting a prompt here doesn't run the model: add `run: true` for that. An `enter` block can't download, use the network or open a link.

```markdown
:::enter
reset: true
open_panel: logit-lens
:::
```

A later section's `enter` always wins over an earlier section's steps. Nothing before a `reset: true` comes back.

A section can also declare its own live numbers in a `:::slots` block (see [Slots and asserts](#slots-and-asserts)).

## Step kinds

Every step is a container that opens with `:::kind{attributes}` and closes with `:::`. Leave a blank line before every `:::` line and after every closing `:::`. Give a step a stable `id` if anything refers to it. Structured fields go in a ```` ```yaml ```` fence inside the step (attributes work too), and a `do` step's actions go in an ```` ```actions ```` fence. A step that holds other steps (`fold`, `transfer`) opens with one more colon than the steps inside it: `::::fold{title="..."}` ... `::::`, with `:::` steps inside.

```markdown
:::predict{id=guess checks=look-top}
What do you think the model puts first?

```yaml
choices:
  - { text: "\" Paris\"", feedback: "That's what a person would say. Run it and see if the model agrees." }
  - { text: "\" the\"", feedback: "Short, common words come up a lot. Run it and see where it ends up." }
remember: first-guess
```
:::
```

| Kind | Fields | What it's for |
|---|---|---|
| `explain` | Prose. Optional `image` with a required `alt`. | Teaching text. Images must be local files in the lesson folder, 1 MB or under. |
| `analogy` | `like`, `because`, `breaks` (required, not empty), optional `withdrawn_in` (a lesson id). | A comparison that helps, and where it stops helping. You don't need one at all. A section can have one on the main path, at most; analogies inside a `fold` don't count. |
| `simplification` | Prose, plus `corrected_in` (a list of lesson ids). | An aside that admits the picture's simpler than the truth and names the lesson that fixes it. |
| `fold` | `title`. | Collapsed extra depth: names that aren't needed on the main path, results from larger models. |
| `recall` | An optional opening question, `from` (a lesson id), choices or free text. | Brings back something from an earlier lesson. Saved to the journal only. |
| `question` | `choices: [{text, target?, feedback}]` (feedback shows straight after the learner commits; `reveal: false` holds it back; `target` tags a misconception, as on a predict), or `free: true` with `model_answer`, or `pick: token` / `pick: head`. Optional `remember`, `on_skip`. | A question with an authored answer. It isn't checked against the app. |
| `predict` | `choices: [{text, target?, feedback}]`, or `free: true`, or `pick: token` / `pick: head`. Optional `hides: [anchor]`, `skip_check`, `remember`, `on_skip`, and `checks=<observe id>`. | The learner commits to a guess before the app answers. Every predict gets **Skip, just show me** for free. |
| `do` | An instruction plus an `actions` fence. Optional `capture: <name>`, `fresh: true`. | Drives the app when the learner presses **Do it**. An action that shows its own panel, like `search_concepts`, opens it itself, so you don't need `open_panel` first. |
| `observe` | `check:` (one item or a list, all must hold) or `journal: true`. Optional `assert`. An expected value goes on the check item, never on the observe itself (see [Checks](#checks)). | Compares what the app shows with the prediction or the lesson's expected value. |
| `compare` | `columns:` with 2 to 5 entries, each a readout `{read, args, from?}`, a view `{view, args}` or `{text}`. Optional `same_question`. | Results next to each other. |
| `explain-result` | `supports` and `leaves_open` (both required). `tool:` when the section or the one before ran a tool action. `skeptic: {says, check}` at stage 2 and 3. Optional `limits`. | What the result supports, and what it leaves open. |
| `transfer` | `prompt`, `expect_if_explanation_holds`, `limits`, and its own predict and observe (or a `task`, when the learner sets it up). | Tries the idea on a new case. |
| `task` | `target` and `constraint` (lists of check items), runner rules, `reset`, optional `remember`. | The learner works toward a goal. See [Tasks](#tasks). |
| `explain-chain` | A free-text prompt plus `model_answer`. Optional `assert`: its `say` is a clause of the model answer, and `else` replaces it when the numbers don't back it. | The learner writes out the whole chain. Skipping asks once: "Writing it down is what makes it stick. Skip anyway?" |

**`analogy` in full.** It has the most required fields, so here's one whole:

```markdown
:::analogy{id=autocomplete}
```yaml
like: "Your phone's autocomplete suggesting the next word."
because: "Both look at what's typed so far and rank what could come next."
breaks: "Your phone suggests whole words. The model ranks tokens, and a token can be half a word."
```
:::
```

**`predict` in more detail.** `hides` keeps a region hidden until the learner commits or skips. `skip_check: {when: [{step, choice}, ...], skip: [section ids], reason_step?}` lets a learner who got several predicts right skip ahead; every `when` entry has to match. `remember: <key>` saves the answer for later (see `:earlier` and `$earlier`). `on_skip` is text shown only to a learner who pressed **Skip, just show me**.

## Inline marks

| Mark | What it does |
|---|---|
| `:look{at=prediction-bar token=" Paris"}[the bar]` | Points at part of the app. Anchor arguments are checked like action arguments: the names and the types, not the values. The checker can't know whether a token like `" Pariss"` will be on screen, so spell it the way your recorded run shows it. `at=[a, b]` points at each in turn. `at=lesson:spine` (add `box=training` for one box), `at=lesson:step:<id>` and `at=lesson:image:<id>` point inside the sidebar. |
| `{name}` | A live number from a slot. |
| `:earlier{key="yourname.first-lesson.first-guess"}[fallback]` | The learner's earlier answer, or "skipped", or "You haven't done that lesson yet". |
| `:spine{mask=embedding}` or `:spine{mask=embedding..logits}` | Masks one spine box, or a range, as a single "?" until the section reveals it. |
| `:refutes[text]` or `:refutes{target=M4}[text]` | Marks a line that tests the everyday picture and knocks it down. A `target` (one id or a list) tags the misconception it answers. The copy rules treat it differently (see below). |

Links in prose may be `http` or `https` only, plus `lesson:<id>#<section>` to point at another lesson. Every link host must be listed in `permissions.external`.

The names you can use (`prediction-bar`, `top_guess.token`, `run`, and the rest) are listed in `ACTIONS.md`, generated from Pry's own registry.

## Action arguments: `$row` and `$earlier`

Action arguments are plain YAML values, or one of two references:

- **`$row.<id>.<field>`** reads a constant from Pry's recorded rows, like the top induction head for a prompt. The row id has to exist.
- **`$earlier.<key>`** uses the learner's earlier answer (a picked head, a chosen word). It always needs a `fallback:` for learners who skipped.

`enter` blocks may use both, checked the same way. An `$earlier` key must be written by some `remember` (on a predict, a question or a task).

## Slots and asserts

**Every number a learner reads in a lesson is a slot.** A slot is bound to a live readout, so the text always matches the screen and teaches from the learner's own run. You never type a number into prose: a typed number drifts the moment the model, the library or the prompt changes, and the checker rejects bare percentages, decimals, layer and head labels like `L9H9`, and counts in prose.

```yaml
slots:
  top: { read: top_guess.prob, expect: 0.21, tolerance: 0.02 }
  clean: { read: patch.cell, args: { layer: 9, position: last-diff }, field: clean, from_capture: before, expect: 3.21, tolerance: 0.05 }
```

Declare slots in the front matter (the whole lesson) or in a section's `:::slots` block. Use them in any step's text, choices, feedback, task fields, `leaves_open` and the limits box, as `{top}`.

Each slot renders through its readout's unit:

| Unit | Renders as |
|---|---|
| probability | A percentage with its natural frequency: "9.7% (about 1 in 10)" |
| logit | Two decimals |
| layer | Pry's own label, like "L8" |
| count, position | A whole number. Token counts and positions include the start marker Pry puts first (see [Getting real expected values](#getting-real-expected-values)). |
| string | Quoted as Pry returns it |

A slot whose readout doesn't exist yet shows "(appears after you run it)".

**Where a slot can go.** A slot that reads a result can sit in three places:

- anywhere after the first do step that runs the model,
- in that do step's own instruction (it fills in when the step runs),
- in a predict choice's feedback, even when the predict sits above the do step. Feedback shows once its observe answers it, and that's after the run.

Anywhere else above that do step is an error, on your lessons too, because the learner would read "(appears after you run it)" there. A baseline or `enter` that only sets a prompt hasn't run anything yet, so it doesn't count as the run.

- **`expect`** is the value a real run showed. Checks and Pry's drift tests compare against it, and author mode shows it beside the live value. It's required on lessons that ship with Pry. On yours, a missing one is a warning. [Getting real expected values](#getting-real-expected-values) says how to record it.
- **`tolerance`** is how far the live value may sit from `expect`, in the readout's own units, either way. `expect: 0.08, tolerance: 0.02` on a probability accepts anything from 0.06 to 0.10. Without one, a number has to match almost exactly, so give probabilities and logits a tolerance.
- **`expect: learner`** marks a slot that shows the learner's own result: something a task, a picker or a learner's own run produced.
- **Constant slots** bind a recorded row instead of a readout: `{ row: <id>.<field> }`. They render like a readout of the same unit. Use them for fixed names from the literature, like a named head.
- **Derived slots** compute from other slots: `from: [...]` plus a `formula`. A derived slot can only appear in a step that also shows every slot it comes from. A share never shows up alone, and that's on purpose: the learner should see what it's made of.

  | Formula | `from` | Gives |
  |---|---|---|
  | `share` | `[clean, corrupted, patched]` | (patched - corrupted) / (clean - corrupted). Shows as a percentage. Shows nothing when clean and corrupted are equal. |
  | `difference` | `[a, b]` | a - b |
  | `sum` | `[a, b, ...]` | Every slot added up. |
  | `abs` | `[a]` | The size of a, without its sign. |
  | `ratio` | `[a, b]` | a / b, like "about 29 times as likely". Nothing when b is 0. |
  | `ln` | `[a]` | The natural log of a, which turns a ratio of probabilities into a logit difference. Nothing when a isn't above 0. |

- **`format`** overrides how a slot renders: `probability`, `logit`, `layer`, `count`, `position`, `string` or `number`. Leave it out and the slot uses its readout's unit, which is almost always what you want.

**Asserts** keep wording honest. Words like "a lot", "most", "barely" or "almost all" only appear in an assert, which picks one line or the other from live values:

```yaml
assert:
  - require: { slot: share, op: gt, value: 0.5 }
    say: "Patching this one spot brings back a lot of the difference."
    else: "Patching this one spot brings back part of the difference."
  - require: { slot: gap, op: lt, slot2: bars_total, abs: true }
    say: "The bars add up close to the real logit."
    else: "The bars and the real logit are far apart here."
```

`slot2` compares two live slots, and `abs: true` compares their sizes.

## Checks

**One observe, one comparison.** Read this first. An observe answers its predict with one message. A list of check items must all hold, so a list that mixes `$prediction` with an expected value fails whenever the learner guessed something else, even when the app shows exactly what you expected. Pick one: `$prediction` to tell the learner how their guess did, or `$slot.<name>` / `expect` to confirm the app shows what the lesson says. The predict's choice `feedback` can then say the rest, with slots in it. With `$slot.<name>`, the learner's guess gets "The app shows what the lesson expected" as its reply whatever they picked, so put what the slots show in each choice's feedback, and that's where the guess gets its answer. The rest of this section says how each one is written.

An observe's `check` is one item or a list, and a list must all hold:

```yaml
check: { read: top_guess.token, op: equals, value: $prediction }
```

**Operators:** `equals`, `in`, `changed_from`, `gt`, `lt`, `increased`, `decreased`, `within`, `contains`, `starts_with`. Add `not: true` to flip any of them. The operator has to suit the readout's type, and prose readouts can never be checked. The value has to suit it too: comparing `top_guess.prob` (a number) with token choices or with `" Paris"` can never hold, so the checker fails it.

**Checking against the lesson's expected value.** There are two ways, and both put the value on the check, never on the observe:

```yaml
# Compare with a slot's expect. The slot holds the recorded value; the check reuses it.
check: { read: top_guess.token, op: equals, value: $slot.top }

# Or give the check its own expect and no value.
check: { read: top_guess.token, op: equals, expect: " London" }
```

`$slot.<name>` means that slot's `expect`, not its live value (a slot always equals its own live value, so that check would mean nothing). The slot has to exist; a typo like `$slot.tpo` is an error. An `expect` written on the observe itself is an error too, because nothing reads it.

**Checking against the prediction.** `value: $prediction` compares with the choice the learner picked. Choice text written in quotes compares as the text inside them, so `"\" Paris\""` compares as ` Paris`, leading space included. Write the space the way the model's token has it: ` Paris` and `Paris` are different tokens.

A check item can also take:

- `from: <capture>` to read the readout from an earlier capture instead of the live app, so one observe can compare two stored runs: `{ read: write_it.text, from: a, op: equals, value: $capture.b.write_it.text }`.
- `field: <name>` (and `value_field` for the value's readout) to check one field of a record readout: `{ read: prediction, args: { token: " Sam" }, field: rank, op: lt, value: 11 }`.
- `value_args` to give the readout in the value its arguments, for `$read`, `$capture`, `$before` and `$baseline` alike.
- `tolerance` (for `within`) as a number or a `$slot.<name>` / `$row.<id>.<field>` binding, in the readout's own units, either way.
- `expect`: the value a real run gives this readout. Without a `value`, the check compares with it. With a `value`, Pry's drift tests also hold the live readout to it, unless the value is `$prediction` or `$earlier` (those need a learner).

**What a value can be:**

| Value | Means |
|---|---|
| a constant | Exactly that. |
| `$prediction` | What the learner picked in the predict this observe answers. |
| `$before.<readout>` | The readout before this section's do steps ran. |
| `$baseline.<readout>` | The readout in the lesson's baseline state. |
| `$capture.<name>.<readout>` | A readout stored by an earlier `capture`. |
| `$earlier.<key>` | The learner's earlier answer. |
| `$read.<readout>` with `value_args` | A second live readout. |
| `$slot.<name>` | That slot's `expect`: the value a real run showed. |
| no `value`, with `expect` on the item | The item's own `expect`. |
| `$row.<id>.<field>` | A constant from Pry's recorded rows (Pry's own lessons). |

The message the learner sees names what the app was compared with: "The app agrees with your prediction", "The app shows what the lesson expected", or "The app shows something different from your prediction: ..." with what it showed. Feedback never says "wrong", "correct" or "great job". It says what happened and why.

## Captures

`capture: <name>` on a do step stores the readouts the lesson cites from that run, under that name, after its actions finish. Compare columns, slots (`from_capture`) and checks (`$capture.<name>.<readout>`) can read it later.

One capture per do step. Five runs you want to compare are five do steps, each with its own capture, judged by one observe that reads all five.

If a do step repeats an earlier do step's actions and arguments, add `fresh: true`, so pressing **Do it** always runs it again.

## What replays when a learner goes back

When a learner jumps to a section, Pry rebuilds the app by going through every section before it in order: each section's `enter`, then its do steps. Only `view` and `compute` actions replay. Downloads, network lookups and links run only when the learner presses **Do it**.

So:

- Any do step that writes text with `temperature` above 0 needs a `seed`, or replay would land somewhere different each time.
- A later section can't depend on a result that only a download, a network lookup or a link produces, unless it has its own do step for it.
- A replayed switch to the model that's already loaded does nothing. A replayed switch to a different model stops there and shows the model banner, so later steps never run on the wrong model.
- Replay never stores a capture and never opens a link.

## `when`: showing a step only sometimes

Any step can carry `when: {read, args, op, value}` (one check item). The step shows only while that holds. Every `when` step needs a sibling in the same section with the opposite `when`, so learners always see one of the two. It's conditional display, not branching: both paths stay in the same section.

```yaml
when: { read: top_guess.token, op: equals, value: " Paris" }
```

## Tasks

A `task` gives the learner a goal and lets them work toward it.

- `target`: check items that mean "done". Values may read captures or `$earlier`.
- `constraint`: check items that must hold before every run. For "one head at a time", use `{ read: ablation.head_count, op: equals, value: 1 }`: stacking heads is refused, and swapping one head for another is fine.
- Runner rules: `max_runs: n`, `predict_before_each_run: true`, and `one_change: <action>` (between runs the learner changes exactly one argument of that action; for `set_compare`, one word of one prompt).
- `capture: <name>`: stores the readouts of the learner's last run, for a later check or slot (`expect: learner`).
- `learner_actions: [names]`: the actions the learner drives during the task, like `[set_head_ablation, run_head_ablation]`. The checker makes sure each one exists.
- `reset`: the `enter`-style state to return to.
- `remember: { key, read }`: stores a readout's value when the target is met or the learner moves on.

## Permissions and the install sheet

Most actions only look at the app or compute something, and those run freely. Anything else has to be declared in `permissions`, and the learner OKs it once, when the lesson is installed:

```yaml
permissions:
  download: [gpt2-medium]
  network: [neuronpedia]
  external: [arxiv.org]
```

- `download`: models the lesson may switch to (that can download weights). The names are the ones under "Models" in `ACTIONS.md`.
- `network`: services the lesson may look things up on. `ACTIONS.md` lists them under "Services", with the actions that use each one. Today there's one, `neuronpedia`, which `search_concepts` needs.
- `external`: hosts the lesson may open links to, prose links included. A host matches itself and its subdomains, so `arxiv.org` covers `export.arxiv.org` but never `evilarxiv.org`.
- `cost` is reserved for a later Pry. The schema accepts it so lessons written for that Pry still open, but no action uses it yet, so leave it out.

The checker fails a lesson that uses anything it didn't declare, and Pry blocks it at run time and writes it to the log. It warns about a declared permission you never use.

**Network steps can't be checked.** A network action opens its own panel (`search_concepts` opens the Steering tab, so you don't need `open_panel` first) and shows what the service sends back. For `search_concepts`, the results show inside the Find a concept box, so point a `:look` at `concept-search` to send the learner there. No readout reads that answer, so no observe can check it, and it doesn't replay when a learner goes back. Put a lookup in its own section, often an optional one, and don't build a later check on it. Recording the lesson from a terminal leaves the lookup out unless you add `--network`, because sending it contacts `www.neuronpedia.org` (see [Getting real expected values](#getting-real-expected-values)).

Pry stores what the learner OK'd against the lesson's id, its folder and its permissions. If you add a permission later, Pry asks for the new one only. If you remove one, it drops without asking. A different folder with the same id gets nothing. Learners can revoke a lesson's permissions in Settings > Lessons.

Lessons that ship with Pry don't ask. They're trusted, and yours aren't until the learner says so.

## Drafts and author mode

`draft: true` hides a lesson from the list. Turn on **Show draft lessons (author mode)** in Settings > Lessons to see it. Author mode also shows:

- a Draft badge on draft lessons,
- each step's id beside it,
- "Author notes" at the top (anything Pry dropped while loading, and why),
- a **Re-run this section's setup** button,
- every slot's value with its expected value beside it.

The checker warns about `draft: true` and fails it under `--release`. When the lesson's ready, delete the `draft` line or set `draft: false`. Both work.

Author mode changes what Pry shows. It doesn't change the checker: **Check this lesson** and `lessons-lint.mjs` run the same rules either way.

## Strict and lenient

**Strict** is what the checker uses: any key Pry doesn't know is an error.

**Lenient** is what Pry uses when it loads a lesson. It may drop unknown keys, but only on the parts that just change how things look: front matter metadata, `explain`, `analogy`, `fold` and images. Each dropped key shows in Author notes. An unknown key anywhere that drives the app or checks the learner (`check`, `slots`, `assert`, `actions`, `enter`, `predict`, `question`, `when`, `task`, `permissions`, `baseline`) is still an error, and Pry never drops a permission entry.

Write for strict. Lenient's there so a lesson written for a slightly newer Pry still opens, and you shouldn't lean on it.

## The copy rules

The checker carries Pry's style rules. The big ones:

- **Explain, don't rename.** Real names stay: logit, residual stream, DLA, SAE, activation patching, embedding, attention head. Put plain language beside the name. A term has to be introduced before it's used, at most one new term per section and three per lesson. "Term" means a name from Pry's term list, `terms.yaml` (it ships inside the linter). Pry's own lessons are checked against the order of that list. Yours sit outside it, so the checker counts only what you declare in `new_terms`: list each name your lesson teaches for the first time, and explain it the first time it appears. A word you only gloss in passing, in one clause, on the way to something else, doesn't need to go on the list. List the ones the lesson is there to teach. Whether a word is also in `terms.yaml` doesn't matter for your lesson, and the checker says nothing while you're within the budget. (With Pry's source, the list is `ui/src/lessons/terms.yaml`.) If you need more than three, set `term_budget_exception` with your reason.
- **Metaphors explain; they never name.** Every `analogy` needs a `breaks` field that says where the comparison stops working.
- **Banned model verbs.** Don't say the model "knows", "thinks", "wants" or "understands" in your own prose. Those words are fine inside a predict or question choice, its feedback, a `:refutes[...]` span or a code block, because that's where a learner tests them.
- **Numbers are slots.** No bare percentages, decimals, layer or head labels, or counts in prose. Wrap fixed labels in inline code or use a constant slot.
- **Qualitative words go through asserts.** "A lot", "most", "barely" and their friends belong in an assert's `say` or `else`.
- **One exclamation mark per lesson, at most.**
- **Feedback says what happened.** Never "wrong", "correct" or "great job".
- **Results carry their limits.** An `explain-result` in a section that ran a `compute` action (or right after one) needs `tool:` naming the tool whose result it explains, and the checker makes sure that tool's caveat sits beside the result. The tools are `dla`, `circuit`, `compare`, `features`, `neuronpedia`, `logit-lens`, `predictions`, `attention`, `patching`, `ablation`, `feature-ablation`, `steering`, `write-it`, `embedding` and `tokens`. A `network` action like `search_concepts` isn't a compute action, so a result after it alone doesn't need `tool:`. A section doesn't have to end in an `explain-result` at all, and the checker doesn't ask for one; an optional lookup section can stop at the lookup.

## Voice

Pry's own lessons go through a voice check that's part of Pry's toolchain. It isn't shipped. When you write a lesson, run the bundled checker, whose copy rules carry the style guide's checklist, and write like this:

- Write the way you'd explain it across a table. Use contractions. Don't lecture.
- Put a person or the model in the sentence doing the thing. "The model puts Paris first" beats "Paris emerges as the top prediction."
- Say what happened and why. Skip the cheering and the grading.
- One idea per sentence. Short paragraphs.
- Keep the real name, and explain it beside the name.

## Getting real expected values

Every `expect` is a value Pry showed on a real run. Never guess one. GPT-2 small often disagrees with what a person would say: on "The Eiffel Tower is in the city of" it puts " London" first and " Paris" second. A lesson that says otherwise teaches something that isn't true, so record first, then write the claim around what you got.

While you don't have a value yet, write `expect: pending` and check with `--skeleton` (see [Checking your lesson](#checking-your-lesson)). `--release` fails any `pending` that's left.

**In Pry, no setup.** Turn on author mode (see [Drafts and author mode](#drafts-and-author-mode)), open your lesson and run each section. Pry shows every slot's live value with your `expect` beside it. Copy the live value into `expect`, add a `tolerance`, and save. The lesson reloads where you were. This is the only route if you don't have Pry's source.

**From a terminal, with Pry's source.** Pry's repo can record a lesson set through Pry's own sidecar, the same way it records its own lessons. You need Node 18 or newer and the sidecar set up as in [Set up the sidecar for recording](#set-up-the-sidecar-for-recording).

**A lesson set is a folder of lesson folders.** The recorder works on a set, never on one lesson folder by itself, because it writes a `__generated__` folder beside the lessons. The set folder's name is yours: it isn't an id, it needs no dot, and nothing loads it as a lesson. Don't start it with `_` or `.`, though, because the checker skips folders named like that. Pry's two examples are the worked case:

```
docs/lessons/examples/
  community-sample/                  <- a set
    community.first-token/lesson.md  <- a lesson folder, named after its id
    __generated__/
      expectations.json
      responses/<key>.json
  second-look/                       <- another set
    community.second-look/lesson.md
    __generated__/...
```

Put your lesson in a set of its own, like `my-lessons/yourname.first-lesson/`, so your `__generated__` folder never lands beside someone else's lessons. The set doesn't have to be inside Pry's repo. You run the commands from the repo's `ui/` and `sidecar/` folders, and `--dir` and `--lesson-dir` take any path, so `C:\Users\you\Documents\my-lessons` works as well as a folder in the repo.

1. In `ui/`, run `npm ci`, then `npm run lessons:compile -- --expectations --dir <set>`. That walks each lesson through Pry's real actions and writes `<set>/__generated__/expectations.json`: every request the lesson sends (each with its `key`), its prompts, and the expected values it declares. It runs as one of Pry's tests, so you'll see a test banner first, something like `Tests 3 passed | 1 skipped`. That's Pry checking its own files, and the skip is one of Pry's own checks that a `--dir` run doesn't need, not your lesson. The last line is the one that matters: `wrote <set>\__generated__\expectations.json: ...`. Slots still marked `expect: pending` are left out of the file until they have a value; that's expected. A lookup like `/concept-search` is listed too, with its `key`, because the recorder reads its list from this file. Listed isn't sent: step 2 still leaves it out unless you add `--network`.
2. In `sidecar/`, run `python -m pytest tests/test_lessons.py --record --lesson-dir <set>`. That sends each request to the sidecar and saves the response in `<set>/__generated__/responses/<key>.json`, one file per request, with the model revision and device inside. It ends with a block headed `lesson set`, after pytest's warnings and just above the `1 passed, 75 skipped` line, so `| tail` shows it. The block lists each file it wrote and any lookup it didn't send. The skips are Pry's own recorded rows, which a `--lesson-dir` run leaves alone. The warnings (an SAE `UserWarning`, a starlette `DeprecationWarning`) come from the libraries and don't mean anything went wrong.
3. Open the response for your prompt: the file named after the request's `key` in `expectations.json`. The sidecar's answer sits under its `response` key. Next to it, at the top level, are `key`, `request`, `model_revision`, `device` and a few more fields about the recording. So the readouts are at `response.top_predictions` and `response.tokens`:

   ```
   {
     "key": "9eef2a75...",
     "request": { ... },
     "model_revision": "...",
     "device": "cpu",
     "response": {
       "tokens": ["<|endoftext|>", "On", " a", ...],
       "top_predictions": [
         { "token": " a", "probability": 0.11580509692430496, "rank": 1, "logit": 14.844558715820312 },
         ...
       ]
     }
   }
   ```

   `top_predictions` holds each token's probability, logit and rank. `tokens` is the prompt as tokens, and it starts with the start marker, `<|endoftext|>`, which Pry puts in front of every prompt. Set your `expect` values from these. Rounding is fine: three or four significant figures, like `0.1158` for the probability above, with a `tolerance` (say `0.02` on a probability) that covers the difference. Tokens and counts get copied exactly. Then run step 1 again so `expectations.json` carries them.
4. Run the checker on the set (see [Checking your lesson](#checking-your-lesson)). It walks your lesson against the responses in `<set>/__generated__/responses/` and reports any `expect` the recording doesn't back. Later, `pytest tests/test_lessons.py --lesson-dir <set>` (no `--record`) replays the requests and fails if the model's answers drift.
5. **Commit the `__generated__` folder with your lessons.** The responses are what the checker tests your `expect` values against, on your machine and on anyone else's. A set shared without them still checks, but every `expect` gets a warning that it can't be tested.

**Token counts include the start marker.** Pry puts `<|endoftext|>` in front of every prompt, so `token_count` is one more than the tokens of your own text, and positions count from it: the start marker is position 0 and your first token is position 1. `word_tokens` counts only the tokens that spell the word you name, never the start marker.

**Recording a lesson with a `network` step.** A `search_concepts` step sends its search text to Neuronpedia, at `www.neuronpedia.org`. The recorder doesn't send it unless you ask: without `--network`, it records and replays everything else, keeps any lookup response that's already in `responses/`, and lists each lookup it didn't send. That's the offline route, and it's enough, because no readout reads a lookup's answer, so no `expect` depends on it. Add `--network` to step 2 to send the lookup and save its answer too.

**`rows.json` and `expectations.json`.** Pry's own lessons cite recorded rows. `ui/src/lessons/__generated__/rows.json` holds each checked claim's measured values, and `expectations.json` lists every request the lessons send. Your lesson doesn't need a `rows.json`. What the checker does with your set's `__generated__` folder:

- A prompt that isn't in `expectations.json` is a warning, when that file exists.
- A lesson with `expect` values and no recorded response for a request in `responses/` gets a warning that says the checker can't test them and points here.
- An `expect` the recorded response disagrees with is a warning, and an error under `--release`. So a clean `--release` run means every `expect` matches a real run.
- A missing `expect` is a warning on your lessons.

## Set up the sidecar for recording

The terminal route runs Pry's sidecar from a fresh clone of Pry's repo. You need Python 3.11 or 3.12 (`sidecar/pyproject.toml` allows nothing newer yet). Plain `python` may be a newer one, so make the venv with a 3.12 by name. The steps are the ones in `sidecar/README.md`:

```
cd sidecar
py -3.12 -m venv .venv          (macOS/Linux: python3.12 -m venv .venv)
.venv\Scripts\activate          (macOS/Linux: source .venv/bin/activate)
python --version                (should say 3.11 or 3.12)
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[dev]"
```

Install CPU torch first, from the CPU index, so the second step doesn't pull a CUDA build. It stays the CPU build after the second step. The second step can take ten minutes or more, most of it downloads, and it can sit quiet for a while. It hasn't hung.

**On a machine with an NVIDIA graphics card, install the CUDA build instead.** Pry runs the model on the graphics card whenever it can, and a recording should come from the same place Pry runs. Swap the CPU line above for `pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124` (that's the build Pry itself installs). The recorder checks this: if `nvidia-smi` finds a card but torch can only use the CPU, `--record` stops and prints that command. To record on the CPU anyway, add `--device cpu`. Each response file says which device recorded it in its `device` field.

If the venv ended up on 3.13 or 3.14, torch still installs into it, and then `pip install -e ".[dev]"` stops with `requires a different Python: 3.14.2 not in '<3.13,>=3.11'`. Delete the `.venv` folder and make it again with the command above. The recorder checks too: on any Python other than 3.11 or 3.12, `--record` and `--lesson-dir` stop straight away and say which Python you have and the command to fix it.

Then download GPT-2 small and its SAE once (about 600 MB, into the Hugging Face cache). The recorder doesn't download them itself; it stops and prints this same command if GPT-2 small is missing:

```
python -c "from pry_sidecar.presets import PRESETS; from pry_sidecar.registry import REGISTRY; REGISTRY.load('gpt2-small', PRESETS['gpt2-small'])"
```

If you'd rather skip all of this, record in Pry's author mode instead (above).

## Checking your lesson

**In Pry:** Settings > Lessons > **Check this lesson** runs the full strict check and lists every problem as "Section N, step `id`, line L: ...".

From a terminal, each message starts with the file and line, so an editor can jump to it, then says the same thing. An error looks like this:

```
my-lessons\yourname.first-lesson\lesson.md:27: Section 2, step `run-it`, line 27: There's no action called `set_promt`. Did you mean `set_prompt`?
```

A warning has `warning:` after the line number. Front matter messages point at the field's own line where the checker can tell which field it is (`draft`, `new_terms`), and at line 1 otherwise.

An `expect` the recording disagrees with gets one message for each step that shows the slot or checks against it, pointing at that step. Each one also names the line where the slot's `expect` sits, which is the line you'll change:

```
my-lessons\yourname.first-lesson\lesson.md:54: Section 1, step `see-top`, line 54: The slot `{top_tok}` doesn't match the recorded response: live " a", expect " the". Its `expect` is on line 16. Set the `expect` from the response in ...
```

A predict choice's feedback that shows the slot doesn't get a message of its own. It's checked at the observe that reveals it, and that observe's message covers it.

**From a terminal:** Pry ships the same checker as a single file. Settings > Lessons > **Copy linter command** copies the full command. Without Pry installed, build it from Pry's source: in `ui/`, run `npm ci` and then `npm run build:cli`, which writes `ui/build-cli/lessons-lint.mjs`. It needs Node 18 or newer:

```
node lessons-lint.mjs <folder> [--release] [--skeleton] [--bundled]
```

`<folder>` is one lesson folder, or a folder that holds lesson folders (it looks a couple of levels down). `node lessons-lint.mjs --help` prints the same summary.

On your lessons, the checker also walks each lesson through Pry's real actions and holds every `expect` to the responses recorded in its set's `__generated__/responses/` (see [Getting real expected values](#getting-real-expected-values)). It can't run the model, so with no recording it warns instead of guessing.

| Flag | What it does |
|---|---|
| `--release` | Also fails `draft: true`, `expect: pending`, and any `expect` its recorded response disagrees with. Run it before you share a lesson. |
| `--skeleton` | Allows `expect: pending` while you sketch a lesson out. `--release` overrides it. |
| `--bundled` | Checks the lesson as one that ships inside Pry: a missing `expect` or an unrecorded prompt becomes an error, permissions aren't checked, and `pry.` ids pass. It's for Pry's own lessons. A clean `--bundled` run doesn't mean Pry will load yours: Pry still refuses a `pry.` id from you. |

Pointing it at Pry's own lesson folder (`ui/src/lessons`, or one lesson folder inside it) turns on `--bundled` by itself. `_template` stays a user lesson.

It exits 0 when every lesson is clean, 1 with line-numbered messages when any lesson has an error, and 2 when the folder is wrong. Warnings never change the exit code.

## Versions

Every lesson says `format: 1`. Changes inside format 1 only add things. If Pry ever needs a breaking change, it ships as format 2, and Pry converts format 1 lessons when it opens them. A lesson written for a newer format than your Pry knows says so: "This lesson uses lesson format N. Update Pry to open it."

Actions and readouts can be renamed between Pry versions; the old name keeps working for one major version and the checker warns about it. Set `tool_min` if your lesson needs a newer Pry.
