# Outsider feedback: writing `community.first-token`

Written by someone who read only `AUTHORING.md`, `ACTIONS.md`, `docs/lessons/schema/*.json`, the `_template` folder, and the linter's output. Linter build: `cd ui && npm ci && npm run build:cli`, then `node build-cli/lessons-lint.mjs <folder> [--release]`.

Each item: what happened, and where I looked. "Docs vs linter" marks a place where the two disagree.

## Setup and the linter command

1. **Which schema line?** AUTHORING "The front matter" puts `schema/front-matter.v1.schema.json` in the YAML line. The template `lesson.md` and `_template/README.md` use `schema/pry-front-matter.v1.schema.json`. Both files exist. I couldn't tell which one I'm meant to use or how they differ. (Comparing them, `pry-front-matter` types `baseline` fully and `front-matter` leaves it open, but nothing says so.) I kept the AUTHORING one.
2. **How do I get the linter without Pry?** AUTHORING "Checking your lesson" says Settings > Lessons > **Copy linter command** gives a path to `lessons-lint.mjs`. It never says how to build or find it from the repo (`npm run build:cli` -> `ui/build-cli/lessons-lint.mjs`). I only knew because the task told me.
3. **Undocumented flags.** `node lessons-lint.mjs --help` prints `[--release] [--skeleton] [--bundled]`. AUTHORING only documents `--release`. Nothing says what `--skeleton` or `--bundled` do. Docs vs linter.
4. **`--bundled` turns off the `pry.` prefix rule.** With `id: pry.first-token`, the plain run errors ("Ids starting with `pry.` belong to the app's own lessons"), and `--bundled` passes it clean. AUTHORING "From the template" step 3 says Pry won't load `pry.` ids from me, but a community author who stumbles on `--bundled` gets a green check for a lesson Pry will refuse. Worth a line in the docs, or a warning in the output.
5. **The help text doesn't explain anything.** `--help` is one usage line. No description of what each flag changes or what exit codes mean (AUTHORING does give 0/1, the CLI doesn't).

## Folder, id and draft

6. **Folder name must match id, but the linter doesn't check it.** AUTHORING step 3: "The folder name and the `id` must match." My folder is `community-sample` and my id is `community.first-token`. The linter passed it clean, with and without `--release`. I also tried `id: community.other` in the same folder: clean. So either the rule is only enforced by Pry at install, or it isn't enforced. The docs don't say which. Docs vs linter. (I kept the folder name I was asked to use; a real install may refuse it.)
7. **How do I "finish" a draft?** AUTHORING "Drafts and author mode" says what `draft: true` does and that `--release` fails it. It never says plainly "delete the `draft` line (or set `draft: false`) when it's ready." I guessed delete; it worked. Is `draft: false` also fine?
8. **The draft warning points at the wrong line.** The warning reads `lesson.md:1: warning: line 1: This lesson is marked draft: true.` My `draft: true` was on line 9. Every front-matter message I saw says `line 1`, so in a long front matter I'd still have to hunt.
9. **The draft warning doesn't say what to do.** It states the fact, but not "remove it before you share the lesson." Compare the analogy error, which says exactly what's missing.
10. **What does author mode change for checking?** The task said author mode is on. AUTHORING "Drafts and author mode" lists what it shows in the app, but nothing it changes in the checker. I assumed nothing; I couldn't confirm it.

## Permissions and `search_concepts`

11. **Which network service names exist?** AUTHORING "Permissions" shows `network: [neuronpedia]` as an example and calls them "services the lesson may look things up on." There's no list. ACTIONS says `search_concepts` is a `network` action that "looks up a concept on Neuronpedia," but the table doesn't name the permission string it needs. The schema allows any string. I only learned `neuronpedia` is the exact spelling from the linter error when I left it out. Please list services (and which action needs which) in ACTIONS.
12. **Undocumented `cost` permission.** Both front-matter schemas allow `permissions.cost` (an array of strings). AUTHORING lists `download`, `network` and `external` only. What's `cost`? Docs vs schema.
13. **Good:** a typo (`neuronpediaa`) got both a warning ("lists it, and no action uses it") and an error on the step that needs the real one. That pair told me exactly what to fix.
14. **Does `search_concepts` need the Steering tab open?** ACTIONS's anchor table puts `concept-search` "in Steering", so I added `open_panel: { panel: steering }` before it. Neither file says whether that's needed, and the linter accepted the step both ways. (I tried it without the panel: clean.)
15. **There's no readout for the concept search result.** I wanted the observe to check what Neuronpedia returned. ACTIONS has no `search_concepts` readout (`features.has_snippets` is the nearest, and it's about snippets on a feature card). So a network step can't be checked. That's fine, but say so, so authors don't go looking. I put the search in an optional last section with no check.

## Slots, `expect` and the observe step

16. **How does an observe use a slot's `expect`?** The observe row in AUTHORING "Step kinds" lists `expect` as an optional field. AUTHORING "Checks", "What a value can be", has a row "a slot's `expect`: The value you recorded" but no syntax. `$slot.<name>` only shows up for `tolerance`. I didn't know if I should write `expect: top`, `expect: " Paris"`, `value: $slot.top` or something else. This was my biggest stall.
17. **The linter accepts any value for an observe's `expect`.** `expect: top` (a real slot), `expect: banana` (no such slot) and `expect: 0.5` all pass clean. So it gave me no signal about which form is right. I went with `expect: top`. Docs vs linter: the docs say strict is "any key Pry doesn't know is an error", and that held for keys (`expekt` got a clear error), but the value is never checked.
18. **`value: $slot.top` also passes.** It isn't documented as a check value, and I can't tell if it means "the slot's live value" (always equal, so a no-op) or "the slot's expect."
19. **Can one observe check both the prediction and the expected value?** The success messages in "Checks" ("agrees with your prediction" vs "shows what the lesson expected") suggest they're different modes. If a learner picks " London", is `check: ... value: $prediction` a fail and `expect` a pass, both shown? Not explained.
20. **"`expect` value from rows.json".** With a slot that has no `expect`, the warning says "The slot `{top}` needs an `expect` value from rows.json." AUTHORING never mentions `rows.json`. As a community author I don't have one, and don't know if I'm meant to make one. AUTHORING "Slots and asserts" only says `expect` is "the value you recorded" and "recommended on yours."
21. **How do I record an `expect` if I can't run it?** AUTHORING says `expect` is the value you recorded, and author mode shows "every slot's value with its expected value beside it." It doesn't say "turn on author mode, run the lesson, copy the numbers into `expect`." That's the workflow I guessed. My `expect: " Paris"` and `expect: 0.35` are guesses, unverified on a real model.
22. **Is `tolerance` relative or absolute?** I wrote `expect: 0.35, tolerance: 0.1` for a probability. Is that 0.25 to 0.45, or plus or minus 10%? Not said.
23. **Undocumented slot fields.** The schemas allow slot `formula: ratio` and `ln`, and a `format` field. AUTHORING lists only `share`, `difference`, `sum` and `abs` and no `format`. Docs vs schema.
24. **Slot used before it exists isn't flagged.** AUTHORING "Slots and asserts": "If you use one in text the learner reads before the step that produces it, that's an error." I put `{top}` in the first section's explain, before any run (the baseline sets a prompt but no `run: true`). The linter passed it clean. Docs vs linter.
25. **Type mismatch in a check isn't flagged.** AUTHORING "Checks": "The operator has to suit the readout's type." I tried `{ read: top_guess.prob, op: equals, value: $prediction }` (a probability against a token choice). Clean. Docs vs linter.
26. **How does `$prediction` match a choice?** The template's choice text is `"\" Paris\""`, with literal quote marks around the token. `top_guess.token` is presumably ` Paris` with no quotes. Do the quotes get stripped? Does the leading space have to match exactly? The docs copy the template and don't explain it. I copied the pattern.
27. **`:look` token arguments aren't checked against anything.** `:look{at=prediction-bar token=" Pariss"}` passes. AUTHORING "Inline marks" says "Anchor arguments are checked like action arguments." I guess that means type-checked only, but it reads like more.

## Copy rules and terms

28. **`new_terms`: what counts as a term?** AUTHORING "The copy rules" says one new term per section, three per lesson, introduced before use. I declared `new_terms: [token]`. I also wrote "feature" and "Neuronpedia" without introducing them, and nothing complained. Is the rule only about what's in `new_terms`? Then how do I know what to put there? Is there a list of known terms from earlier lessons?
29. **Term budget works on the declared list.** Declaring four terms gave a clear error naming `term_budget_exception`. Good. But it doesn't say what goes in the exception ("with the decision that allows more"). The schema says it's a string, but not whose decision, or whether a community author can grant one to themselves.
30. **Good:** banned verbs and bare numbers got specific, fixable messages ("knows" describes the model like a person..., "35%" is a number in the prose...).

## Small things

31. **Redundant location in errors.** Messages print the line twice: `lesson.md:74: Section 3, step find-paris, line 74: ...`. Not wrong, just noisy.
32. **Analogy fields: attributes or a YAML fence?** "Step kinds" says structured fields go in a yaml fence "(attributes work too)". There's no analogy example anywhere, so I guessed the fence. It passed. A one-line analogy example in the table would help, since it's the step with the most required fields.
33. **What's the `explain-result` rule for a network action?** "The copy rules" says a result after a *tool* needs `tool:`. Is `search_concepts` a tool? The linter didn't ask for one. Where's the list of what counts as a tool?
34. **`authors` format.** The table says `authors` is credit. Is it a list of strings, or of `{name, url}`? The schema says a list of strings, and that passed; AUTHORING doesn't say. Minor.

Total: 34 items.

## Dispositions (round 1)

Key: **docs** = fixed in AUTHORING.md (or the generated ACTIONS.md); **lint** = fixed in the checker (`ui/src/lib/lessons/format/lint.ts`, `errors.ts`, `ui/scripts/lessons-lint.ts`), with tests in `lint.test.ts`; **sample** = the lesson changed; **kept** = no change, with the reason.

The lesson moved to `community-sample/community.first-token/lesson.md`: the folder now has to match the id (item 6), and an id needs a dot, so `community-sample` can't be one. This file stays in `community-sample/`, and `lessons-lint.mjs ../docs/lessons/examples/community-sample --release` lints the lesson one level down.

1. **docs.** "The front matter" uses `pry-front-matter.v1.schema.json`, exactly as `_template` has it, and says the other file is for tools other than Pry and leaves `baseline` open.
2. **docs.** "Checking your lesson": build it from source with `npm ci` and `npm run build:cli` in `ui/`, which writes `ui/build-cli/lessons-lint.mjs`.
3. **docs + lint.** A flag table covers `--release`, `--skeleton` and `--bundled`, and `--help` prints the same.
4. **docs + lint.** The `--bundled` row and the `--help` text both say a clean `--bundled` run doesn't mean Pry loads a `pry.` id from you. Also documented: pointing the checker at `ui/src/lessons` turns on bundled mode by itself.
5. **lint.** `--help` describes each flag and the exit codes (0 clean, 1 errors, 2 bad folder). The docs say warnings never change the exit code.
6. **lint.** New error `folder-id`, for user lessons too: the folder name must equal the id. `_` folders (the template) are exempt. Test: `lint.test.ts › the folder name must equal the id`.
7. **docs + lint.** "Drafts and author mode": delete the line or set `draft: false`, both work. The draft warning now says so.
8. **kept, reported.** Front matter messages still point at line 1. Pointing at the key's own line needs the parser to keep front matter line numbers, which is a parse.ts change outside this pass.
9. **lint.** Same fix as 7: the warning now says what to do.
10. **docs.** Author mode changes what Pry shows, never what the checker checks.
11. **docs.** `ACTIONS.md` has a generated "Services" table (from the registry's `services`, with the actions that use each one). "Permissions" points to it and names `neuronpedia` for `search_concepts`.
12. **docs.** `cost` is reserved: the schema accepts it for a later Pry, nothing uses it, leave it out.
13. Good. No change.
14. **docs + sample.** `search_concepts` opens the Steering tab itself. The sample dropped its `open_panel` step.
15. **docs.** "Network steps can't be checked": no readout reads a lookup's answer, it doesn't replay, so put it in its own section.
16. **docs.** "Checks" now shows both ways to check against an expected value: `value: $slot.<name>` and `expect` on the check item. The value table lists `$slot.<name>` and the item's own `expect`.
17. **lint + docs.** An `expect` on the observe itself was never read by anything. It's now the error `observe-expect`, which names `value: $slot.<name>` as the fix. `$slot.<name>` on a slot that doesn't exist was already an error (`slot-unknown`), and there's now a test for it.
18. **docs.** `$slot.<name>` means the slot's `expect`, not its live value.
19. **docs.** "One observe, one comparison": a list must all hold, so mixing `$prediction` with an expected value fails whenever the guess differs. Pick one, and let the choice feedback say the rest.
20. **docs + lint.** "Getting real expected values" says what `rows.json` and `expectations.json` are, and that a missing `expect` or an unrecorded prompt is a warning on user lessons, never an error. The `expect-missing` message no longer mentions `rows.json`. It points to that section.
21. **docs + sample.** New section "Getting real expected values": author mode in Pry, or the recorder from a terminal (`npm run lessons:compile -- --expectations --dir <set>`, then `pytest tests/test_lessons.py --record --lesson-dir <set>`). The sample's guesses are replaced with recorded values (below).
22. **docs.** `tolerance` is absolute, in the readout's own units, either way. The docs give an example.
23. **docs.** All six formulas (`share`, `difference`, `sum`, `abs`, `ratio`, `ln`) are in a table with their `from` and what they give, plus `format`.
24. **lint.** Root cause: the check counted any `baseline` as a run. A baseline (or `enter`) that only sets a prompt doesn't run the model (`run` defaults to false in `pry-apply.ts`), so a result slot above the first run is now an error, for user lessons too. A do step's own instruction and a predict's feedback stay allowed. The baseline, `enter` and slot docs say so. Test: `lint.test.ts › a baseline that only sets a prompt produces no readout`.
25. **lint + docs.** New error `value-type`: a check's value has to suit the readout's type. That covers `$prediction` (judged from the predict's choices), constants, `expect`, `$slot`, `$read`, `$capture` and `in` lists. Test: `lint.test.ts › a check value whose type can never match the readout`.
26. **docs.** Quoted choice text compares as the text inside the quotes, leading space included, and ` Paris` and `Paris` are different tokens.
27. **docs.** Anchor arguments are checked for names and types, not values.
28. **docs.** "The copy rules": a term is a name from Pry's `terms.yaml`. Pry's lessons are checked against its order. User lessons sit outside it, so only `new_terms` counts.
29. **docs.** `term_budget_exception` is one sentence with your reason. On your own lesson it's your call, and the checker only looks for it being there.
30. Good. No change.
31. **kept.** The plan fixes the message format ("Section N, step `id`, line L"). The `file:line:` prefix in front is what editors use to jump to the line.
32. **docs.** A whole analogy example, under "Step kinds".
33. **docs.** `tool:` is needed after a `compute` action. The tool list is spelled out, and a `network` action alone doesn't need one.
34. **docs.** `authors` is a list of names, with an example.

### The sample's numbers, recorded

Recorded through Pry's sidecar (`pytest tests/test_lessons.py --record --lesson-dir docs/lessons/examples/community-sample`, GPT-2 small, CPU, 2026-10-14). The responses are in `ui/src/lessons/__generated__/responses/a03861e6....json` (`/generate`) and `81f62100....json` (`/concept-search`).

On "The Eiffel Tower is in the city of", GPT-2 small puts **" London" first at 8.05%** and **" Paris" second at 6.87%**, with " Amsterdam" at 3.14% after them. The outsider's guesses (`expect: " Paris"`, `0.35`) were wrong on both counts. The sample keeps its prompt, because the real result teaches its point honestly: the top token carries a leading space, and the city a person would name isn't always the one the model ranks first. It now has `top: " London"` (0.0805 ± 0.02), a new slot `paris_p` (0.0687 ± 0.02), and the observe checks `value: $slot.top`. The concept search for "Paris" returned feature 974, "mentions of Paris". It stays unchecked, in an optional section.
