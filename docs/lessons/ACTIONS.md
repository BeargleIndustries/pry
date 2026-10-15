# Pry lesson actions, readouts and anchors

Generated from the registry by `npm run lessons:schema`. Do not edit by hand.

## Actions

Effects: `view` and `compute` run freely and replay when a section opens; `download`, `network` and `external` need a `permissions` entry and run only when the learner presses "Do it".

| Action | Effect | Arguments | What it does |
|---|---|---|---|
| `set_prompt` | view | `{ text: string }` | Sets the prompt. |
| `set_input` | view | `{ text: string }` | Same as `set_prompt`. Sets the prompt. |
| `run` | compute | `{}` | Runs the prompt. Runner-issued runs are memoised. |
| `ensure_run` | compute | `{ prompt: string }` | Runs the prompt only if the memo lacks this request. |
| `open_panel` | view | `{ panel: "attention" \| "logit-lens" \| "dla" \| "patching" \| "circuit" \| "steering" \| "predictions" \| "features" \| "watch-it-write" }` | Opens a left or right tab. |
| `open_view` | view | `{ panel: "attention" \| "logit-lens" \| "dla" \| "patching" \| "circuit" \| "steering" \| "predictions" \| "features" \| "watch-it-write" }` | Same as `open_panel`. Opens a left or right tab. |
| `focus_token` | view | `{ text: string, occurrence?: "first" \| "last" \| integer, side?: "a" \| "b" } \| { index: integer, side?: "a" \| "b" }` | Selects a token by its text and which occurrence (first, last or the nth), or by index, where the start marker is 0. In Compare mode it picks the Compare position, reading the tokens of prompt `side` (a, the default, or b). |
| `focus_item` | view | `{ text: string, occurrence?: "first" \| "last" \| integer, side?: "a" \| "b" } \| { index: integer, side?: "a" \| "b" }` | Same as `focus_token`. Selects a token by its text and which occurrence (first, last or the nth), or by index, where the start marker is 0. In Compare mode it picks the Compare position, reading the tokens of prompt `side` (a, the default, or b). |
| `highlight` | view | `{ anchor: string } \| { anchors: string[] }` | Rings an anchor. A list points at each anchor in turn. |
| `set_hidden` | view | `{ anchor: string, on: boolean }` | Hides or shows a hideable region. |
| `reset` | view | `{}` | Returns the app to its baseline, like Back to normal. |
| `set_compare_mode` | view | `{ on: boolean }` | Turns Compare mode on or off. |
| `set_compare` | view | `{ a: string, b: string }` | Sets the two Compare prompts. |
| `run_compare` | compute | `{}` | Runs both Compare prompts. |
| `write_it` | compute | `{ temperature: number, seed?: integer, max_tokens?: integer }` | Runs Watch it write and returns the text. |
| `set_attention_view` | view | `{ view: "lines" \| "expert" }` | Picks the attention view: Lines or Expert. |
| `set_aggregation` | view | `{ aggregation: "max" \| "spread" \| "looks-back" \| "previous" \| "mean" }` | Picks the Score by option for the attention grid. |
| `set_lines_head` | view | `{ layer: integer, head: integer }` | Picks the head the Lines view draws. |
| `set_focus_mode` | view | `{ mode: "from" \| "to" }` | Picks FROM or TO for the attention grid. |
| `open_head` | view | `{ layer: integer, head: integer }` | Opens one attention head. |
| `show_copying_heads` | compute | `{ on: boolean }` | Turns the Copying heads view on or off. |
| `run_logit_lens` | compute | `{}` | Runs the logit lens and waits for it. |
| `run_dla` | compute | `{ answer?: string, contrast?: string }` | Runs DLA and waits for it, with an optional answer and contrast token. |
| `switch_sae_layer` | compute, stateful | `{ layer: integer }` | Switches the SAE layer. |
| `open_feature` | view | `{ id: integer }` | Opens the feature card for one feature id. |
| `search_concepts` | network | `{ text: string }` | Looks up a concept on Neuronpedia. The learner starts it. |
| `set_head_ablation` | view | `{ heads: { layer: integer, head: integer }[], on: boolean }` | Marks attention heads to knock out. |
| `run_head_ablation` | compute | `{}` | Runs the prompt with the marked heads knocked out. |
| `run_patching` | compute | `{ clean: string, corrupted: string, type: "head" \| "mlp" \| "resid" }` | Runs the Swap test (activation patching) on a clean and a corrupted prompt. |
| `set_patch_view` | view | `{ type: "head" \| "mlp" \| "resid" }` | Shows one Swap test view without running it again. |
| `focus_patch_cell` | view | `{ layer: integer, position: integer }` | Selects a Swap test cell so its three logits and share can be read. |
| `set_feature_ablation` | view | `{ ids: integer[], on: boolean }` | Marks features to knock out. |
| `run_feature_ablation` | compute | `{}` | Runs the prompt with the marked features knocked out. |
| `set_steering` | view | `{ feature_id: integer, strength: number }` | Sets the steering feature and Steering strength. |
| `run_steer` | compute | `{ control?: true }` | Runs steering. With control, also runs a norm-matched control feature at the same strength. |
| `steer_across` | compute | `{ prompts: string[] }` | Runs the same steering on other prompts, to see if the effect holds. |
| `run_circuit` | compute | `{ threshold?: number }` | Builds the Key parts map. |
| `show_embedding` | compute | `{ a: { prompt: string, token: string, occurrence?: "first" \| "last" \| integer }, b: { prompt: string, token: string, occurrence?: "first" \| "last" \| integer }, split?: boolean }` | Prepares the embedding reader: two token positions side by side. |
| `switch_model` | download, stateful | `{ preset: "gpt2-small" \| "pythia-70m" \| "gemma-2-2b" \| "gemma-2-9b" }` | Switches the model through the load controller, licence check included. May download weights. |
| `open_link` | external | `{ url: string }` | Opens a link in the browser, always through the dispatcher. |

## Readouts

| Readout | Type | Arguments | What it reads |
|---|---|---|---|
| `result` | record |  | The current run's result: the generic readout every tool maps onto. |
| `tokens` | list |  | The prompt's tokens, in order. |
| `token_count` | number (count) |  | How many tokens the prompt became, counting the start marker (`<\|endoftext\|>`) that Pry puts first, so it's one more than the tokens of your own text. |
| `word_tokens` | number (count) | `{ word: string }` | How many tokens one word became: the tokens in the strip that spell it, leading space included. The start marker never counts here. |
| `focus.token` | string |  | The selected token. |
| `focus.position` | number |  | The selected token's position, where the start marker is 0. |
| `focus.word_number` | number |  | The number Pry's panels show for the selected token, as in "word 6". |
| `top_guess.token` | string |  | The top prediction. |
| `top_guess.prob` | number (probability) |  | The top prediction's probability. |
| `top_guess.logit` | number (logit) |  | The top prediction's logit. |
| `prediction` | record | `{ token: string }` | One token's probability, logit and rank. |
| `top_k` | list |  | The top predictions, each with its token, probability and logit. |
| `rest_mass` | number (probability) |  | The probability left over for every token outside the top list. |
| `shape` | string |  | How the probability is spread: most, few or spread. |
| `write_it.text` | string |  | The text Watch it write produced. |
| `write_it.tokens` | list |  | The tokens Watch it write produced. |
| `compare.delta` | number (probability) | `{ token: string }` | How much one token's probability changed between the two Compare prompts. |
| `compare.prediction` | record | `{ side: "a" \| "b", token: string }` | One token's probability, logit and rank on one Compare side. |
| `compare.tokens` | list | `{ side: "a" \| "b" }` | One Compare side's tokens. |
| `compare.token_count` | number (count) | `{ side: "a" \| "b" }` | How many tokens one Compare side became, counting the start marker. |
| `compare.top` | record | `{ side: "a" \| "b" }` | One Compare side's top prediction. |
| `compare.word_diff_count` | number (count) |  | How many words differ between the two Compare prompts. |
| `embedding.matches` | number (count) | `{ part: "embed" \| "pos" \| "sum" }` | How many of the 768 numbers match between the two positions. |
| `embedding.cosine` | number | `{ part: "embed" \| "pos" \| "sum" }` | Cosine similarity of the two lists, shown only beside them. |
| `attention.weight` | number | `{ layer: integer, head: integer, from: integer, to: integer }` | How much one head's FROM token attends to a TO token. |
| `attention.top_source` | record | `{ layer: integer, head: integer, from: integer }` | The token one head looks at most from a FROM token. |
| `attention.avg_top_source` | record | `{ from: integer }` | The token looked at most from a FROM token, averaged over heads as the default Lines view draws it. |
| `attention.avg_share` | number | `{ from: integer, to: integer }` | The share of attention from one token to another, averaged over heads. |
| `lines_head` | record |  | The layer and head the Lines view shows now. |
| `head_scores.top` | list | `{ n: integer }` | The top induction head scores. |
| `lens.first_top_layer` | number (layer) | `{ token: string }` | The first layer where the token is the logit lens top guess. |
| `lens.peak_layer` | number (layer) | `{ token: string }` | The layer where the token's logit lens probability peaks. |
| `lens.peak_prob` | number (probability) | `{ token: string }` | The token's highest logit lens probability. |
| `lens.final_prob` | number (probability) | `{ token: string }` | The token's probability at the last layer. |
| `dla.bars_total` | number (logit) |  | The sum of the DLA bars. |
| `dla.answer_logit` | number (logit) |  | The answer token's real logit. |
| `dla.contrast_logit` | number (logit) |  | The contrast token's real logit. |
| `dla.actual` | number (logit) |  | The real logit, or with a contrast, the difference between the two logits. |
| `dla.gap` | number (logit) |  | The gap between the bars' total and the real logit. |
| `dla.top_parts` | list | `{ n: integer }` | The parts with the biggest DLA bars. |
| `dla.target` | record |  | The DLA answer and contrast tokens. |
| `dla.parts_above` | number (count) | `{ threshold: number }` | How many DLA bars push harder than a threshold, in logits (P2.4:53). |
| `dla.target_token_count` | number (count) | `{ which: "answer" \| "contrast" }` | How many tokens the DLA answer or contrast is. The sidecar refuses anything but one token, so a finished run reads 1 (P2.4:95). |
| `features.top` | list | `{ n: integer }` | The top features, ids and labels. Labels stay hidden while feature-labels is hidden. |
| `features.has` | boolean | `{ label: string } \| { id: integer }` | Whether a feature with this label or id is in the list. |
| `features.activation` | number (activation) | `{ id: integer }` | A feature's activation at the focused token. |
| `features.label` | string | `{ id: integer }` | A feature's label. |
| `features.has_snippets` | boolean | `{ id: integer }` | Whether a feature's Neuronpedia snippets have loaded. |
| `ablation.heads` | list |  | The heads knocked out, each with its layer and head. |
| `ablation.head_count` | number (count) |  | How many heads are knocked out. |
| `ablation.top_guess.token` | string |  | The top prediction with the heads knocked out. |
| `ablation.delta` | number (probability) | `{ token: string }` | How much one token's probability changed with the heads knocked out. |
| `ablation.top_delta` | number (probability) |  | How much the original top token's probability changed with the heads knocked out (knocked out minus original). |
| `ablation.prediction` | record | `{ side: "original" \| "ablated", token: string }` | One token's probability, logit and rank with the heads knocked out, or in the original run. |
| `ablation.top5` | list | `{ side: "original" \| "ablated" }` | The top 5 predictions, original or ablated. |
| `patch.cell` | record | `{ layer: integer, position: integer }` | One Swap test cell: clean, corrupted and patched logits, and the share. |
| `patch.focused` | record |  | The Swap test cell selected now: its layer, word position or head, the three logits and the share. |
| `patch.token_count` | number (count) | `{ side: "clean" \| "corrupted" }` | How many tokens the Swap test's Original (clean) or Changed (corrupted) prompt became. |
| `patch.peak` | record | `{ type: "head" \| "mlp" \| "resid" }` | The Swap test cell with the biggest share: {layer, head} for heads, {layer} for MLPs, {layer, position} for the residual stream, with its three logits and share. |
| `feature_ablation.count` | number (count) |  | How many features are knocked out. |
| `feature_ablation.delta` | number (probability) | `{ token: string }` | How much one token's probability changed with the features knocked out. |
| `feature_ablation.prediction` | record | `{ side: "original" \| "ablated", token: string }` | One token's probability, logit and rank with the features knocked out, or in the original run. |
| `feature_ablation.top5` | list | `{ side: "original" \| "ablated" }` | The top 5 predictions, original or ablated. |
| `steer.text` | string | `{ which: "original" \| "steered" \| "control" }` | The original, steered or control text. |
| `steer.changed_tokens` | number (count) |  | How many tokens steering changed. |
| `steer.coherence` | number (nats) | `{ which: "original" \| "steered" \| "control" }` | The coherence measure for the original, steered or control text, in nats. |
| `steer.control_top_changed` | boolean |  | Whether the control feature changed the top prediction. |
| `steer.persist` | number | `{ measure: string }` | One measure of whether steering held across other prompts. |
| `steer.scale` | record |  | Steering strength beside the feature's activation on this prompt: p50, p99 and max. |
| `circuit.nodes` | list |  | The parts in the Key parts map. |
| `circuit.target` | record |  | The token the Key parts map explains: the top guess after the selected word (`after`, at `position`). |
| `readout` | prose | `{ panel: "attention" \| "logit-lens" \| "dla" \| "patching" \| "circuit" \| "steering" \| "predictions" \| "features" \| "watch-it-write" }` | A panel's readout sentence. For hints only, never checked. |

## Anchors

| Anchor | Arguments | Hideable | What it is |
|---|---|---|---|
| `header-help` |  |  | the ? button, top right |
| `prompt-input` |  |  | the Prompt box, top of the window |
| `run-button` |  |  | the Run button, top of the window |
| `token-strip` |  |  | the word chips above the panels |
| `predictions-panel` |  | yes | the Predictions tab, right side |
| `panel-a-lines` |  |  | the Attention lines, left side |
| `glossary-term` |  |  | a word with a dotted underline |
| `panel-a-heatmap` |  |  | Expert view (the grid), left side |
| `panel-a-agg-selector` |  |  | the Score by menu, above the grid |
| `panel-a-from-selector` |  |  | the FROM and TO buttons, above the grid |
| `copying-heads-view` |  |  | the copying-heads view, left side |
| `watch-it-write` |  |  | Watch it write, under the predictions |
| `logit-lens-heatmap` |  |  | the Logit Lens chart, left side |
| `dla-waterfall` |  |  | the Why (DLA) chart, left side |
| `circuit-graph` |  |  | the Key parts map, left side |
| `ablation-head-toggle` |  |  | the Ablation button, above the grid |
| `ablation-results` |  |  | the before and after guesses, left side |
| `patching-panel` |  |  | the Swap test panel, left side |
| `panel-b-features-list` |  |  | the feature list, right side |
| `feature-histogram` |  |  | the little chart under a feature |
| `panel-b-layer-selector` |  |  | the layer menu, top of the Features tab |
| `ablation-feature-toggle` |  |  | the Ablation button in Features |
| `steering-panel` |  |  | the Steering tab, right side |
| `concept-search` |  |  | the Find a concept box, in Steering |
| `compare-panel` |  |  | the Compare view |
| `experiments-button` |  |  | the Experiments button, top right |
| `notebook-button` |  |  | the bookmark and Notebook buttons, top right |
| `export-button` |  |  | the download button (arrow pointing down), top right |
| `model-switcher` |  |  | the model menu, top left |
| `engine-chip` |  |  | the engine chip, next to the model menu |
| `left-tab-strip` |  |  | The tab row above the left panel. |
| `right-tab-strip` |  |  | The tab row above the right panel. |
| `tab-features` |  |  | The Features tab in the one-panel layout, next to Attention. |
| `compare-button` |  |  | The Compare button in the header. |
| `lessons-toggle` |  |  | The button that opens and closes Lessons. |
| `settings-button` |  |  | The gear button that opens Settings. |
| `compare-prompt-b` |  |  | The second prompt box in Compare mode. |
| `tab-key-parts` |  |  | The Key parts tab. |
| `steering-feature-menu` |  |  | The feature menu in the Steering tab. |
| `steering-strength` |  |  | The Steering strength control. |
| `embedding-view` |  |  | The mounted embedding-compare view, inside the sidebar. |
| `patch-three-logits` |  |  | The clean, corrupted and patched logits with the share formula. |
| `dla-total-line` |  |  | The DLA line with the bars' total, the real logit and the gap. |
| `write-it-step` |  |  | The control that writes one more token in Watch it write. |
| `write-it-temperature` |  |  | The temperature setting in Watch it write. |
| `write-it-seed` |  |  | The seed setting in Watch it write. |
| `prediction-bar` | `{ token: string }` |  | One bar in Predictions, picked by its token. |
| `everything-else-row` |  |  | The Predictions row for every token outside the top list. |
| `token-chip` | `{ text: string, occurrence?: "first" \| "last" \| integer }` |  | One token chip, picked by its text and which occurrence. |
| `feature-row` | `{ id: integer }` |  | One row in the feature list, picked by feature id. |
| `dla-bar` | `{ part: string }` |  | One bar in the DLA chart, picked by its part. |
| `head-cell` | `{ layer: integer, head: integer }` |  | One cell in the attention head grid, picked by layer and head. |
| `patching-grid` |  | yes | The Swap test grid. |
| `feature-labels` |  | yes | Every place a feature label shows: the Features list, feature cards, the steering menu and the histogram tooltip. |
| `embedding-values` |  | yes | The numbers in the embedding reader. |
| `steering-coherence` |  | yes | The coherence line in Steering. |

## Views

| View | Arguments | What it shows |
|---|---|---|
| `embedding-compare` | `{}` | Two token positions side by side with the count of matching numbers; rows split into embedding and positional embedding when split; cosine only beside the lists it compares. |
| `text-diff` | `{ a: string, b?: string, text?: string }` | A captured text against a second capture (b) or a literal reference text, with the changed tokens marked. |
| `top5-pair` | `{ a: string, b: string }` | Two captured top 5 lists side by side. |
| `three-logits` | `{}` | Clean, corrupted and patched logits on one line with the share formula. |
| `summary-table` | `{ [key]: any }` | The three-tool summary table from P3.6. |

## Pickers

| Picker | What the learner does |
|---|---|
| `token` | The learner clicks a token in the strip. |
| `head` | The learner clicks a cell in the attention grid; resolves to its layer and head. |

## Services

The names a lesson lists under `permissions.network`. A `network` action needs the service it uses listed there.

| Service | Host | Actions that use it | What it is |
|---|---|---|---|
| `neuronpedia` | neuronpedia.org | `search_concepts` | Neuronpedia, for concept search, feature labels and example snippets. |

## Models

`gpt2-small`, `pythia-70m`, `gemma-2-2b`, `gemma-2-9b`
