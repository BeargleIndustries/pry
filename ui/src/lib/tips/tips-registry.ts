// Central registry of first-mount contextual tips.
// Each entry becomes at most one popover, gated on localStorage key
// `pry:tip_seen:{id}`. See ui/src/lib/components/FirstTimeTip.svelte.
//
// Quick tour coordination: `tutorialStepId` (when set) names a quick-tour step
// as `pry.quick-tour#<stepId>`; the tip is auto-marked seen once the Lessons
// runner shows that step. The anchor fallback in `coordinate.ts` also flips a
// tip's flag when the current tour step points at an anchor named after its
// `data-tip` id (e.g. `predictions-panel`, `watch-it-write`), with no
// explicit `tutorialStepId`.

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
  /** Preferred side of the target; placePopup flips or insets when it doesn't fit. */
  placement: TipPlacement;
  /** Point the arrow aims at, as a fraction [fx, fy] of the target rect. Default [0.5, 0.5]. */
  focus?: [number, number];
  /**
   * If set, the tip is auto-marked seen when the quick tour shows this step:
   * `pry.quick-tour#<stepId>`, a section id in `src/lessons/pry.quick-tour/lesson.md`.
   */
  tutorialStepId?: string;
}

const CUSTOM_MODEL_VERDICT_TIP: TipDef = {
  id: 'custom-model-verdict',
  title: 'Will it fit?',
  target: '[data-tip="custom-model-verdict"]',
  placement: 'bottom',
  blurb:
    "The badge says whether this model fits your computer's memory. Models you add here run attention, predictions, Logit Lens, Why (DLA), knockouts and the Swap test, but not features.",
  why:
    "To show features, a model needs a matching sparse autoencoder (SAE) trained on it, and Pry only has those for its built-in models. A model you add loads without one, so the Features and Steering panels stay empty for it. Everything that reads the model's own parts still works: attention, predictions, Logit Lens, Why (DLA), knocking heads out, and the Swap test.",
};

export const tipsRegistry: TipDef[] = [
  {
    // The word chips strip in +page.svelte. Quick-tour step 3 covers the same
    // strip, so showing that step marks this tip seen.
    id: 'word-strip',
    title: 'Word chips',
    target: '[data-tour="token-strip"]',
    placement: 'bottom',
    // The strip spans the window; the chips start at its left end.
    focus: [0.2, 0.5],
    blurb:
      "Each chip is a token (a word piece), one chunk of text the model reads. A dot means the piece starts with a space. Click a chip to point every panel at that word.",
    why:
      "Models don't read whole words. They read tokens, pieces from a fixed list (about 50,000 of them for GPT-2 small). Common words get one piece, and rare words get split into a few. The model makes a guess after every piece, so most panels answer questions about one piece at a time, and that's the one you clicked.",
    tutorialStepId: 'pry.quick-tour#step-3',
  },
  {
    id: 'panel-a-heatmap',
    title: 'Attention grid',
    target: '[data-tip="panel-a-heatmap"]',
    placement: 'right',
    focus: [0.5, 0.4],
    blurb:
      "Attention is how the model picks which earlier words to look at before it guesses the next one. Each square is one head, a small reader inside the model (rows are layers, columns are heads, so GPT-2 small has a 12×12 grid of 144). Brightness scores how the focused word looked at earlier words, using the question picked in the Score by menu.",
    why:
      "The grid is a summary, not the attention itself. For the word chip you clicked, each square boils one head's whole attention pattern down to one number. A bright square scored high on the Score by question, and a dim one barely registered. Click any square to open the single-head view and you'll see the full pattern underneath, word by word.",
  },
  {
    id: 'panel-a-head-detail',
    title: 'One head, up close',
    target: '[data-tip="panel-a-head-detail"]',
    placement: 'top',
    blurb:
      "Every word this one head looked at, for every word in your prompt. A bright square means the word in that row looked hard at the word in that column.",
    why:
      "Each square answers one question: when the model was working on the word in this row, how much did this head look at the word in this column? Rows are the word doing the looking, columns are the word being looked at. The top-right half is empty because a word can't look ahead. Patterns worth spotting: a line just below the diagonal (the head looks at the word right before), a bright stripe down one column (the head keeps going back to one word), or a few lone bright squares (the head has a narrow, rule-like job). A flat, even pattern means the head isn't really choosing.",
  },
  {
    id: 'panel-a-agg-selector',
    title: 'Score by menu',
    target: '[data-tip="panel-a-agg-selector"]',
    placement: 'bottom',
    blurb:
      "Different questions about the same attention data. The grid re-colors based on which one you're asking.",
    why:
      "Every square in the grid has to boil a whole attention pattern down to one number for its color. In FROM mode, Strongest look scores how hard this head locked onto one earlier word. Spread scores whether it focused on one word or scattered across lots of them. Looks back is how far back in the sentence it looked, on average. Previous word is how much it looked at the word right before, which lights up heads that track the previous word. TO mode flips the direction (how the later words looked back at this one) and adds Average received: how much attention this word got, on average, from the words after it. The first word has nothing earlier to look at, so in FROM mode some of these don't apply to it and its squares show grey. The last word has nothing after it, so in TO mode all of its squares show grey. Pick an earlier word.",
  },
  {
    id: 'panel-b-feature-row',
    title: 'A feature',
    target: '[data-tip="panel-b-feature-row"]',
    placement: 'left',
    blurb:
      "Each row is one feature: a pattern the sparse autoencoder (SAE) found active on the selected word, often matching an idea. The bar shows how strongly it fired, and the label is the name Neuronpedia gave it.",
    why:
      "The labels are auto-generated from the training examples where the feature fires hardest (via Neuronpedia), which means they're a best guess, not a guarantee. Always peek at the example text underneath before trusting a label, because sometimes the label catches one pattern while the feature covers two or three things at once. The SAE is a separate small network trained to split the model's residual stream into patterns like these, one per feature.",
  },
  {
    id: 'panel-a-from-selector',
    title: 'FROM button',
    target: '[data-tip="panel-a-from-selector"]',
    placement: 'bottom',
    blurb:
      "FROM shows where the focused word was looking. Each square sums up how one head spread this word's attention over the earlier words.",
    why:
      "When the model works on a word, each head can look back at any earlier word, and a little at the word itself. FROM asks where that look went, and the Score by menu picks how it's turned into one brightness.",
  },
  {
    id: 'panel-a-to-selector',
    title: 'TO button',
    target: '[data-tip="panel-a-to-selector"]',
    placement: 'bottom',
    blurb:
      "TO flips the direction: each square shows how the later words looked back at the focused word. Click a different word chip above to change which word is focused.",
    why:
      "It's handy for finding the words the rest of the sentence leans on, like a name that later words keep looking back at.",
  },
  {
    id: 'panel-b-layer-selector',
    title: 'Layer menu',
    target: '[data-tip="panel-b-layer-selector"]',
    placement: 'bottom',
    blurb:
      "Pick how deep into the model to look. Deeper layers tend to hold more abstract ideas. Switching layers runs the SAE for that depth.",
    why:
      "The model has a stack of layers (12 in GPT-2 small), each one building a richer picture. Early layers tend to catch surface stuff, like word shape, grammar and part of speech. Later layers catch meaning, relationships, and who's who in a sentence, like whether 'she' means the nurse. Switching layers here loads the SAE for the new depth and runs the model on your prompt again. That's a few seconds of waiting. Try jumping between an early layer and a late one on the same word to see the difference.",
    // Quick-tour step 8 points at the Features panel, where this menu sits.
    tutorialStepId: 'pry.quick-tour#step-8',
  },
  {
    id: 'predictions-panel',
    title: 'Predictions',
    target: '[data-tip="predictions-panel"]',
    placement: 'left',
    focus: [0.5, 0.2],
    blurb:
      "The model's top 10 guesses for the next token, ranked by probability. Each bar shows that guess's chance.",
    why:
      "Every time the model reads a token, it scores every token in its vocabulary and turns those scores into chances that add up to 100%. Here's the top 10. When one guess gets most of the chance, the first bar dominates and the rest are tiny. When the chance is spread out, you'll see several bars about the same size. Those spread-out spots are often a good place to look, since small changes to the prompt can tip them.",
  },
  {
    id: 'feature-histogram',
    title: 'Feature history chart',
    target: '[data-tip="feature-histogram"]',
    placement: 'right',
    blurb:
      "A tiny chart of how strongly this feature fired on every word in the sentence. A tall bar means that word set it off hard.",
    why:
      "Most features don't fire evenly across a sentence. A 'past-tense verb' feature lights up on 'sat' and mostly ignores everything else. A 'function word' feature might glow faintly on every 'the' and 'on'. This chart shows you that at a glance without clicking through every word. A hatched bar means the feature wasn't in that word's top five, so Pry didn't keep its exact strength. It doesn't mean zero. Which words set a feature off often tells you more than its strength on any single word.",
  },
  {
    id: 'logit-lens-heatmap',
    title: 'Logit Lens',
    target: '[data-tip="logit-lens-heatmap"]',
    placement: 'right',
    focus: [0.5, 0.5],
    blurb:
      "A rough read of what each layer's partial result would predict, if you made the model answer early.",
    why:
      "Each layer adds its work to the residual stream. The Logit Lens reads the residual stream at each layer and asks, 'if you had to guess right now, what would you say?' Indigo cells already match the final answer, and brighter means a higher chance at that layer. Early rows are a rough read, since the middle layers weren't built to be read this way, so an early match is a hint, not proof. If the guess changes partway up, the layers around the change are a good place to look next, and a knockout or a Swap test can check them.",
  },
  {
    id: 'dla-waterfall',
    title: 'Why (DLA) chart',
    target: '[data-tip="dla-waterfall"]',
    placement: 'right',
    focus: [0.5, 0.3],
    blurb:
      "Each bar is one part of the model. Blue pushed directly toward the predicted word, orange pushed against it. Only direct pushes count, so a part that helps by nudging other parts can look small here.",
    why:
      "When the model guesses 'mat' after 'The cat sat on the', every attention head and every MLP pushes on that word's score. Some push toward 'mat' (blue), some push against it (orange). You're seeing the 30 biggest direct pushes. DLA (direct logit attribution) only counts what each part writes straight into the final guess, so a head that helps by changing what later heads do won't get credit here. Researchers use it as a first pass at finding which heads matter. Under the chart, Pry lists the bars' total, the real logit and the gap between them. The gap is the embedding's own direct push plus the attention-output and unembedding biases, not drawn as bars.",
  },
  {
    id: 'export-button',
    title: 'Download button',
    target: '[data-tip="export-button"]',
    placement: 'bottom',
    blurb:
      "Saves a JSON file of this run (raw numbers). For something to share, save the run to your Notebook and save it as a web page: a readable report that works offline.",
    why:
      "The JSON file is for digging in with your own code. The web page is for people: it'll open in any browser, even without Pry.",
  },
  {
    id: 'steering-panel',
    title: 'Steering',
    target: '[data-tip="steering-panel"]',
    placement: 'left',
    focus: [0.5, 0.2],
    blurb:
      "Pick a feature, set the strength, press Run Steered. You're nudging the model from the inside for this one run. Compare the outputs to see what changed.",
    why:
      "Up to now you've been looking, and steering lets you test. When you steer a feature, Pry adds more of that feature to the model's insides at one layer, scaled by the strength you pick. Push a 'nurse' feature with a positive strength and see whether the model starts writing more about nurses, or use a negative strength and see whether the nurse idea fades. If the output changes the way you'd expect, that's evidence the feature pushes the writing that way at this strength. It doesn't show the label covers everything the feature does. If nothing changes, the feature might show up alongside the idea without driving it. That difference matters a lot for safety work.",
  },
  {
    id: 'ablation-head-toggle',
    title: 'Ablation button',
    target: '[data-tip="ablation-head-toggle"]',
    placement: 'right',
    blurb:
      "Turn Ablation on, then click squares in the grid to pick heads to knock out. A Run Ablated button appears once you've picked one. It runs the model again without those heads, so you can see if the guess changes.",
    why:
      "There are 144 attention heads in GPT-2 small (12 layers times 12 heads), and on any one sentence, many of them barely change the answer. Knocking heads out is how you find the ones that matter. Pry swaps a head's output for zeros, so the rest of the model has to answer without it. A big change in the guesses means the model needed that head. No change means the model could answer without it here. Other parts may have covered for it. Researchers do this over and over to map which heads form the circuit behind a behavior.",
  },
  {
    id: 'ablation-feature-toggle',
    title: 'Ablation button',
    target: '[data-tip="ablation-feature-toggle"]',
    placement: 'right',
    blurb:
      "Turn Ablation on, then click the round x next to each feature to switch it off. Press Run Ablated to see the guesses without them. If the answer shifts, those features affect the guess here.",
    why:
      "Feature labels come from Neuronpedia, based on the text that sets each feature off hardest. Showing up isn't the same as causing, though. A feature labeled 'nurse' can fire on the word 'nurse' without changing anything the model writes. It might just be along for the ride. Knocking it out is a test: switch the feature off, run again, and see whether the guesses change in a nurse-related way. Knocking out a feature removes only the part of the residual stream the SAE accounts for. The SAE's leftover error stays, so a small change can mean the feature mattered little or that its share was small.",
  },
  {
    id: 'patching-panel',
    title: 'Swap test',
    target: '[data-tip="patching-panel"]',
    placement: 'right',
    focus: [0.5, 0.2],
    blurb:
      "Run two prompts, then swap one piece of the model's insides from one run into the other to see which piece changes the answer.",
    why:
      "Researchers use this all the time to track down which parts of a model matter (they call it activation patching). You pick two prompts the model answers differently, an original prompt and a changed prompt, and run both. Then Pry copies one part's output from the original run into the changed run, one part at a time. If swapping layer 7, head 3 raises the original answer's score a lot, that head carries information that matters for the difference between the two prompts. Blue squares raise the original answer's score, and the number is how much it went up. Orange squares push it further away.",
  },
  {
    id: 'circuit-graph',
    title: 'Key parts map',
    target: '[data-tip="circuit-graph"]',
    placement: 'right',
    focus: [0.5, 0.4],
    blurb:
      "The heads and layers that pushed the prediction most, with lines for one kind of connection between them: the direct value path.",
    why:
      "Each circle is one attention head and each square one MLP layer (the processing step after attention), placed on its layer. Bigger shapes pushed the prediction harder. Blue ones pushed toward the predicted word, orange ones pushed against it. The scores come from the same estimate as the Why (DLA) tab, and only parts above the threshold are shown. A line from an earlier part to a later head shows how much the earlier part's output, copied straight through that head, pushes the predicted word: blue lines push toward it, orange lines push away, and thicker lines push harder. It leaves out other ways parts affect each other, such as changing where a head looks, and it only connects the parts shown, so treat it as a partial map. The Swap test can check single parts directly, not connections.",
  },
  // Only registered when custom models are switched on (contract §7; on since T32).
  ...(CUSTOM_MODELS_ENABLED ? [CUSTOM_MODEL_VERDICT_TIP] : []),
  {
    id: 'neuronpedia-link',
    title: 'Neuronpedia link',
    target: '[data-tip="neuronpedia-link"]',
    placement: 'top',
    blurb:
      "Opens this feature's page on Neuronpedia, a public catalog of features from sparse autoencoders (SAEs). It shows more examples, community notes, and related features.",
    why:
      "Neuronpedia is a community project that catalogs features across many models. Each feature gets a page with the text that sets it off hardest, auto-generated descriptions, and sometimes notes from researchers who've studied it. When Pry shows you a feature labeled 'past-tense verb' or 'female professional', that label came from Neuronpedia's labeling pipeline. Clicking through shows more than Pry can fit in a card, including how the feature behaves on thousands of other inputs. It's the closest thing to a field guide for model insides.",
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
      "Researchers call these induction heads. Pry feeds the model a run of random word pieces, then the same run again, and scores every head on how much it looks at 'whatever came next last time' during the second pass. A high score is good evidence a head copies like this. It doesn't prove that's all the head does, and it only uses this one kind of test.",
  },
  {
    id: 'panel-a-copying-sequence',
    title: 'The repeated words',
    target: '[data-tip="panel-a-copying-sequence"]',
    placement: 'bottom',
    blurb:
      "The test: random word pieces, then the same ones again. The second time through, a copying head can guess each next one.",
    why:
      "The pieces are random so the model can't guess them from meaning or grammar. If it suddenly guesses well on the second pass, something's copying, and the heads that look back at the first pass are the suspects.",
  },
  {
    id: 'experiments-button',
    title: 'Experiments',
    target: '[data-tip="experiments-button"]',
    placement: 'bottom',
    blurb:
      "The guided experiments are lessons now. The flask button opens Lessons at Stage 2, where the first of them start.",
    why:
      "Each experiment asked a question researchers already have an answer for, and the lessons kept those questions. They walk you through the panels a step at a time, so you know what to look for and why it matters.",
  },
  {
    // Shown once, only to people with 0.3.8 tour progress (lessons/progress.ts
    // migrateTourProgress marks it seen for everyone else).
    id: 'lessons-toggle',
    title: 'Lessons',
    target: '[data-tour="lessons-toggle"]',
    // Beside the button, not under it: below sits the Lessons sidebar when it's
    // open on the right, and a tip pushed clear of it ends up too far away.
    placement: 'left',
    blurb:
      "The old guided tour's teaching lives in Lessons now. The chapters you finished count as visited there.",
    why:
      "The tour got split in two. The quick tour under the ? button just points out where things are, and Lessons do the explaining, one question per lesson, on the same panels you've been using.",
  },
  {
    id: 'compare-panel',
    title: 'Compare',
    target: '[data-tip="compare-panel"]',
    placement: 'top',
    focus: [0.5, 0.25],
    blurb:
      "Type two prompts that differ by a word or two, then press Run both to see how the predictions, features and attention change.",
    why:
      "Small, controlled changes are one of the clearest ways to learn what a model is reacting to. If swapping 'he' for 'she' changes which features fire, those features are likely tracking that difference. This view only shows what changed, not why. To test which parts cause a change, try the Swap test.",
  },
  {
    id: 'watch-it-write',
    title: 'Watch it write',
    target: '[data-tip="watch-it-write"]',
    placement: 'left',
    focus: [0.5, 0.3],
    blurb:
      "Let the model keep writing one word piece at a time, and see which other guesses it nearly picked at each step.",
    why:
      "The model doesn't write a whole sentence at once. It scores every possible next word piece, one is picked, it's added to the text, and the model goes again. Temperature controls how that pick is made: at 0 it always takes the top guess, and higher values let less likely guesses through more often.",
  },
  {
    id: 'concept-search',
    title: 'Find a concept',
    target: '[data-tip="concept-search"]',
    placement: 'bottom',
    blurb:
      "Search for any idea by name, then steer with the matching feature, even if it didn't fire on your prompt.",
    why:
      "The search compares your words with the feature labels on Neuronpedia. Those labels were written by another AI and can be wrong, and the closest match isn't always a good match. Steering is one check: if pushing the feature changes the text the way the label suggests, the label fits at least that much.",
  },
];
