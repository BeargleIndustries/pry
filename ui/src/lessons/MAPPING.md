# Where the old tour and the experiments went

Pry 0.3.8 taught through a 38-step tour (`ui/src/lib/tutorial/tour-steps.ts`, 9 chapters) and 8 guided experiments (`ui/src/lib/experiments/experiments.json`). In 0.4.0 both are retired (plan T7b): the screen tour becomes the 12-step quick tour, and the teaching moves into Lessons. This file maps every old step and experiment to the lesson section that now covers it, or marks it cut with the reason. `lessons-content.test.ts` checks that every tour step id and experiment id appears here.

Targets are `lesson-id#section-id`. "cut" means no lesson teaches it, usually because the experiment guide is gone or the idea moved to a tip.

## Tour steps (38)

| Old step | Lands in | Notes |
|---|---|---|
| `basics.welcome` | `pry.quick-tour#step-1`, `pry.p1-1#s3-3` | The welcome card is the tour's first step. "A big stack of layers full of numbers that nobody wrote by hand" is P1.1 (language model, training) and P1.3 (layers). |
| `basics.prompt` | `pry.quick-tour#step-2` | The prompt box. |
| `basics.run` | `pry.quick-tour#step-2`, `pry.p1-1#s3-2` | Run shares the prompt step in the tour; what Run computes is P1.1. |
| `basics.tokens` | `pry.quick-tour#step-3`, `pry.p1-2#s3-3` | The strip in the tour; tokens, the dot and "word pieces" (retired wording) in P1.2. |
| `basics.predictions` | `pry.quick-tour#step-4`, `pry.p1-4#s3-3` | The panel in the tour; reading it as a probability distribution in P1.4. |
| `basics.lines` | `pry.quick-tour#step-6`, `pry.p2-1#s3-5` | The Attention tab in the tour; reading the lines in P2.1. |
| `basics.focus` | `pry.p2-1#s3-5` | Picking a token to ask where it draws from. |
| `basics.glossary` | `pry.quick-tour#step-12` | The dotted-underline glossary is named in the tour's last step. |
| `attention.grid` | `pry.p2-1#s3-7` | The Expert grid, one head at a time. |
| `attention.agg` | `pry.p2-1#s3-7` | The Score by menu, used as the lesson's head picker. |
| `attention.from-to` | `pry.p2-1#s3-5` | FROM and TO are part of reading lines from the last token. |
| `attention.copying` | `pry.p2-2#s3-2` | The repeated random tokens experiment and the copying-heads view (P2.2 §3.5). |
| `guesses.run` | `pry.p1-1#s3-2` | The Jordan prompt, P1.1's first run. |
| `guesses.predictions` | `pry.p1-4#s3-3` | Chance in plain words and "about 1 in N"; probability is named in P1.4. |
| `guesses.write` | `pry.p1-5#s3-1` | Watch it write, the train-track picture and temperature (P1.5 §3.1-3.4). |
| `guesses.lens` | `pry.p2-3#s3-3` | The Logit Lens; "half-built answer" is retired wording (style guide §3). |
| `responsible.run` | `pry.p2-4#s3-9` | The Mary and John prompt. |
| `responsible.dla` | `pry.p2-4#s3-5` | Why (DLA)'s bars; "credit and blame" becomes each part's own push. |
| `responsible.parts` | `pry.p3-7#s3-5` | Key parts and the direct value path (P3.7 §3.5-3.6). |
| `poke.knockout` | `pry.p3-2#s3-6` | Knocking out the three name mover heads. |
| `poke.knockout-result` | `pry.p3-2#s3-8` | When the answer holds; "spare parts" stays a picture, never a name. |
| `poke.swap` | `pry.p3-3#s3-2` | The Swap test is activation patching. |
| `poke.swap-result` | `pry.p3-3#s3-5` | The residual grid read as three logits first, colours second. |
| `concepts.run` | `pry.p2-5#s3-4` | A prompt for reading features. |
| `concepts.features` | `pry.p2-5#s3-4` | The features that fired on a token. |
| `concepts.history` | `pry.p2-5#s3-6` | The per-token chart under each feature sits with its label and snippets. |
| `concepts.layer` | cut | Switching the SAE layer is a control, not an idea; the Features panel's layer menu and its tip cover it. |
| `concepts.knockout` | `pry.p3-4#s3-2` | Feature knockout (plan T6: tour step 28 lands in P3.4). |
| `concepts.steer` | `pry.p3-5#s3-2` | Steering and steering strength. |
| `concepts.find` | `pry.p2-5#s5` | Concept search and its Neuronpedia caveat; P2.5's transfer goes looking for a feature. |
| `compare.run` | `pry.p3-1#s3-3` | Compare mode with two prompts one word apart. |
| `compare.read` | `pry.p3-1#s3-7` | "Compare shows correlation" is the term P3.1 names. |
| `lab.experiments` | cut | The experiment guide is retired (Settled 5); experiments became lessons (table below). |
| `lab.notebook` | `pry.quick-tour#step-9` | The notebook, pointed at in the tour. |
| `lab.export` | `pry.quick-tour#step-9` | Export, pointed at in the tour. |
| `models.switcher` | `pry.quick-tour#step-10` | The model menu and its fit badges. |
| `models.engine` | `pry.quick-tour#step-11` | The engine chip. |
| `models.done` | `pry.quick-tour#step-12` | The tour's ending now points at Lessons; "the scientific method" framing moves into P3.1 and P3.7. |

## Experiments (8)

| Experiment | Lands in | Notes |
|---|---|---|
| `induction` | `pry.p2-2#s3-2` | Spot the copycat heads: the repeated phrase, then the copying-heads view. |
| `logit-lens` | `pry.p2-3#s3-3` | The title "Watch it make up its mind" is retired wording; the lens reads what each layer would predict. |
| `he-or-she` | `pry.p2-4#s3-8`, `pry.p3-1#s3-2` | The ' she' minimal pair: DLA with a contrast token in P2.4, the Compare evidence in P3.1. |
| `ioi-knockout` | `pry.p3-2#s3-6` | Knock out the name movers. |
| `ioi-swap` | `pry.p3-3#s3-2` | Who gets the drink: activation patching on the Mary and John pair. |
| `features-steering` | `pry.p3-5#s3-2` | "Turn up a concept" is retired wording; steering one feature, with a control. |
| `fact-recall` | `pry.p3-6#s3-2` | Where a fact comes from: the Jordan and Brady pair, MLP swaps, DLA and the lens. |
| `greater-than` | `pry.p3-7#s3-2` | Can it count years: the greater-than case study. |
