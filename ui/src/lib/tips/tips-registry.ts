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

import { CUSTOM_MODELS_ENABLED } from '../flags';

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TipDef {
  /** Unique stable id; becomes localStorage key suffix. */
  id: string;
  /** Names the thing the tip is about, shown as the tip's heading. */
  title: string;
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

const CUSTOM_MODEL_VERDICT_TIP: TipDef = {
  id: 'custom-model-verdict',
  title: 'Fit verdict',
  target: '[data-tip="custom-model-verdict"]',
  placement: 'bottom',
  blurb:
    "Models you add here run attention, predictions, logit lens, DLA, head ablation and patching, but not features.",
  why:
    "To show features, a model needs a matching feature dictionary (an SAE) trained on it, and Pry only has those for its built-in models. A model you add loads without one, so the Features and Steering panels stay empty for it. Everything that reads the model's own parts still works: attention, predictions, logit lens, Why (DLA), turning heads off, and Swap & Compare.",
};

export const tipsRegistry: TipDef[] = [
  {
    // Tutorial steps 1.4 and 1.5 target 'panel-a-heatmap'; string-equality
    // fallback in coordinate.ts marks this tip seen on step advance.
    id: 'panel-a-heatmap',
    title: 'Attention grid',
    target: '[data-tip="panel-a-heatmap"]',
    placement: 'right',
    blurb:
      "Attention is how the model decides which earlier words to focus on when predicting the next one. Each cell here is one attention head at one layer (in GPT-2 small that's 12 layers \u00d7 12 heads, so 144 heads all doing slightly different things). Rows are layers, columns are heads, and brightness is how much attention this cell paid to the currently-focused token.",
    why:
      "The grid is a summary, not the attention itself. For whichever word you clicked in the word chips, each square scores how one head at one layer looked at the earlier words. A bright square scored high on whatever the Agg menu is measuring, and a dim one barely registered. The Agg menu picks how Pry squishes a whole attention pattern down to one number. Click any cell to open the single-head view and see the full token-by-token matrix underneath.",
  },
  {
    id: 'panel-a-head-detail',
    title: 'One head, up close',
    target: '[data-tip="panel-a-head-detail"]',
    placement: 'top',
    blurb:
      "This shows, for one specific reader inside the model, exactly which words it was paying attention to when processing each word. Rows are positions being computed, columns are positions being looked at. A bright cell means that row-word was paying hard attention to that column-word.",
    why:
      "Think of it as a spreadsheet of 'when the model was working on the word in this row, how much did it look at the word in this column?' Technically it's a query \u00d7 key matrix: the row is the query token (asking), the column is the key token (being looked at). The upper-right half of the grid is mostly dark because of causal masking (each token can only attend to itself and earlier tokens, never later ones). Patterns worth looking for: a diagonal line (head is copying the previous token), a vertical stripe on one column (head routes everything back to one specific source word), or a few isolated bright cells (head has a narrow, rule-like job). A flat uniform grid means the head isn't really making a choice, which is also information.",
  },
  {
    // Tutorial step 1.6 targets 'panel-a-agg-selector'; string-equality
    // fallback marks this tip seen on step advance.
    id: 'panel-a-agg-selector',
    title: 'Agg menu',
    target: '[data-tip="panel-a-agg-selector"]',
    placement: 'bottom',
    blurb:
      "Different questions about the same attention data. The heatmap re-colors based on which one you're asking.",
    why:
      "Every cell in the grid has to boil a whole attention pattern down to one number for coloring. In FROM mode, Strongest look scores how hard this head locked onto one earlier word. Spread scores whether it focused on one word or scattered across lots of them. Looks back is how far back in the sentence it looked, on average. Previous word is how much it looked at the word right before, which lights up heads that track the previous word. TO mode flips the direction (how the later words looked back at this one) and adds Average received: how much attention this word got, on average, from the words after it. The first word has nothing earlier to look at, so some of these don't apply to it and its cells show grey.",
  },
  {
    id: 'panel-a-token-strip',
    title: 'Word chips',
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
    title: 'Word chips',
    target: '[data-tip="panel-b-token-strip"]',
    placement: 'bottom',
    blurb:
      "Same word strip as the Attention tab, different job. Click a word and the Features tab shows the internal concepts (called SAE features) that lit up for that specific word.",
    why: null,
  },
  {
    id: 'panel-b-feature-row',
    title: 'A feature',
    target: '[data-tip="panel-b-feature-row"]',
    placement: 'left',
    blurb:
      "Each row is one internal concept (called an SAE feature) that lit up for the selected word. The bar shows how strongly it activated, and the label is the human-readable name Neuronpedia gave it.",
    why:
      "The labels are auto-generated from the training examples where the feature fires hardest (via Neuronpedia), which means they're a best guess, not a guarantee. Always peek at the example text underneath before trusting a label, because sometimes the auto-label catches one pattern while the feature covers two or three things at once. An SAE is basically a pattern detector trained to name the concepts that are active inside the model at each step.",
  },
  {
    id: 'panel-a-from-selector',
    title: 'FROM button',
    target: '[data-tip="panel-a-from-selector"]',
    placement: 'bottom',
    blurb:
      "FROM shows where the focused word was looking. Each cell sums up how one head spread this word's attention over the earlier words.",
    why: null,
  },
  {
    id: 'panel-a-to-selector',
    title: 'TO button',
    target: '[data-tip="panel-a-to-selector"]',
    placement: 'bottom',
    blurb:
      "TO flips the direction: each cell shows how the later words looked back at the focused word. Pick a different word in the strip above to change which word is focused.",
    why: null,
  },
  {
    id: 'panel-b-layer-selector',
    title: 'Layer menu',
    target: '[data-tip="panel-b-layer-selector"]',
    placement: 'bottom',
    blurb:
      "Pick how deep into the model to look. Deeper layers tend to hold more abstract concepts. Switching layers re-runs the feature detector at that depth.",
    why:
      "The model has a stack of layers (12 in GPT-2 small), each one building a richer picture. Early layers tend to catch surface features, things like word shape, grammar, part of speech. Later layers catch meaning, relationships, and who's who in a sentence, like whether 'she' means the nurse. Switching layers here loads the feature detector (SAE) for the new depth and runs the model on your prompt again, which takes a few seconds. Try jumping between an early layer and a late one on the same token to see the difference.",
    tutorialStepId: 'concepts.layer',
  },
  {
    id: 'predictions-panel',
    title: 'Predictions',
    target: '[data-tip="predictions-panel"]',
    placement: 'top',
    blurb:
      "The model's top 10 guesses for the next word, ranked by probability. The bar shows how likely it thinks each one is.",
    why:
      "Every time the model processes a token, it produces a probability distribution over its entire vocabulary. Basically a ranked list of every word it knows, with a percentage next to each one. This panel shows you the top 10. If the model is confident, the first bar dominates and the rest are tiny. If it's torn between options, you'll see several bars roughly the same size. That ambiguity is usually where the interesting stuff lives, because a confident model is boring to analyze and an uncertain model is telling you something about the input.",
  },
  {
    id: 'feature-histogram',
    title: 'Feature history chart',
    target: '[data-tip="feature-histogram"]',
    placement: 'right',
    blurb:
      "A tiny chart showing how strongly this feature fired across every token in the sentence. Tall bar means that token activated it hard.",
    why:
      "Most features don't fire evenly across a sentence. A 'past-tense verb' feature lights up on 'sat' and basically ignores everything else. A 'function word' feature might glow faintly on every 'the' and 'on.' This chart gives you that at a glance without clicking through every token. A hatched bar means the feature wasn't in that word's top five, so Pry didn't keep its exact strength. It doesn't mean zero. The pattern of which tokens activate a feature is often more informative than the activation value on any single token.",
  },
  {
    id: 'logit-lens-heatmap',
    title: 'Logit Lens',
    target: '[data-tip="logit-lens-heatmap"]',
    placement: 'bottom',
    blurb:
      "What the model would predict at every layer if you forced it to answer early. You're watching it make up its mind in slow motion.",
    why:
      "Each layer refines the prediction. At the first layer, the model barely knows what it's looking at. By the last layer, it's settled on an answer. The logit lens takes the intermediate state at each layer and asks 'if you had to predict right now, what would you say?' The brighter a cell, the more that layer's guess matches the final answer. Interesting patterns: if the correct prediction appears early (layer 2-3) and stays stable, the model 'knew' from the start. If it changes its mind partway up, the layers just before the change are where the answer got decided, and that's usually the part worth studying.",
  },
  {
    id: 'dla-waterfall',
    title: 'Why (DLA) chart',
    target: '[data-tip="dla-waterfall"]',
    placement: 'left',
    blurb:
      "Each bar is one part of the model. Blue means it pushed toward the predicted word, orange means it pushed against. The tallest bars are the parts that mattered most.",
    why:
      "When the model predicts 'mat' after 'The cat sat on the,' every attention head and every processing layer (MLP) contributed something to that decision. Some pushed toward 'mat' (positive logit contribution, blue). Some pushed against it (negative, orange). Some did basically nothing (short bar). This waterfall shows you all of them ranked by impact. The tall blue bars are the components that most wanted the model to say 'mat.' The tall orange bars are the ones that wanted something else. Researchers use this as a first pass at finding which heads matter for a prediction. It's a simplified estimate, so the bars won't add up exactly to the model's final score.",
  },
  {
    id: 'export-button',
    title: 'Download button',
    target: '[data-tip="export-button"]',
    placement: 'bottom',
    blurb:
      "Saves a JSON file of this run (raw numbers). For something to share, save the run to your Notebook and save it as a web page: a readable report that works offline.",
    why: null,
  },
  {
    id: 'steering-panel',
    title: 'Steering',
    target: '[data-tip="steering-panel"]',
    placement: 'top',
    blurb:
      "Pick a feature, slide the dial to turn it up or down, hit Run. You just rewired part of the model. Compare the outputs to see what changed.",
    why:
      "Up to now you've been looking, and steering lets you test. When you steer a feature, Pry adds that feature's direction to the model's internal state at one layer, scaled by the strength you pick. Push a 'nurse' feature with a positive strength and see whether the model starts writing more nurse-related text, or use a negative strength and see whether the nurse association fades. If the output changes the way you'd expect, that's causal evidence that the feature does what the label says. If it doesn't change, the feature might be correlated with the concept but not causally driving it. That distinction matters a lot for safety work.",
  },
  {
    id: 'ablation-head-toggle',
    title: 'Ablation button',
    target: '[data-tip="ablation-head-toggle"]',
    placement: 'right',
    blurb:
      "Toggle ablation mode on, then click cells in the grid to select which heads to remove. A 'Run Ablated' button appears once you've selected at least one. It re-runs the model without those heads so you can see if the prediction changes.",
    why:
      "There are 144 attention heads in GPT-2 small (12 layers times 12 heads), and most of them do basically nothing on any given input. Ablation is how you find the ones that matter. Zeroing out a head means replacing its output with zeros, so the rest of the model has to produce its answer without that head's contribution. A big prediction shift means the model needed that head. No shift means it was redundant, at least for this input. Researchers do this systematically to map which heads form the 'circuit' responsible for a specific behavior.",
  },
  {
    id: 'ablation-feature-toggle',
    title: 'Ablation button',
    target: '[data-tip="ablation-feature-toggle"]',
    placement: 'right',
    blurb:
      "Toggle this to mark the feature for removal. Hit Run Ablated to see what the model predicts without it. If the answer shifts, this feature was actually driving behavior, not just showing up.",
    why:
      "Feature labels come from Neuronpedia and they're based on what inputs activate the feature most. Correlation isn't causation, though. Just because a feature labeled 'nurse' fires on the word 'nurse' doesn't mean it's causing the model to think about nurses. It might just be along for the ride. Ablation settles it. Zero the feature out, re-run, and if the model's behavior changes in a nurse-relevant way, the feature was genuinely contributing, not just watching. One caveat: the SAE's reconstruction isn't perfect, so zeroing a feature also introduces a small amount of noise. The impact you see is the feature's real contribution plus a little bit of reconstruction error.",
  },
  {
    id: 'patching-panel',
    title: 'Swap & Compare',
    target: '[data-tip="patching-panel"]',
    placement: 'bottom',
    blurb:
      "Run two prompts, then swap one piece of the model's internal state between them. The piece that changes the answer is the one that matters.",
    why:
      "Researchers use this all the time to track down which parts of a model matter. You pick two prompts that the model handles differently (an 'original' prompt and a 'changed' prompt, which researchers call 'clean' and 'corrupted'), run both, then copy one part's internal state from the original run into the changed run, one part at a time. If swapping head 7.3's output from the original into the changed run makes the changed prompt behave like the original, that head helps cause the difference. It's sort of like debugging by swapping parts until you find the one that was broken. The heatmap shows the effect of swapping each part, so you can spot the ones that matter at a glance.",
  },
  {
    id: 'circuit-graph',
    title: 'Key parts map',
    target: '[data-tip="circuit-graph"]',
    placement: 'left',
    blurb:
      "These are the heads and layers that pushed the prediction most. Lines show one kind of connection between them: the direct value path.",
    why:
      "Each circle is one attention head and each square one processing layer (MLP), placed on its layer. Bigger shapes pushed the prediction harder. Blue ones pushed toward the predicted word, orange ones pushed against it. The scores come from the same estimate as the Why (DLA) tab, and only parts above the threshold are shown. A line from an earlier part to a later head shows how much the earlier part's output, copied straight through that head, pushes the predicted word: blue lines push toward it, orange lines push away, and thicker lines push harder. It leaves out other ways parts affect each other, such as changing where a head looks, and it only connects the parts shown, so treat it as a partial map. Swap & Compare can test single parts directly, not connections.",
  },
  // Only registered when custom models are switched on (contract §7; on since T32).
  ...(CUSTOM_MODELS_ENABLED ? [CUSTOM_MODEL_VERDICT_TIP] : []),
  {
    id: 'neuronpedia-link',
    title: 'Neuronpedia link',
    target: '[data-tip="neuronpedia-link"]',
    placement: 'top',
    blurb:
      "Opens this feature's page on Neuronpedia, a public database of SAE features. It shows more examples, community descriptions, and lets you explore related features.",
    why:
      "Neuronpedia is a community project that catalogs SAE features across multiple models. Each feature gets a page with its top activating examples, auto-generated descriptions, and sometimes human-written annotations from researchers who've studied it. When Pry shows you a feature labeled 'past-tense verb' or 'female professional,' that label originally came from Neuronpedia's labeling pipeline. Clicking through lets you see more context than Pry can fit in a card, including how the feature behaves on thousands of other inputs. It's the closest thing to a field guide for model internals.",
  },
  // Tips for 0.3.x features (T20, T22, T24, T25, T26), registered in T30.
  {
    id: 'panel-a-copying-heads',
    title: 'Copying heads',
    target: '[data-tip="panel-a-copying-heads"]',
    placement: 'bottom',
    blurb:
      "Runs a short test to find the heads that copy: when a word repeats, they look at what came after it last time.",
    why:
      "Researchers call these induction heads. Pry feeds the model a run of random word-pieces, then the same run again, and scores every head on how much it looks at 'whatever came next last time' during the second pass. A high score is good evidence a head copies like this. It doesn't prove that's all the head does, and it only uses this one kind of test.",
  },
  {
    id: 'panel-a-copying-sequence',
    title: 'The repeated words',
    target: '[data-tip="panel-a-copying-sequence"]',
    placement: 'bottom',
    blurb:
      "The test: random word-pieces, then the same ones again. The second time through, a copying head can guess each next one.",
    why: null,
  },
  {
    id: 'experiments-button',
    title: 'Experiments',
    target: '[data-tip="experiments-button"]',
    placement: 'bottom',
    blurb:
      "Short guided experiments that researchers have studied. Pick one and Pry sets up the prompt and opens the right panel.",
    why: null,
  },
  {
    id: 'compare-panel',
    title: 'Compare',
    target: '[data-tip="compare-panel"]',
    placement: 'bottom',
    blurb:
      "Type two prompts that differ by a word or two, then press Compare to see how the predictions, features and attention change.",
    why:
      "Small, controlled changes are one of the clearest ways to learn what a model is reacting to. If swapping 'he' for 'she' changes which features light up, those features are likely tracking that difference. This view only shows what changed, not why. To test which parts cause a change, try Swap & Compare.",
  },
  {
    id: 'watch-it-write',
    title: 'Watch it write',
    target: '[data-tip="watch-it-write"]',
    placement: 'top',
    blurb:
      "Let the model keep writing one word-piece at a time, and see which other guesses it nearly picked at each step.",
    why:
      "The model never writes a whole sentence at once. It scores every possible next word-piece, one is picked, it's added to the text, and the model goes again. Temperature controls how that pick is made: at 0 it always takes the top guess, and higher values let less likely guesses through more often.",
  },
  {
    id: 'concept-search',
    title: 'Find a concept',
    target: '[data-tip="concept-search"]',
    placement: 'bottom',
    blurb:
      "Search for any concept by name, then steer with the matching feature, even if it didn't light up on your prompt.",
    why:
      "The search compares your words with the feature labels on Neuronpedia. Those labels were written by another AI and can be wrong, and the closest match isn't always a good match. Steering is the honest check: if pushing the feature changes the text in the way the label suggests, the label is probably about right.",
  },
];
