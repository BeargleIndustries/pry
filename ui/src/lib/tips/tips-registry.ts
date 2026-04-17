// Central registry of first-mount contextual tips.
// Each entry becomes at most one popover, gated on localStorage key
// `pry:tip_seen:{id}`. See ui/src/lib/components/FirstTimeTip.svelte.
//
// Tutorial coordination: `tutorialStepId` (when set) causes the tip to be
// auto-marked seen as soon as the driven tutorial advances past that step id.
// The target-string fallback in `coordinate.ts` also flips a tip's flag when
// the current tutorial step's `target` attribute exactly matches this tip's
// `data-tip` id, so tutorial targets named after a `data-tip` id (e.g.
// `panel-a-heatmap`, `panel-a-agg-selector`, `panel-b-token-strip`) will auto-
// suppress the matching tip without needing an explicit `tutorialStepId`.

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TipDef {
  /** Unique stable id; becomes localStorage key suffix. */
  id: string;
  /** querySelector for the anchor element. */
  target: string;
  /** Short one-liner shown by default. */
  blurb: string;
  /** Optional expanded paragraph shown when the user clicks "why?". */
  why: string | null;
  placement: TipPlacement;
  /**
   * If set, tip is auto-marked seen when the tutorial advances past this step
   * id. Values here must match an id in `drivenSteps`.
   */
  tutorialStepId?: string;
}

export const tipsRegistry: TipDef[] = [
  {
    // Tutorial steps 1.4 and 1.5 target 'panel-a-heatmap'; string-equality
    // fallback in coordinate.ts marks this tip seen on step advance.
    id: 'panel-a-heatmap',
    target: '[data-tip="panel-a-heatmap"]',
    placement: 'right',
    blurb:
      "Attention is how the model decides which earlier words to focus on when predicting the next one. Each cell here is one attention head at one layer (12 layers \u00d7 12 heads, so 144 attention heads all doing slightly different things). Rows are layers, columns are heads, and brightness is how much attention this cell paid to the currently-focused token.",
    why:
      "The heatmap is a survey, not the content of attention itself. What it shows is this: for whichever token you clicked up in the token strip, how hard did each (layer, head) pair engage with earlier words in the sentence? A bright cell means this head was doing real work on this token. A dim cell means it basically phoned it in. You can switch the Agg dropdown to control how Pry squishes a whole attention distribution down to one cell value. Click any cell to open the single-head view and see the full token-by-token matrix underneath.",
  },
  {
    id: 'panel-a-head-detail',
    target: '[data-tip="panel-a-head-detail"]',
    placement: 'top',
    blurb:
      "This shows, for one specific reader inside the model, exactly which words it was paying attention to when processing each word. Rows are positions being computed, columns are positions being looked at. A bright cell means that row-word was paying hard attention to that column-word.",
    why:
      "Think of it as a spreadsheet of 'when the model was working on the word in this row, how much did it look at the word in this column?' Technically it's a query \u00d7 key matrix — the row is the query token (asking), the column is the key token (being looked at). The upper-right half of the grid is mostly dark because of causal masking (each token can only attend to itself and earlier tokens, never later ones). Patterns worth looking for: a diagonal line (head is copying the previous token), a vertical stripe on one column (head routes everything back to one specific source word), or a few isolated bright cells (head has a narrow, rule-like job). A flat uniform grid means the head isn't really making a choice, which is also information.",
  },
  {
    // Tutorial step 1.6 targets 'panel-a-agg-selector'; string-equality
    // fallback marks this tip seen on step advance.
    id: 'panel-a-agg-selector',
    target: '[data-tip="panel-a-agg-selector"]',
    placement: 'bottom',
    blurb:
      "Max, Mean, or Entropy. Three different questions about the same attention data. The heatmap re-colors based on which one you're asking.",
    why:
      "Every cell in the grid has to boil a whole attention distribution down to one number for coloring. Max asks 'did this head lock hard onto one specific earlier word?' Mean asks 'was attention peaky, or spread thin?' Entropy asks 'how undecided was this head, was it basically refusing to choose?' Researchers flip through these constantly. Max surfaces copy-paste-style heads. Mean shows general engagement. Entropy flags heads that are essentially phoning it in. Same underlying numbers, three completely different pictures of what the model was doing.",
  },
  {
    id: 'panel-a-token-strip',
    target: '[data-tip="panel-a-token-strip"]',
    placement: 'bottom',
    blurb:
      "Click any token here to refocus the heatmap on it. Whichever word is selected becomes the 'query,' and every cell in the grid re-colors to show how that one word was being computed.",
    why: null,
  },
  {
    // Tutorial step 2.4 targets 'panel-b-token-strip'; string-equality
    // fallback marks this tip seen on step advance.
    id: 'panel-b-token-strip',
    target: '[data-tip="panel-b-token-strip"]',
    placement: 'bottom',
    blurb:
      "Same idea as Panel A's token strip, different job. Click a token and Panel B shows the internal concepts (called SAE features) that lit up for that specific word.",
    why: null,
  },
  {
    id: 'panel-b-feature-row',
    target: '[data-tip="panel-b-feature-row"]',
    placement: 'left',
    blurb:
      "Each row is one internal concept (called an SAE feature) that lit up for the selected word. The bar shows how strongly it activated, and the label is the human-readable name Neuronpedia gave it.",
    why:
      "The labels are auto-generated from the training examples where the feature fires hardest (via Neuronpedia), which means they're a best guess, not a guarantee. Always peek at the example text underneath before trusting a label, because sometimes the auto-label catches one pattern while the feature is actually doing two or three things at once. An SAE is basically a pattern detector trained to name the concepts that are active inside the model at each step.",
  },
  {
    id: 'panel-a-from-selector',
    target: '[data-tip="panel-a-from-selector"]',
    placement: 'bottom',
    blurb:
      "FROM is the token whose attention you're viewing. The grid shows where this token was looking when the model computed its prediction.",
    why: null,
  },
  {
    id: 'panel-a-to-selector',
    target: '[data-tip="panel-a-to-selector"]',
    placement: 'bottom',
    blurb:
      "TO shows which earlier token is being attended to. Click a cell in the grid to update this, or pick a target token directly.",
    why: null,
  },
  {
    id: 'panel-b-layer-selector',
    target: '[data-tip="panel-b-layer-selector"]',
    placement: 'bottom',
    blurb:
      "Pick how deep into the model to look. Deeper layers tend to hold more abstract concepts. Switching layers re-runs the feature detector at that depth.",
    why:
      "The model has 12 layers stacked on top of each other, each one building a richer picture. Early layers (0-3) tend to catch surface features, things like word shape, grammar, part of speech. Later layers (8-11) catch meaning, relationships, and the kind of abstract role-playing you saw with 'she' and 'nurse.' Switching layers here swaps the SAE and re-runs it at the new depth, which takes a couple seconds. The model's forward pass doesn't need to re-run, just the feature extraction. Try jumping between layer 2 and layer 10 on the same token to see the difference.",
    tutorialStepId: '2.5b',
  },
  {
    id: 'predictions-panel',
    target: '[data-tip="predictions-panel"]',
    placement: 'top',
    blurb:
      "The model's top 10 guesses for the next word, ranked by confidence. The bar shows how sure it is about each one.",
    why:
      "Every time the model processes a token, it produces a probability distribution over its entire vocabulary. Basically a ranked list of every word it knows, with a percentage next to each one. This panel shows you the top 10. If the model is confident, the first bar dominates and the rest are tiny. If it's torn between options, you'll see several bars roughly the same size. That ambiguity is usually where the interesting stuff lives, because a confident model is boring to analyze and an uncertain model is telling you something about the input.",
  },
  {
    id: 'feature-histogram',
    target: '[data-tip="feature-histogram"]',
    placement: 'right',
    blurb:
      "A tiny chart showing how strongly this feature fired across every token in the sentence. Tall bar means that token activated it hard.",
    why:
      "Most features don't fire evenly across a sentence. A 'past-tense verb' feature lights up on 'sat' and basically ignores everything else. A 'function word' feature might glow faintly on every 'the' and 'on.' This chart gives you that at a glance without clicking through every token. If a bar is empty, it means the feature fell below the top-k cutoff for that token, not necessarily that it was zero. The pattern of which tokens activate a feature is often more informative than the activation value on any single token.",
  },
  {
    id: 'logit-lens-heatmap',
    target: '[data-tip="logit-lens-heatmap"]',
    placement: 'bottom',
    blurb:
      "What the model would predict at every layer if you forced it to answer early. You're watching it make up its mind in slow motion.",
    why:
      "The model has 12 layers, and each one refines the prediction. At layer 0, the model barely knows what it's looking at. By layer 11, it's settled on an answer. The logit lens takes the intermediate state at each layer and asks 'if you had to predict right now, what would you say?' The brighter a cell, the more that layer's guess matches the final answer. Interesting patterns: if the correct prediction appears early (layer 2-3) and stays stable, the model 'knew' from the start. If it changes its mind at layer 7, something in layers 5-7 was doing real computational work, and that's usually where the circuits worth studying live.",
  },
  {
    id: 'dla-waterfall',
    target: '[data-tip="dla-waterfall"]',
    placement: 'left',
    blurb:
      "Each bar is one part of the model. Blue means it pushed toward the predicted word, red means it pushed against. The tallest bars are the parts that mattered most.",
    why:
      "When the model predicts 'mat' after 'The cat sat on the,' every attention head and every processing layer (MLP) contributed something to that decision. Some pushed toward 'mat' (positive logit contribution, blue). Some pushed against it (negative, red). Some did basically nothing (short bar). This waterfall shows you all of them ranked by impact. The tall blue bars are the components that most wanted the model to say 'mat.' The tall red bars are the ones that wanted something else. Researchers use this to find which specific heads are 'responsible' for a prediction, and it's the first step toward understanding the circuit behind any behavior.",
  },
  {
    id: 'export-button',
    target: '[data-tip="export-button"]',
    placement: 'bottom',
    blurb:
      "Save what you're looking at as a JSON file or a screenshot. Good for sharing findings or picking up where you left off.",
    why: null,
  },
  {
    id: 'steering-panel',
    target: '[data-tip="steering-panel"]',
    placement: 'top',
    blurb:
      "Pick a feature, slide the dial to turn it up or down, hit Run. You just rewired part of the model. Compare the outputs to see what changed.",
    why:
      "This is the part where interpretability stops being observation and becomes experimentation. When you steer a feature, you're injecting a value into the model's internal state at a specific layer. If the 'nurse' feature activates at +5 normally, you can clamp it to +15 and see whether the model starts generating more nurse-related text, or clamp it to 0 and see whether the nurse association vanishes. If the output changes the way you'd expect, that's causal evidence that the feature does what the label says. If it doesn't change, the feature might be correlated with the concept but not causally driving it. That distinction matters a lot for safety work.",
  },
  {
    id: 'ablation-head-toggle',
    target: '[data-tip="ablation-head-toggle"]',
    placement: 'right',
    blurb:
      "Toggle ablation mode on, then click cells in the grid to select which heads to remove. A 'Run Ablated' button appears once you've selected at least one. It re-runs the model without those heads so you can see if the prediction changes.",
    why:
      "There are 144 attention heads in GPT-2 small (12 layers times 12 heads), and most of them do basically nothing on any given input. Ablation is how you find the ones that matter. Zeroing out a head means replacing its output with zeros, so the rest of the model has to produce its answer without that head's contribution. A big prediction shift means the head was load-bearing. No shift means it was redundant, at least for this input. Researchers do this systematically to map which heads form the 'circuit' responsible for a specific behavior.",
  },
  {
    id: 'ablation-feature-toggle',
    target: '[data-tip="ablation-feature-toggle"]',
    placement: 'right',
    blurb:
      "Toggle this to mark the feature for removal. Hit Run Ablated to see what the model predicts without it. If the answer shifts, this feature was actually driving behavior, not just showing up.",
    why:
      "Feature labels come from Neuronpedia and they're based on what inputs activate the feature most. But correlation isn't causation. Just because a feature labeled 'nurse' fires on the word 'nurse' doesn't mean it's causing the model to think about nurses. It might just be along for the ride. Ablation settles it. Zero the feature out, re-run, and if the model's behavior changes in a nurse-relevant way, the feature was genuinely contributing, not just watching. One caveat: the SAE's reconstruction isn't perfect, so zeroing a feature also introduces a small amount of noise. The impact you see is the feature's real contribution plus a little bit of reconstruction error.",
  },
  {
    id: 'patching-panel',
    target: '[data-tip="patching-panel"]',
    placement: 'bottom',
    blurb:
      "Run two prompts, then swap one piece of the model's internal state between them. The piece that changes the answer is the one that matters.",
    why:
      "This is the standard way researchers find circuits. You pick two prompts that the model handles differently (a 'reference' prompt and an 'altered' prompt — called 'corrupted' in ML, but it just means deliberately changed for comparison), run both, then systematically replace one component's activations from the reference run into the altered run. If swapping head 7.3's output from reference into altered makes the altered prompt behave like the reference one, that head is causally responsible for the difference. It's sort of like debugging by swapping parts until you find the one that was broken. The heatmap shows the impact of patching each component, so you can see the whole model's causal structure at a glance.",
  },
  {
    id: 'circuit-graph',
    target: '[data-tip="circuit-graph"]',
    placement: 'left',
    blurb:
      "A wiring diagram. Each node is a head or MLP layer, each edge is information flow. This is the actual circuit the model used for this prediction.",
    why:
      "Everything else in Pry shows you individual components. The circuit view connects them. An attention head at layer 3 feeds into a processing step (MLP) at layer 5, which feeds into a head at layer 8. That chain of connections is a circuit, and it's what the model actually uses to go from input to output. Nodes are sized by how important they were (from DLA or patching), edges show information flow direction. Most of the graph will be dim because most components aren't involved in any given prediction. The bright, thick-edged subgraph is the circuit that matters. This is the most advanced view in Pry, and it's also the one closest to what Anthropic's internal tools look like.",
  },
  {
    id: 'custom-model-verdict',
    target: '[data-tip="custom-model-verdict"]',
    placement: 'bottom',
    blurb:
      "Comfortable means the model fits in your GPU memory with room to spare. Tight means it fits, but barely. Insufficient means it straight-up won't run.",
    why:
      "VRAM is your graphics card's memory. Bigger models need more of it to run. Pry estimates GPU memory usage per preset (model weights plus SAE plus some overhead for inference) and compares against what your GPU can actually give. Comfortable leaves enough headroom that other processes on your machine shouldn't get crowded out. Tight means it'll probably work, but if you run anything else at the same time you may start seeing out-of-memory errors. Insufficient means the math doesn't work, period, and the preset is blocked from loading so you don't get a mid-inference crash. These estimates are conservative, so an Insufficient might actually run on some machines, but the safe default is to not let you try.",
  },
  {
    id: 'neuronpedia-link',
    target: '[data-tip="neuronpedia-link"]',
    placement: 'top',
    blurb:
      "Opens this feature's page on Neuronpedia, a public database of SAE features. It shows more examples, community descriptions, and lets you explore related features.",
    why:
      "Neuronpedia is a community project that catalogs SAE features across multiple models. Each feature gets a page with its top activating examples, auto-generated descriptions, and sometimes human-written annotations from researchers who've studied it. When Pry shows you a feature labeled 'past-tense verb' or 'female professional,' that label originally came from Neuronpedia's labeling pipeline. Clicking through lets you see more context than Pry can fit in a card, including how the feature behaves on thousands of other inputs. It's the closest thing to a field guide for model internals.",
  },
];
