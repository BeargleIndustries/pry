# Authoring feedback, round 3 (outsider)

Written while authoring `community.third-time` (set folder `docs/lessons/examples/third-time/`) from `AUTHORING.md`, `ACTIONS.md`, the schemas and `_template` only. Each item names the doc section I was in. Nothing here was fixed.

## Questions, wrong guesses and confusing messages

1. **From the template to an installed lesson, step 2 / Getting real expected values.** Step 2 tells me to work in `Documents\my-lessons\...`, but the terminal recorder runs from inside Pry's repo (`ui/` and `sidecar/`). It's not said whether `--dir` / `--lesson-dir` accept a path outside the repo. I put the set inside the repo (`docs/lessons/examples/third-time/`) because the task required it, so I didn't test an outside path.

2. **Step kinds, `analogy` / Sections.** The `analogy` table row says "One per section on the main path". I couldn't tell if an analogy is also required at all (it isn't, as far as the checker goes) or if one analogy per lesson is the norm. Minor.

3. **Slots and asserts.** Where may a slot appear *before* the do step that runs? The paragraph lists three places that are fine. My predict choice feedback uses `{top_tok}` and `{top_p}` above the do step, which is listed as fine. Clear, once I found it, but it's buried in the middle of a long paragraph after the unit table; I first assumed it would be an error.

4. **Checks, "One observe, one comparison".** This was the most useful paragraph. It answered my real question (do I check `$prediction` or the slot?). But it's the fourth paragraph of the Checks section, after the value table I needed it for. I'd have looked for it first.

5. **Permissions and the install sheet / Network steps can't be checked.** "`search_concepts` opens the Steering tab." ACTIONS.md lists the anchor `concept-search` ("the Find a concept box, in Steering") but doesn't say that's where the lookup's results show. I pointed my `:look` at `concept-search` as a guess. Neither doc says which anchor holds the lookup's answer.

6. **The copy rules, Explain don't rename.** I declared `new_terms: [steering]` and my prose also explains "feature" in passing. It's not clear if I must declare every term I explain, or only the ones I "teach". The checker said nothing either way. I left `feature` out because I explain it in one clause, not as a lesson point.

7. **Checking your lesson (first lint run, `--skeleton`).** With every slot still `expect: pending`, the warning says "This lesson has `expect` values, and there's no recorded response...". Pending isn't really a value, so "has `expect` values" read oddly. It also prints the line twice: `lesson.md:1: warning: line 1: ...`.

8. **Getting real expected values, step 1.** `npm run lessons:compile -- --expectations --dir <set>` prints a vitest test-run banner ("Test Files 1 passed", "Tests 3 passed | 1 skipped") before the line that says what it wrote. As a newcomer I briefly thought it had run tests instead of compiling, and the "1 skipped" looked like my lesson being skipped. The doc says "It prints the file it wrote", which is true but only the last line.

9. **Getting real expected values, step 1.** `expectations.json` lists a `/concept-search` request for my network step, with a `key`, even though the network section says the recorder leaves lookups out without `--network`. Consistent with the doc once you read the network paragraph, but on first look it seemed like the lookup *would* be sent.

10. **Set up the sidecar for recording.** The doc says "You need Python 3.11 or 3.12", then the very next command is `python -m venv .venv`. On this machine `python` is 3.14. Following the doc exactly made a 3.14 venv, CPU torch installed fine into it (a few hundred MB, wasted), and only the second pip step failed: `ERROR: Package 'pry-sidecar' requires a different Python: 3.14.2 not in '<3.13,>=3.11'`. A fresh user needs to be told to run `py -3.12 -m venv .venv` (Windows) or `python3.12 -m venv .venv`. The doc states the requirement but the command doesn't honour it. I recovered with `py -3.12 -m venv .venv`.

11. **Set up the sidecar for recording.** After the 3.12 venv, the rest worked from scratch as written: CPU torch, then `pip install -e ".[dev]"` (that took over ten minutes here, mostly dependency downloads; the doc gives no time estimate, and I first thought it had hung), then the GPT-2 small download command. The torch build stayed `+cpu` after the second step, so the "install CPU torch first" advice held.

12. **Getting real expected values, step 2.** "It ends by listing each file it wrote." The listing (`recorded 1 response(s) into ...`, plus a `not sent (a Neuronpedia lookup; add --network ...)` line) is there, but it's followed by pytest's warnings summary (an SAE `UserWarning` and a starlette `DeprecationWarning`) and the `1 passed, 75 skipped` line. With `| tail` I saw only the warnings and had to search the output for the listing. The `not sent` line itself is clear and matches the network paragraph exactly.

13. **Getting real expected values, step 3.** "Its `top_predictions` list holds each token's probability, logit and rank." In the file, `top_predictions` and `tokens` sit under a top-level `response` key, next to `key`, `request`, `model_revision`, `device` and others. Easy to find, but the doc reads as if they're at the top level.

14. **Getting real expected values, step 3.** I wrote `expect: 0.1158` (rounded from `0.11580509692430496`) with `tolerance: 0.02`. The doc doesn't say how many decimals to copy or whether rounding is fine. With a tolerance it clearly is, and `--release` passed.

15. **Getting real expected values (outcome).** GPT-2 small's top guess after "On a hot day at the beach, I like to eat" was ` a`, not a food. The doc's warning that the model disagrees with people held, and I rewrote the predict feedback around the recorded token after seeing it, as the doc says to.

16. **Checking your lesson, `--release`.** Passed with 0 errors and 0 warnings on the first try after recording. To make sure it really tested the values, I set the wrong ones (` the`, `0.30`) for a moment: `--release` gave 5 errors, one per place each slot is used. They point at the step where the slot shows up (the observe at line 54, the explain at line 62), not at the slot's declaration in the front matter, which is where I'd go to fix it. The predict feedback that also uses both slots got no message of its own. The messages were clear and gave both values ("got \" a\", want \" the\"").

## Summary

- The sidecar setup section failed from scratch at `pip install -e ".[dev]"` because its `python -m venv` command picks up whatever `python` is (3.14 here). It worked once I used `py -3.12 -m venv .venv`. No fallback to the main checkout's venv was needed.
- I got the real value through the documented terminal route (compile, `pytest --record`, read the response, compile again).
- Final lint: `node build-cli/lessons-lint.mjs ../docs/lessons/examples/third-time --release` gives `1 lesson(s): 0 error(s), 0 warning(s).`

## Dispositions (round 3)

Key, same as round 2: **docs** = fixed in AUTHORING.md; **tool** = fixed in the checker (`ui/scripts/lessons-lint.ts`) or the recorder (`sidecar/tests/test_lessons.py` and `conftest.py`), with tests; **kept** = no change, with the reason. Round 1's and round 2's dispositions still hold. The `third-time` set now runs in CI's lint loop beside the other two.

1. **docs.** "Getting real expected values" says the set can live anywhere. You run the commands from the repo's `ui/` and `sidecar/` folders, and `--dir` and `--lesson-dir` take any path. I checked it with a copy of your set outside the repo: compile, `--record` and the checker all worked on it.
2. **docs.** The `analogy` row now says you don't need one at all, and a section can have one on the main path, at most. That's what the checker holds you to (`analogy-two`).
3. **docs.** The rule got its own paragraph, "Where a slot can go", with the three places as a list. It says predict feedback above the do step is fine, so you'd have been right not to worry.
4. **docs.** "One observe, one comparison" moved to the top of "Checks", ahead of the value table.
5. **docs.** "Network steps can't be checked" now says the `search_concepts` results show inside the Find a concept box, so a `:look` at `concept-search` is right. You guessed it, and now you won't have to.
6. **docs.** "The copy rules": list the terms the lesson is there to teach. A word you only gloss in one clause on the way past doesn't go on the list, so you were right to leave `feature` off.
7. **tool, plus a kept part.** With every slot still `pending`, the warning now reads "This lesson has slots marked `expect: pending`, and there's no recorded response...". Test: `lessons-cli.test.ts › with every slot still pending and nothing recorded, the warning says pending, not expect values`. The line number showing twice is **kept, by design**: round 1 item 31 and round 2 item 19. The `file:line:` prefix is for editors, and the "line N" after it is the plan's message format.
8. **docs.** Step 1 says the script runs as one of Pry's tests, so the banner shows first. The `1 skipped` is a Pry check a `--dir` run doesn't need, not your lesson, and the `wrote ...` line at the end is the one that matters.
9. **docs.** Step 1 says a lookup is listed in `expectations.json` with its `key` because the recorder reads its list from there, and that listed isn't sent.
10. **docs + tool.** The setup block makes the venv with `py -3.12 -m venv .venv` (Windows) or `python3.12 -m venv .venv` and checks `python --version` before installing. A new paragraph says what happens on 3.13 or 3.14: torch installs, then `pip install -e` stops with your exact error, so delete `.venv` and make it again. The recorder also refuses: `--record` and `--lesson-dir` on any Python other than 3.11 or 3.12 stop straight away with a plain message that names your Python and the venv command. Tests: `test_python_support.py` (the supported list matches `requires-python` in `pyproject.toml`; 3.14 gets the message with both commands).
11. **docs.** The setup section says the second pip step can take ten minutes or more and can sit quiet without being stuck, and that torch stays the CPU build after it.
12. **tool + docs.** The recorder's summary now prints as the last block, headed `lesson set`, after pytest's warnings and just above the `1 passed` line, so `| tail` shows it. A replay says "(no files written)", and a drifted run adds a line pointing at the failure. Step 2 says where the block is and that the two warnings come from the libraries. Checked on a real `--record` run and on all three sets' replays.
13. **docs.** Step 3 says the readouts sit under the `response` key, beside `key`, `request`, `model_revision` and `device`, and shows the file's shape with your recorded ` a` row.
14. **docs.** Step 3: rounding is fine, three or four significant figures with a tolerance that covers the difference (your `0.1158` with `0.02` is the example). Tokens and counts don't round: copy them exactly.
15. **kept.** The doc's warning held and you did what it says, so there's nothing to change.
16. **tool, plus a kept part.** A wrong `expect` still gets one message for each step that shows the slot or checks against it, and each message now ends "Its `expect` is on line N." with the line in the front matter (or the `:::slots` block) that declares the slot. That works for a `$slot.<name>` check too. "Checking your lesson" shows a whole message. Tests: `lessons-cli.test.ts › a wrong expect names the line that declares the slot, as well as the step that uses it` and `› a $slot check against a wrong expect names the slot's declaration line too`. The predict feedback getting no message of its own is **kept, by design**: feedback is checked at the observe that reveals it, and that observe's message already covers the same slot. The docs now say so, so you won't go looking for it.

Also fixed while running the gates: `lesson-checks.test.ts` failed on this set because its lookup isn't recorded. The offline route is the documented one, and the checker already allows it, so the walk test now allows an unrecorded `/concept-search` too.

Totals: 16 items. 11 docs only (1, 2, 3, 4, 5, 6, 8, 9, 11, 13, 14), 1 tool only (7), 3 both (10, 12, 16), 1 kept with no change (15). Kept, by design, as parts of fixed items: the doubled line number (7) and no separate message for predict feedback (16).
