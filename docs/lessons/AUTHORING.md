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
18. [Checking your lesson](#checking-your-lesson)
19. [Versions](#versions)

## From the template to an installed lesson

1. **Find the template.** The first time Pry starts, it writes a `_template` folder into your lessons folder. On Windows that's `%APPDATA%\com.beargle.pry\lessons\_template`. It holds `lesson.md` (a small lesson that works) and `README.md`.
2. **Copy it somewhere of your own.** Work in a folder outside Pry's app data, like `Documents\my-lessons\yourname.first-lesson`. Uninstalling Pry can remove its app data, lessons folder included, so keep your own copy.
3. **Pick an id.** Ids look like `yourname.first-lesson`: lowercase letters, digits and dashes, with at least one dot, up to 64 characters, and no leading `_`. Ids starting `pry.` belong to the lessons that ship with Pry, and Pry won't load yours under that prefix. The folder name and the `id` must match. Never change an id once people have it: progress is saved against it.
4. **Write.** Change the title, the summary and the steps. The rest of this page says what each part does.
5. **Check it.** In Pry, open Settings > Lessons and use **Check this lesson**, or run the bundled checker from a terminal (see [Checking your lesson](#checking-your-lesson)). Fix every error. Each one tells you the section, the step and the line, so you won't have to hunt.
6. **Add it.** In the lesson list, choose **Add a lesson...** and pick your folder. Pry copies it into its lessons folder. It skips links and junctions, refuses any image over 1 MB, and refuses a folder over 20 MB.
7. **OK the permissions.** If your lesson declares any `permissions`, Pry shows an install sheet the next time the learner opens the lesson list or Settings > Lessons ("1 new lesson needs your OK"). A lesson with no permissions installs without asking.
8. **Edit while it runs.** Pry watches its lessons folder. Save `lesson.md` there and the lesson reloads within about half a second, on the same section. **Reload lessons** does the same thing by hand.

If a lesson won't load, it still shows in the list. It's greyed out, with the file, the line and the first error, so you'll know where to look.

## The front matter

The YAML block between the `---` lines at the top. Put the schema line first so your editor can autocomplete the fields:

```yaml
---
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/front-matter.v1.schema.json
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

The schema covers the front matter only. It can't check the steps inside the body. That's the lesson checker's job.

**Required:** `format` (always `1`), `id`, `title`, `tool` (`pry`), `summary` (one line), `minutes`.

**Optional:**

| Field | What it does |
|---|---|
| `draft` | `true` hides the lesson unless author mode is on. See [Drafts and author mode](#drafts-and-author-mode). |
| `presentation` | `sidebar` (the default) or `overlay` (a short view-only tour). |
| `stage` | 1, 2 or 3. Stage 2 and 3 results need a skeptic (see `explain-result`). |
| `targets` | Misconception ids this lesson works on. Each needs a predict choice tagged with it. |
| `spine` | Spine boxes this lesson lights, as a list or a range. |
| `new_terms` | The terms this lesson introduces. |
| `term_budget_exception` | Lets a lesson introduce more than three new terms, with a reason. |
| `prerequisites` | Lesson ids to do first. No cycles. |
| `cold_entry` | Markdown shown when the prerequisites aren't done ("What you need from before"). |
| `model` | The model the lesson expects, e.g. `gpt2-small`. Required when anything carries `expect`. |
| `baseline` | The app state every section starts from, e.g. `{ prompt: "..." }`. |
| `slots` | Live numbers used anywhere in the lesson. See [Slots and asserts](#slots-and-asserts). |
| `permissions` | What the lesson may do beyond looking and computing. See [Permissions](#permissions-and-the-install-sheet). |
| `verified_rows` | The recorded rows this lesson cites. |
| `tool_min` | The oldest Pry version the lesson works in. |
| `limits` | What the lesson's results don't show. |
| `authors`, `license`, `version` | Credit, licence and your own version number. |

## Sections and section state

Each `## heading` starts a section. Add attributes in braces at the end of the heading:

```markdown
## Guess first {id=guess-first}
## A bigger model {id=bigger depth=optional}
```

`id` names the section (a slug of the heading if you leave it out). `depth=optional` marks a section learners may skip; sections are core by default.

**Section state.** Each section opens where the one before left off, after its steps. A section's own steps wait for the learner. Put `reset: true` in `enter` to start from the lesson's baseline.

An `:::enter` block at the top of a section changes the app before the learner reads anything. Its body is YAML: Pry's own state keys, like opening a panel or setting the prompt, plus `reset: true`. An `enter` block can't download, use the network or open a link.

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
| `analogy` | `like`, `because`, `breaks` (required, not empty), optional `withdrawn_in` (a lesson id). | A comparison that helps, and where it stops helping. One per section on the main path; analogies inside a `fold` don't count. |
| `simplification` | Prose, plus `corrected_in` (a list of lesson ids). | An aside that admits the picture's simpler than the truth and names the lesson that fixes it. |
| `fold` | `title`. | Collapsed extra depth: names that aren't needed on the main path, results from larger models. |
| `recall` | An optional opening question, `from` (a lesson id), choices or free text. | Brings back something from an earlier lesson. Saved to the journal only. |
| `question` | `choices: [{text, feedback}]` (feedback shows straight after the learner commits; `reveal: false` holds it back), or `free: true` with `model_answer`, or `pick: token` / `pick: head`. Optional `remember`, `on_skip`. | A question with an authored answer. It isn't checked against the app. |
| `predict` | `choices: [{text, target?, feedback}]`, or `free: true`, or `pick: token` / `pick: head`. Optional `hides: [anchor]`, `skip_check`, `remember`, `on_skip`, and `checks=<observe id>`. | The learner commits to a guess before the app answers. Every predict gets **Skip, just show me** for free. |
| `do` | An instruction plus an `actions` fence. Optional `capture: <name>`, `fresh: true`. | Drives the app when the learner presses **Do it**. |
| `observe` | `check:` (one item or a list, all must hold) or `journal: true`. Optional `assert`, `expect`. | Compares what the app shows with the prediction or the lesson's expected value. |
| `compare` | `columns:` with 2 to 5 entries, each a readout `{read, args, from?}`, a view `{view, args}` or `{text}`. Optional `same_question`. | Results next to each other. |
| `explain-result` | `supports` and `leaves_open` (both required). `tool:` when the section or the one before ran a tool action. `skeptic: {says, check}` at stage 2 and 3. Optional `limits`. | What the result supports, and what it leaves open. |
| `transfer` | `prompt`, `expect_if_explanation_holds`, `limits`, and its own predict and observe. | Tries the idea on a new case. |
| `task` | `target` and `constraint` (lists of check items), runner rules, `reset`, optional `remember`. | The learner works toward a goal. See [Tasks](#tasks). |
| `explain-chain` | A free-text prompt plus `model_answer`. | The learner writes out the whole chain. Skipping asks once: "Writing it down is what makes it stick. Skip anyway?" |

**`predict` in more detail.** `hides` keeps a region hidden until the learner commits or skips. `skip_check: {when: [{step, choice}, ...], skip: [section ids], reason_step?}` lets a learner who got several predicts right skip ahead; every `when` entry has to match. `remember: <key>` saves the answer for later (see `:earlier` and `$earlier`). `on_skip` is text shown only to a learner who pressed **Skip, just show me**.

## Inline marks

| Mark | What it does |
|---|---|
| `:look{at=prediction-bar token=" Paris"}[the bar]` | Points at part of the app. Anchor arguments are checked like action arguments. `at=[a, b]` points at each in turn. `at=lesson:spine`, `at=lesson:step:<id>` and `at=lesson:image:<id>` point inside the sidebar. |
| `{name}` | A live number from a slot. |
| `:earlier{key="yourname.first-lesson.first-guess"}[fallback]` | The learner's earlier answer, or "skipped", or "You haven't done that lesson yet". |
| `:spine{mask=embedding}` or `:spine{mask=embedding..logits}` | Masks one spine box, or a range, as a single "?" until the section reveals it. |
| `:refutes[text]` | Marks a line that tests the everyday picture and knocks it down. The copy rules treat it differently (see below). |

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
| count, position | A whole number |
| string | Quoted as Pry returns it |

A slot whose readout doesn't exist yet shows "(appears after you run it)". If you use one in text the learner reads before the step that produces it, that's an error.

- **`expect`** is the value you recorded, used by checks. It's required on lessons that ship with Pry and recommended on yours.
- **`expect: learner`** marks a slot that shows the learner's own result: something a task, a picker or a learner's own run produced.
- **Constant slots** bind a recorded row instead of a readout: `{ row: <id>.<field> }`. They render like a readout of the same unit. Use them for fixed names from the literature, like a named head.
- **Derived slots** compute from other slots: `from: [clean, corrupted, patched]` plus a formula (`share`, `difference`, `sum`, `abs`). A derived slot can only appear in a step that also shows every slot it comes from. A share never shows up alone, and that's on purpose: the learner should see what it's made of.

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

An observe's `check` is one item or a list, and a list must all hold:

```yaml
check: { read: top_guess.token, op: equals, value: $prediction }
```

**Operators:** `equals`, `in`, `changed_from`, `gt`, `lt`, `increased`, `decreased`, `within`, `contains`, `starts_with`. Add `not: true` to flip any of them. The operator has to suit the readout's type, and prose readouts can never be checked.

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
| a slot's `expect` | The value you recorded. |

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

- `download`: models the lesson may switch to (that can download weights).
- `network`: services the lesson may look things up on.
- `external`: hosts the lesson may open links to, prose links included. A host matches itself and its subdomains, so `arxiv.org` covers `export.arxiv.org` but never `evilarxiv.org`.

The checker fails a lesson that uses anything it didn't declare, and Pry blocks it at run time and writes it to the log. It warns about a declared permission you never use.

Pry stores what the learner OK'd against the lesson's id, its folder and its permissions. If you add a permission later, Pry asks for the new one only. If you remove one, it drops without asking. A different folder with the same id gets nothing. Learners can revoke a lesson's permissions in Settings > Lessons.

Lessons that ship with Pry don't ask. They're trusted, and yours aren't until the learner says so.

## Drafts and author mode

`draft: true` hides a lesson from the list. Turn on **Show draft lessons (author mode)** in Settings > Lessons to see it. Author mode also shows:

- a Draft badge on draft lessons,
- each step's id beside it,
- "Author notes" at the top (anything Pry dropped while loading, and why),
- a **Re-run this section's setup** button,
- every slot's value with its expected value beside it.

The checker warns about `draft: true` and fails it under `--release`.

## Strict and lenient

**Strict** is what the checker uses: any key Pry doesn't know is an error.

**Lenient** is what Pry uses when it loads a lesson. It may drop unknown keys, but only on the parts that just change how things look: front matter metadata, `explain`, `analogy`, `fold` and images. Each dropped key shows in Author notes. An unknown key anywhere that drives the app or checks the learner (`check`, `slots`, `assert`, `actions`, `enter`, `predict`, `question`, `when`, `task`, `permissions`, `baseline`) is still an error, and Pry never drops a permission entry.

Write for strict. Lenient's there so a lesson written for a slightly newer Pry still opens, and you shouldn't lean on it.

## The copy rules

The checker carries Pry's style rules. The big ones:

- **Explain, don't rename.** Real names stay: logit, residual stream, DLA, SAE, activation patching, embedding, attention head. Put plain language beside the name. A term has to be introduced before it's used, at most one new term per section and three per lesson.
- **Metaphors explain; they never name.** Every `analogy` needs a `breaks` field that says where the comparison stops working.
- **Banned model verbs.** Don't say the model "knows", "thinks", "wants" or "understands" in your own prose. Those words are fine inside a predict or question choice, its feedback, a `:refutes[...]` span or a code block, because that's where a learner tests them.
- **Numbers are slots.** No bare percentages, decimals, layer or head labels, or counts in prose. Wrap fixed labels in inline code or use a constant slot.
- **Qualitative words go through asserts.** "A lot", "most", "barely" and their friends belong in an assert's `say` or `else`.
- **One exclamation mark per lesson, at most.**
- **Feedback says what happened.** Never "wrong", "correct" or "great job".
- **Results carry their limits.** An `explain-result` after a tool needs `tool:`, and the checker makes sure that tool's caveat sits beside the result.

## Voice

Pry's own lessons go through a voice check that's part of Pry's toolchain. It isn't shipped. When you write a lesson, run the bundled checker, whose copy rules carry the style guide's checklist, and write like this:

- Write the way you'd explain it across a table. Use contractions. Don't lecture.
- Put a person or the model in the sentence doing the thing. "The model puts Paris first" beats "Paris emerges as the top prediction."
- Say what happened and why. Skip the cheering and the grading.
- One idea per sentence. Short paragraphs.
- Keep the real name, and explain it beside the name.

## Checking your lesson

**In Pry:** Settings > Lessons > **Check this lesson** runs the full strict check and lists every problem as "Section N, step `id`, line L: ...".

**From a terminal:** Pry ships the same checker as a single file. Settings > Lessons > **Copy linter command** copies the full command. It looks like this, and needs Node 18 or newer:

```
node lessons-lint.mjs <your-lesson-folder> [--release]
```

It exits 0 when the lesson's clean and 1 with line-numbered messages when it isn't. `--release` also fails drafts.

## Versions

Every lesson says `format: 1`. Changes inside format 1 only add things. If Pry ever needs a breaking change, it ships as format 2, and Pry converts format 1 lessons when it opens them. A lesson written for a newer format than your Pry knows says so: "This lesson uses lesson format N. Update Pry to open it."

Actions and readouts can be renamed between Pry versions; the old name keeps working for one major version and the checker warns about it. Set `tool_min` if your lesson needs a newer Pry.
