# Outsider round 2: authoring feedback

Lesson: `docs/lessons/examples/second-look/community.second-look/lesson.md` (id `community.second-look`).
Read only: `AUTHORING.md`, `ACTIONS.md`, `docs/lessons/schema/*.json`, `_template/lesson.md`, `_template/README.md`, the linter's output, and the recording tools' output.

Final result: `node build-cli/lessons-lint.mjs ../docs/lessons/examples/second-look/community.second-look --release` (run from `ui/`) gives `1 lesson(s): 0 error(s), 0 warning(s).`, exit 0. The recorded-response check (`npx vitest run src/lib/lessons/lesson-checks.test.ts`) passes.

Each item: what happened, and the doc section I was in.

## Questions and wrong guesses

1. **Where does the folder go when the instructions say "under `docs/lessons/examples/`"?** "From the template to an installed lesson", step 3, says the folder name must equal the id. "Getting real expected values" says the recorder works on a *lesson set*, "a folder that holds lesson folders". So a lesson folder sitting straight in `examples/` would make all of `examples/` my set, and `__generated__/expectations.json` would land beside other people's lessons. I made a set folder, `examples/second-look/`, holding `community.second-look/`. Nothing in the docs says whether a set folder name has rules (does it need a dot? does `_` skip it?).
2. **"The sidecar's Python environment": which one, and how do I get it?** "Getting real expected values", "From a terminal". It says I need it but not how to make one (no `pip install -e .`, no `uv sync`, no Python version). The worktree's `sidecar/` had no venv and my system Python (3.14) lacked `transformer_lens`. I used the main checkout's existing `sidecar/.venv` (Python 3.12). A real outsider with a fresh clone would be stuck here.
3. **"GPT-2 small downloaded": downloaded how, and where?** Same section. No command given. It worked for me because the weights were already cached; I can't tell from the docs whether the recorder would have downloaded them itself.
4. **Does `token_count` count the start marker?** `ACTIONS.md`, Readouts: "How many tokens the prompt became." `focus_token` says "the start marker is 0", but `token_count` doesn't say. I guessed it didn't (expect 14). The recording check said `slot chips: live 15, expect 14`. So it does. The readout description should say so.
5. **Is `word_tokens` the same as tokens?** `ACTIONS.md`: "How many strip entries one word became." "Strip entries" is a new phrase with no definition. I guessed it meant tokens of that word (5: `ant`, `idis`, `establishment`, `arian`, `ism`) and the recording check agreed, but it was a guess.
6. **Which file do I open in step 3?** "Getting real expected values", step 3: "Open the response for your prompt". Responses are named by a hash. I had to match the `key` field in my set's `expectations.json` against the file names in `ui/src/lessons/__generated__/responses/`. Saying "the file is named `<key>.json`, and the key is in `expectations.json`" would save a hunt.
7. **The response file has more than `top_predictions`.** Same step. To set `token_count` and `word_tokens` I read the `tokens` list in the response (it starts with `<|endoftext|>`). The docs only mention `top_predictions`, so I didn't know if `tokens` was the right source until the check passed.
8. **Should I commit the response files?** Steps 2 and 4. The recorder writes into `ui/src/lessons/__generated__/responses/`, which is Pry's own folder, not my lesson set. The step 4 check now picks up my lesson ("every slot expect and check in an example lesson matches its recorded responses (community.second-look)"), so if I commit `expectations.json` without the two responses, that check would fail for everyone. I committed them. The docs don't say.
9. **Does a predict with `checks=` have to compare with `$prediction`?** "Checks", "One observe, one comparison", and the Step kinds table. The table says observe compares "with the prediction or the lesson's expected value", so I linked my predict to an observe that checks `$slot.top`. The linter accepted it. But then the learner gets "The app shows what the lesson expected" in reply to their guess, which reads a bit odd. I put the slot values in each choice's feedback, as that section suggests.
10. **Is `token` a term the budget counts?** "The copy rules": the term list is `terms.yaml`, "it ships inside the linter". I can't see the list, so I don't know if `token` is on it or how to spell it there. I declared `new_terms: [token]` and the linter said nothing either way.
11. **Do I need `open_panel` before `search_concepts`?** "Network steps can't be checked" answered this ("you don't need `open_panel` first"). It's useful, just placed under Permissions where I didn't look first.
12. **Does an optional network section need an `explain-result`?** "The copy rules", last bullet, says a result after `search_concepts` alone doesn't need `tool:`. I couldn't tell if it needs an `explain-result` at all. I left it out and the linter didn't mind.

## Doc and tool disagreements

13. **Slots marked `expect: pending` vanish from `expectations.json`.** "Getting real expected values", step 1. My first run (all slots `pending`) wrote the requests, the prompts and the one check, and no slot entries at all. That's fine once you know, but the docs don't say `pending` slots are left out, and at first it looked like the slots weren't being read. After I filled in real values and re-ran step 1 (as step 3 says), the slot entries showed up with their `expect`s. Not a disagreement in the end, just a surprise.
14. **"Network steps can't be checked", but the recorder records them anyway, live.** "Permissions and the install sheet" says a network action's answer isn't readable. Step 1 still put my `/concept-search` request into `expectations.json`, and step 2 sent it: the saved response has `"offline": false` and real Neuronpedia results. So recording a lesson with `network` contacts neuronpedia.org with no notice. The docs should say so.
15. **The recording command printed a test run, not a recording summary.** Step 2: `pytest tests/test_lessons.py --record --lesson-dir <set>` printed `1 passed, 75 skipped`. Nothing said "recorded 2 responses" or named the files. I only knew it worked from `git status`.
16. **Step 1 also printed a test run.** `npm run lessons:compile -- --expectations --dir <set>` ran vitest and printed "expectations.json is up to date" *and* "wrote its __generated__/expectations.json". Both on the first run, when no file existed yet. Which one is true?
17. **The linter never warned about my wrong `expect: 14`.** "Getting real expected values", last paragraph: the checker reads `__generated__/expectations.json` beside the lesson folders, but only to warn about unrecorded prompts. A wrong value passes `--release` clean. Only the vitest step catches it, and only from Pry's source. An installed-app author (no source) has only author mode for this.

## Linter messages

18. **The draft warning was the only message I ever got.** The first `--skeleton` run gave one warning: "This lesson is marked `draft: true`. Delete that line, or set `draft: false`, when it's ready to share." Clear. But it means I never saw what an error looks like, so I can't judge the "Section N, step `id`, line L" format the docs promise ("Checking your lesson").
19. **The warning's location says "line 1" twice.** It printed `lesson.md:1: warning: line 1: ...`. The `draft` line was line 9 of my file. Small, but it's the one line-number I saw, and it was wrong.

## Small doc gaps

20. **`authors` with no real name.** "The front matter" table. I used a placeholder; nothing says whether `authors` shows anywhere a learner sees it.
21. **Where `--skeleton` fits.** "Checking your lesson". I wrote `expect: pending` and used `--skeleton` while recording, which worked. The "Getting real expected values" section never mentions `pending`, so the two sections don't point at each other.
