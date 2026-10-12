# First-timer rubric: Pry clarity (0.3.8), 2026-10-12

Scored from the debug build of `lane/t6` (feat/clarity-0.3.8 + T6 copy fixes) at 1280×800, GPT-2 small on GPU.
Scale (copy audit): 0 = missing, 1 = partial, 2 = clear. (a) what am I looking at, (b) why it matters, (c) what to do next / how to get back.
Screenshots live in `.omc/evidence/pry-clarity-2026-10-12/` on the build machine (gitignored); every row cites the one that shows it.

Pass bar (plan T6 §6): experiments 2/2/2; every tour step 2 on (c) and at least 1 on (a), (b); every tip at least 1 on each.

## Experiments (8): all 2/2/2 after fixes

For (b), "why" is checked against "What researchers found" (the citation is in the guide, see the start screenshot).

| Experiment | a | b | c | Sentence that earns the 2s | Screenshots |
|---|---|---|---|---|---|
| ioi-swap "Who gets the drink?" | 2 | 2 | 2* | (a) "Each square's one head: rows are layers 0 to 11, columns are heads 0 to 11. Blue squares bring ·Mary back, orange ones push it further away..." (b) why "traced almost head by head: about two dozen attention heads" = found "a circuit of about two dozen attention heads" (Wang et al. 2022). (c) "Press Back to normal to close this guide. It won't touch your prompt, and Swap test keeps its two prompts so you can try your own." + "Next, try Knock out the name movers..." with a Start button. | exp-ioi-swap-start.png, -mid.png, -end.png, -reset.png |
| ioi-knockout "Knock out the name movers" | 2 | 2 | 2 | (a) "They show as red squares with an x in Expert view (the grid)." + "compare Original top-5 with Ablated top-5". (b) why "these three heads do most of the name moving ... other 'backup' heads partly take over" = found (backup name movers, Wang et al.). (c) "Press Back to normal, or press Ablation ON to turn the knockout off. Either way, you'll get the Lines view back." + the Start button starts "Who gets the drink?" (exp-tryid.png). | exp-ioi-knockout-start.png, -grid.png, -mid.png, -end.png, -reset.png, exp-tryid.png |
| induction "Spot the copycat heads" | 2 | 2 | 2 | (a) "Pry tests every head on a repeated random sequence and rings the ones that copy, such as layer 5, head 1 and layer 5, head 5." (b) why "an important part of how a model learns from the text in front of it" = found (Olsson et al., induction heads, learning from context). (c) "Press Back to your prompt to leave the copying-heads view, or Back to normal to close this guide too." + "type any sentence twice in a row, press Run". | exp-induction-start.png, -mid.png, -end.png, -reset.png |
| logit-lens "Watch it make up its mind" | 2 | 2 | 2 | (a) "Each row's a layer (layer 0 at the bottom) and each column's a word. Read the last column, under ·of" + "Indigo cells already match the final answer". (b) why "guesses often sharpen bit by bit ... early layers can be misleading" = found (nostalgebraist; tuned lens caveat). (c) "There's nothing to undo here. Press Back to normal to close this guide." + "type your own fact in the Prompt box ... press Run". | exp-logit-lens-start.png, -mid.png, -end.png, -reset.png |
| fact-recall "Where does it keep facts?" | 2 | 2 | 2* | (a) "Each bar copies one layer's MLP from the Michael Jordan sentence and shows how much that raises the score for ·basketball. Blue bars help, orange bars push the other way." (b) why "MLP layers in the middle of the network mattered most" = found (Meng et al.), and step 4 explains why Pry's layer 0 wins anyway. (c) reset as ioi-swap + "Next, switch Swap from MLPs to Residual and press Run swap test again". | exp-fact-recall-start.png, -mid.png, -end.png (Residual run), -reset.png |
| greater-than "Can it count years?" | 2* | 2 | 2* | (a) "The bar at the top says what each sentence predicts. Each bar below copies one layer's MLP from the 1732 sentence..." + step 4 now matches the run (layer 9 biggest, layer 0 second, 10/11/5 orange). (b) why "MLP layers near the end (roughly layers 8 to 11)" = found (Hanna et al.). (c) reset as ioi-swap + "change 1732 to 1785 in the Original prompt box, press Run swap test". | exp-greater-than-start.png, -mid.png, -end.png (1785 run), -reset.png |
| he-or-she "He or she?" | 2 | 2 | 2 | (a) "Blue bars pushed toward it and orange bars pushed against it. The biggest bars pushed hardest." + "DLA only counts direct pushes". (b) why "concentrated in a small part of the network, such as a handful of attention heads" = found (Vig et al.). (c) "Press Back to normal to close this guide, and press Compare again to leave Compare mode." (checked: Back to normal leaves Compare on, Compare turns it off) + "stay in Compare and try other jobs". | exp-he-or-she-start.png, -mid.png, -end.png (Compare run), -reset.png |
| features-steering "Turn up a concept" | 2 | 2 | 2* | (a) "The Features tab lists the concepts the feature dictionary (SAE) found on each word. Click ·ocean or ·beach in the word chips". (b) why "turning one up can steer what a model says" = found (Bricken et al., Templeton et al.). (c) "Open Steering, pick that # in the Feature menu, drag Steering strength to about 20, and press Run Steered." + "If the text turns to mush ... lower Steering strength. Press Back to normal". | exp-features-steering-start.png, -mid.png, -end.png, -reset.png |

Totals: (a) 16/16, (b) 16/16, (c) 16/16.

\* Below the bar before T6, fixed in `ui/src/lib/experiments/experiments.json` and re-scored:

| Row | Was | Problem found in the walk | Fix |
|---|---|---|---|
| ioi-swap, fact-recall, greater-than (c) | 1 | Reset said "Back to normal ... clear the swap pair", but Back to normal leaves both Swap test prompts and the results in place (exp-ioi-swap-reset.png). | "Press Back to normal to close this guide. It won't touch your prompt, and Swap test keeps its two prompts so you can try your own." |
| fact-recall (c) | 1 | "switch Patch type to Residual": no control is labeled Patch type; the toggle is labeled Swap (Heads / MLPs / Residual). | "switch Swap from MLPs to Residual". Re-run: top square is ·Jordan going into layer 9 (+2.80). |
| greater-than (a) | 1 | "Earlier layers shouldn't do much", but the run gives layer 0 +1.33 (second biggest) and layers 10, 11, 5 push the other way. | "The biggest blue bar should sit in the last few layers (8 to 11) ... Layer 0 also scores high, because copying it at every word basically puts 1732 back in. A few layers push the other way." |
| features-steering (c) | 1 | At strength 12 (the old "about 10 to 15") feature #8548 changed 0 of 40 words; #1148 changed 6. At 20, #8548 changed 29 of 46 and #1148 39 of 45. | "drag Steering strength to about 20". |

### Expected-result checks

| Check | Result | Evidence |
|---|---|---|
| he-or-she top guess is ·she | PASS: ·she 19.0% (·he rank 7, 2.3%); Compare doctor vs nurse: ·she +14 pts, ·he −12 pts | exp-he-or-she-start.png, -end.png |
| knockout cells show × | PASS: 9.6, 9.9, 10.0 marked "Knocked out" with an x; ·Mary 67.7% → 48.5% | exp-ioi-knockout-mid.png, -end.png |
| fact-recall layer 0 bar wins | PASS: MLP.0 +2.38, MLP.2 +1.16, MLP.11 −1.11 | exp-fact-recall-mid.png |
| greater-than late layers | PASS: layer 9 tops (+1.65); layer 0 second (+1.33), copy updated to say so | exp-greater-than-mid.png |
| induction rings include 5.1 / 5.5 | PASS: copying heads 5.5 (94%), 7.10, 6.9, 5.1 (78%), 7.2, 10.1; ·from looks at ·Qu in L5H1 (56%) | exp-induction-mid.png, -end.png |
| logit lens | PASS: ·baseball at layer 7, ·basketball from layer 8, peak 93.2% at layer 9, 42.2% at layer 11 | exp-logit-lens-start.png, -end.png |
| ioi-swap | PASS: L8H10 +1.29 tops; 129 of 144 heads barely change it | exp-ioi-swap-end.png |
| Back to normal restores state | PASS for all 8: guide closed, knockouts cleared, copying-heads view closed, prompt unchanged | exp-*-reset.png |
| Hook, prompt and "What researchers found" stay visible | PASS for all 8: hook + prompt in the header (also when collapsed); Why it matters / What researchers found / When you're done open by default | exp-*-start.png |
| Every lookFor control label on screen as written | PASS for all 8 after the fact-recall fix. "Patch type" was the one miss. | exp-*-start/mid/end.png |

## Tour (38 steps): every step 2 on (c)

Walked by pressing the card's real Next button, starting from the ? button. All 38 cards had "Look at", a ring on the target, a pointer, an arrow of 24px or less, did not overlap their target, and stayed in the viewport. All 6 run steps (Run it ×4, Knock them out, Run the swap, Switch to layer 2, Compare them) worked on the first try.

| Step | a | b | c | What earns (c) | Screenshot |
|---|---|---|---|---|---|
| basics.welcome | 2 | 2 | 2 | No action asked; Next. Why says the ? button brings the tour back. | tour-basics.welcome-1280.png |
| basics.prompt | 2 | 2 | 2 | No action (the tour typed it: "I typed ..."); Next. | tour-basics.prompt-1280.png |
| basics.run | 2 | 2 | 2 | "Press Run it and I'll run the prompt for you." (the button reads Run it) | tour-basics.run-1280.png |
| basics.tokens | 2 | 2 | 2 | "Click a chip to focus on it." | tour-basics.tokens-1280.png |
| basics.predictions | 2 | 2 | 2 | No action; Next. | tour-basics.predictions-1280.png |
| basics.lines | 2 | 2 | 2 | No action; Next. | tour-basics.lines-1280.png |
| basics.focus | 2 | 2 | 2 | "Click some other words yourself, on either side, and watch the readout follow along." | tour-basics.focus-1280.png |
| basics.glossary | 2 | 2 | 2 | "Hover over it, or Tab to it" + "Next up: the whole grid of heads." | tour-basics.glossary-1280.png |
| attention.grid | 2 | 2 | 2 | No action (the tour opened Expert view); Next. | tour-attention.grid-1280.png |
| attention.agg | 2 | 2 | 2 | No action ("I switched the Score by menu"); Next. | tour-attention.agg-1280.png |
| attention.from-to | 2 | 2 | 2 | No action; Next. | tour-attention.from-to-1280.png |
| attention.copying | 2 | 2 | 2 | No action; Next. Why: "Press 'Back to your prompt' to leave this view." | tour-attention.copying-1280.png |
| guesses.run | 2 | 2 | 2 | "Press Run it to send it." | tour-guesses.run-1280.png |
| guesses.predictions | 2 | 2 | 2 | No action; Next. | tour-guesses.predictions-1280.png |
| guesses.write | 2 | 2 | 2 | "Press Write it and the model keeps going" | tour-guesses.write-1280.png |
| guesses.lens | 2 | 2 | 2 | "Look for the row where basketball shows up." | tour-guesses.lens-1280.png |
| responsible.run | 2 | 2 | 2 | "Press Run it, and let's find the parts that know it too." | tour-responsible.run-1280.png |
| responsible.dla | 2 | 2 | 2 | No action; Next. | tour-responsible.dla-1280.png |
| responsible.parts | 2 | 2 | 2 | No action; Next. Why names Threshold and Find key parts. | tour-responsible.parts-1280.png |
| poke.knockout | 2 | 2 | 2 | "Press Knock them out to switch them off." | tour-poke.knockout-1280.png |
| poke.knockout-result | 2 | 2 | 2 | "Compare Original top-5 with Ablated top-5." Why: "press it again when you're done". | tour-poke.knockout-result-1280.png |
| poke.swap | 2 | 2 | 2 | "Press Run the swap to start." | tour-poke.swap-1280.png |
| poke.swap-result | 2 | 2 | 2 | "Check out the Residual view" (the tour opened it). | tour-poke.swap-result-1280.png |
| concepts.run | 2 | 2 | 2 | "Press Run it to see what the model decides." | tour-concepts.run-1280.png |
| concepts.features | 2 | 2 | 2 | "See anything about nurses, women or caregiving?" (read the list); Next. | tour-concepts.features-1280.png |
| concepts.history | 2 | 2 | 2 | No action; Next. | tour-concepts.history-1280.png |
| concepts.layer | 2 | 2 | 2 | "Press Switch to layer 2" | tour-concepts.layer-1280.png |
| concepts.knockout | 2 | 2 | 2 | "Turn on Ablation here, click the round x next to each feature ... and press Run Ablated." | tour-concepts.knockout-1280.png |
| concepts.steer | 2 | 2 | 2 | "Pick a feature, drag the strength, press Run Steered" | tour-concepts.steer-1280.png |
| concepts.find | 2 | 2 | 2 | "Type it into Find a concept" | tour-concepts.find-1280.png |
| compare.run | 2 | 2 | 2 | "Press Compare them to run both." | tour-compare.run-1280.png |
| compare.read | 2 | 2 | 2 | "Check the next-word changes. Did 'he' or 'she' move?" Why: "The Compare button in the header takes you back". | tour-compare.read-1280.png |
| lab.experiments | 2 | 2 | 2 | No action; Next. | tour-lab.experiments-1280.png |
| lab.notebook | 2 | 2 | 2 | No action; Next. | tour-lab.notebook-1280.png |
| lab.export | 2 | 2 | 2 | No action; Next. | tour-lab.export-1280.png |
| models.switcher | 2 | 2 | 2 | No action; Next. | tour-models.switcher-1280.png |
| models.engine | 2 | 2 | 2 | "Click it for details and a Restart button." | tour-models.engine-1280.png |
| models.done | 2 | 2 | 2 | "Next up: press Experiments, top right, and pick one of eight guided experiments. The ? button brings the tour back anytime." | tour-models.done-1280.png |

Totals: (a) 76/76, (b) 76/76, (c) 76/76.

## Tips (26): all at least 1 on each

All 26 forced with the dev hook at 1280×800: all shown, anchored beside the target (compare-panel inset inside its large panel), arrow 24px or less, none overlapping its target, all in the viewport. (a) every tip has a heading naming its thing; (b) every tip has a "Why?" paragraph. (c) is 2 when the tip names the action and its control, 1 when it only describes.

| Tip | a | b | c | Note on (c) | Screenshot |
|---|---|---|---|---|---|
| custom-model-verdict | 2 | 2 | 1 | Describes the badge; no action | popup-tip-custom-model-verdict-1280.png |
| word-strip | 2 | 2 | 2 | "Click a chip to point every panel at that word." | popup-tip-word-strip-1280.png |
| panel-a-heatmap | 2 | 2 | 2 | Why: "Click any square to ..." | popup-tip-panel-a-heatmap-1280.png |
| panel-a-head-detail | 2 | 2 | 1 | Describes the pattern | popup-tip-panel-a-head-detail-1280.png |
| panel-a-agg-selector | 2 | 2 | 1 | Describes the menu | popup-tip-panel-a-agg-selector-1280.png |
| panel-b-feature-row | 2 | 2 | 2 | Why: "peek at the example text underneath before trusting a label" | popup-tip-panel-b-feature-row-1280.png |
| panel-a-from-selector | 2 | 2 | 1 | Describes FROM | popup-tip-panel-a-from-selector-1280.png |
| panel-a-to-selector | 2 | 2 | 2 | "Click a different word chip above to change which word is focused." | popup-tip-panel-a-to-selector-1280.png |
| panel-b-layer-selector | 2 | 2 | 2 | "Pick how deep into the model to look." | popup-tip-panel-b-layer-selector-1280.png |
| predictions-panel | 2 | 2 | 1 | Describes the bars | popup-tip-predictions-panel-1280.png |
| feature-histogram | 2 | 2 | 1 | Describes the chart | popup-tip-feature-histogram-1280.png |
| logit-lens-heatmap | 2 | 2 | 1 | Describes the lens | popup-tip-logit-lens-heatmap-1280.png |
| dla-waterfall | 2 | 2 | 1 | Describes the bars and the direct-only caveat | popup-tip-dla-waterfall-1280.png |
| export-button | 2 | 2 | 2 | "save the run to your Notebook and save it as a web page" | popup-tip-export-button-1280.png |
| steering-panel | 2 | 2 | 2 | "Pick a feature, set the strength, press Run Steered." | popup-tip-steering-panel-1280.png |
| ablation-head-toggle | 2 | 2 | 2 | "Turn Ablation on, then click squares in the grid" | popup-tip-ablation-head-toggle-1280.png |
| ablation-feature-toggle | 2 | 2 | 2 | "click the round x ... Press Run Ablated" | popup-tip-ablation-feature-toggle-1280.png |
| patching-panel | 2 | 2 | 2 | "Run two prompts, then swap one piece" | popup-tip-patching-panel-1280.png |
| circuit-graph | 2 | 2 | 1 | Describes the map | popup-tip-circuit-graph-1280.png |
| neuronpedia-link | 2 | 2 | 2 | "Opens this feature's page on Neuronpedia" | popup-tip-neuronpedia-link-1280.png |
| panel-a-copying-heads | 2 | 2 | 1 | Says what the button runs, not "press" | popup-tip-panel-a-copying-heads-1280.png |
| panel-a-copying-sequence | 2 | 2 | 1 | Describes the test | popup-tip-panel-a-copying-sequence-1280.png |
| experiments-button | 2 | 2 | 2 | "Pick one and Pry sets up the prompt" | popup-tip-experiments-button-1280.png |
| compare-panel | 2 | 2 | 2 | "Type two prompts ... then press Run both" | popup-tip-compare-panel-1280.png |
| watch-it-write | 2 | 2 | 1 | Doesn't name the Write it button | popup-tip-watch-it-write-1280.png |
| concept-search | 2 | 2 | 2 | "Search for any idea by name, then steer" | popup-tip-concept-search-1280.png |

Totals: (a) 52/52, (b) 52/52, (c) 39/52. All meet the tip bar (at least 1 each); the 13 descriptive tips sit on panels you only need to read.

## Other popups

| Check | Result | Screenshot |
|---|---|---|
| Glossary hover ("token" in Predictions) | anchored, definition shown | term-hover.png |
| Grid hover (Expert view, L9H9) | anchored "Layer 9, head 9: score ..." | grid-hover.png |
| Logit Lens cell hover (L9, ·of) | "·basketball at 93.2% matches the final answer" | exp-logit-lens-end.png |
| Tip waits under the open guide | panel-a-agg-selector unseen, induction guide open: no tip; closing the guide shows it beside the Score by menu | guide-wait.png, guide-wait-released.png |

## Bug repros

| Repro | Result | Screenshots |
|---|---|---|
| Crash path (code:B7): Features layer 4 + a DLA result, then kill the engine's python process | PASS: banner "Pry's engine stopped." with Restart engine within seconds; Restart reloads GPT-2 small, clears the response and the DLA result, resets the Features layer (back to 8 on the next Run); Run works after. | bug-restart-banner.png, bug-restart.png, bug-restart-run.png |
| code:D1 with `PRY_DEV=1 PRY_FAULT_SAE_SWAP=1`: switch Features layer 8 to 3 | PASS: error banner shows (with Retry), the engine keeps layer 8, Features still lists layer-8 features, and Run works after ("The nurse said that" gives ·she). Found in the walk: the layer menu kept showing 3 after the failure. Fixed in PanelB.svelte (the menu goes back to the current layer when the switch ends) and re-checked: the menu reads 8. Note: the banner text is the engine's raw error, not a plain-words one. | bug-D1-error.png, bug-D1.png, bug-D1-menu-fixed.png |

## Popup harness (final tree)

`node scripts/dev/popup-audit.mjs` against the VITE_POPUP_AUDIT debug build:

```
POPUP AUDIT PASS 113 / FAIL 0 / SKIP 0 @ 1280x800
POPUP AUDIT PASS 106 / FAIL 0 / SKIP 0 @ 960x700
POPUP AUDIT PASS 113 / FAIL 0 / SKIP 0 @ 1024x700
POPUP AUDIT PASS 128 / FAIL 0 / SKIP 0 @ 740x700
```
