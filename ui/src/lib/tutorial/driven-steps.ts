// Driven tutorial steps — content authoritative per plan §3.
import type { TutorialActions } from './actions';

export interface DrivenStep {
  id: string;
  blurb: string;
  why: string | null;
  target: string | null;
  action: (ctx: TutorialActions) => Promise<void> | void;
  awaitGenerate?: boolean;
  awaitLayerSwitch?: boolean;
}

export const drivenSteps: DrivenStep[] = [
  // ---- Prompt 1 — "The cat sat on the" ----
  {
    id: '1.1',
    blurb:
      "This is Pry. It runs a small transformer on your laptop and lets you crack it open and look inside (which, until pretty recently, was a thing you mostly couldn't do). I'll drive the first two demos, just hit Next.",
    why:
      "Most people treat language models as magic boxes. You type stuff, text comes out, nobody has any clear idea what happened in between (which is a pretty wild place to have ended up as a civilization, when you think about it). Interpretability is the practice of prying the box open and asking what the model actually did. Which earlier words it looked at, which internal concepts fired, which tiny circuits lit up. Pry uses GPT-2 small because it's small enough to run on a normal computer and well-studied enough that we sort of know what to look for. Next few minutes: one attention demo, one features demo. Both driven, so you can watch the UI do each move in the actual app. Exit anytime with the X. Bring it back with the ? icon in the header.",
    target: 'header-help',
    action: () => {
      /* no-op */
    },
  },
  {
    id: '1.2',
    blurb:
      "Filling in a classic next-word test: *The cat sat on the ___*. Almost everyone reading this just auto-completed it in their head without trying. The model has the same problem.",
    why:
      "This sentence is a benchmark for a reason. Just about every English speaker finishes it with 'mat' on autopilot, so if the model gets it right it's just reproducing a pattern baked into the language, not proving anything deep. If it picks something weirder (floor, ground, the edge of a cliff), that's telling you something about what it was trained on, not about whether it's broken. The other interesting thing: to predict what got sat on, the model has to look *backward* through the sentence. That backward looking is exactly what Panel A is about to show. Interpretability basically starts with 'okay, which earlier words was it actually paying attention to,' and unlike a lot of AI questions, that one has a mechanical answer instead of a vibes-based one.",
    target: 'prompt-input',
    action: (ctx) => {
      ctx.setPrompt('The cat sat on the');
    },
  },
  {
    id: '1.3',
    blurb:
      "Hitting Run. First time it has to load the model into memory, so give it a second. After that it's basically instant.",
    why:
      "Under the hood, Pry talks to a little Python process that handles the model itself (TransformerLens plus SAELens, if library names are your thing). First Run on a fresh session wakes it up, which is why you see a progress bar the first time and never again. After that, every Run just ships the prompt off and gets back one big JSON blob. The tokenization, the attention numbers for every head, and the SAE features that fired on every token. No hidden state between runs, no learning, no memory. Everything you're about to see in the panels comes from that one response, which is nice, because it means nothing is happening behind your back.",
    target: 'run-button',
    awaitGenerate: true,
    action: async (ctx) => {
      await ctx.runGenerate();
    },
  },
  {
    id: '1.4',
    blurb:
      'The model just read the sentence token by token, trying to predict the next word at every single position. Panel A is showing what it was paying attention to while it did that.',
    why:
      "Here's a thing that surprises people. A transformer isn't really making one prediction. It's making a prediction at every word position at the same time, using the same machinery over and over (all twelve layers of it, if you're counting). The prediction you'd usually care about is the one at the last position. Pry isn't showing you those predictions yet, that's a planned panel for later. What it IS showing is the attention, basically the model's internal notes on which earlier words it used to build each prediction. So Panel A isn't the answer. It's the model showing its work. And showing your work is the part that's actually hard to fake. Outputs can be memorized. The pattern of which words looked at which other words, usually not.",
    target: 'panel-a-heatmap',
    action: (ctx) => {
      ctx.setActiveTab('attention');
    },
  },
  {
    id: '1.5',
    blurb:
      "Clicking the 'cat' token. Panel A just reframed. Every cell is now about what *cat* was paying attention to, not the whole sentence at once.",
    why:
      "Attention is a huge table of 'who was looking at who,' but at any given moment you want to ask a specific question. When the model was working on *this* word, which earlier words did it actually look at? The token strip up top lets you pick the focus, and the grid below instantly re-computes around whatever you click. It's not showing you a different model, it's showing you a different slice of the same underlying data. Sort of like a mall security office where every camera is always recording, but the guard can only actually watch one screen at a time. You pick which camera to watch. 'Show me the whole model' is impossible. 'Show me what it did at this exact word' is completely doable, and it turns out to be way more useful anyway.",
    target: 'panel-a-heatmap',
    action: (ctx) => {
      const matched = ctx.findTokenIndex(
        (t) => t.text.trim().toLowerCase() === 'cat',
      );
      ctx.setFocusTokenIndex(matched ?? 1);
    },
  },
  {
    id: '1.6',
    blurb:
      "Every cell in that grid is one attention head at one layer. Switching the Agg dropdown from Max to Mean. Watch the pattern change. Same data, different question.",
    why:
      "GPT-2 small has twelve layers, each with twelve attention heads. That's the rows and columns in the grid (144 specialists, basically, all of them doing slightly different things). For whichever token you've focused, Pry takes that token's attention numbers at each head and has to squish them down into one number so it can color a cell. How it squishes depends on the Agg dropdown. **Max** asks 'did this head lock hard onto one specific earlier word?' **Mean** asks 'was attention peaky or spread thin?' **Entropy** asks 'how spread out was the focus, was this head basically refusing to choose?' Three different questions, same underlying numbers. Researchers flip through these constantly. Max is good for spotting heads that just copy. Mean shows general engagement. Entropy flags heads that are basically phoning it in, which, it turns out, a lot of heads do most of the time.",
    target: 'panel-a-agg-selector',
    action: (ctx) => {
      ctx.setPanelAAggregation('mean');
    },
  },
  {
    id: '1.7',
    blurb: "So, is the model *understanding* the sentence, or just pattern-matching? Honest answer: that's kind of a bad question.",
    why:
      "The understand-vs-pattern-match split is the central interpretability question, and it's also a little bit of a trap. What we can say, mechanically, is this: specific attention heads pulled 'cat' and 'sat' forward to the final 'the,' some MLP layers that have learned which words tend to appear together took it from there, and a distribution over completions popped out. Whether that counts as 'understanding' depends entirely on what you mean by the word (which, it turns out, philosophers have been arguing about for a long time, so don't feel bad if you're not sure). The thing that actually matters for safety is whether the same behavior holds up when you change the input. Paraphrase it as 'A feline rested upon a.' If the same circuit fires and produces the same answer, the model learned something real. If it falls apart, it was leaning on surface features. You can try this yourself after the tour ends.",
    target: null,
    action: () => {
      /* no-op */
    },
  },

  // ---- Prompt 2 — "The doctor told the nurse she would" ----
  {
    id: '2.1',
    blurb:
      'Second demo. This one uses a sentence that surfaces *social bias* as literal internal features you can point at. Filling it in now.',
    why:
      "First demo showed you attention. That's where the model decides what to *look at*. This one shows you features, where the model decides what *concepts* are active right now. A sparse autoencoder (SAE) takes the model's internal state at a given word and breaks it down into thousands of candidate concepts, most of them off, maybe ten to thirty turned on at a time. When they work, each feature lines up with something a human can actually name. 'Past-tense verb.' 'Thing inside quotation marks.' 'Medical profession.' Biases the model picked up from training data don't just sit in the outputs. They show up as concrete features firing, so you can literally point at them (which is either reassuring or deeply uncomfortable, depending on the day).",
    target: 'prompt-input',
    action: (ctx) => {
      ctx.setPrompt('The doctor told the nurse she would');
    },
  },
  {
    id: '2.2',
    blurb:
      "Running. We want to see what the model thinks 'she' refers to, and which internal features fire on that word.",
    why:
      "Read 'The doctor told the nurse she would,' and most people silently decide 'she' means the nurse without even noticing they made a choice. That's a bias English-language training data has been carrying around about gender and jobs for, oh, a while. The model definitely absorbed it. That's not the interesting question. The interesting question is whether we can actually *see* it absorbing it, specifically and mechanically, instead of just guessing from outputs. In a moment we'll click the 'she' token and look at which features fired hardest on it. If the model's internal representation of 'she' has stuff related to 'nurse' or 'female professional' in it, the bias isn't theoretical. It's sitting right there in the activations, pretty close to the surface.",
    target: 'run-button',
    awaitGenerate: true,
    action: async (ctx) => {
      await ctx.runGenerate();
    },
  },
  {
    id: '2.3',
    blurb: 'Now look at Panel B on the right \u2014 the feature explorer. If your screen is narrow, I\'ll switch the tab for you.',
    why:
      "Panel B shows the top SAE features that fired on whatever token you've focused, sorted by how strongly each one activated. Each row has a label (auto-generated from the feature's strongest training examples via Neuronpedia), a bar showing the activation strength, and a peek at the sort of text where that feature usually lights up. Labels aren't always great. SAE feature labeling is a whole active research area on its own, and sometimes the auto-label undersells what the feature actually captures, so always sanity-check against the example text. Think of Panel B as a list of concepts the model knows about, ranked by how loud each one was yelling about this specific word.",
    target: 'tab-features',
    action: (ctx) => {
      ctx.setActiveTab('features');
    },
  },
  {
    id: '2.4',
    blurb:
      "Clicking the 'she' token. That tells Panel B to show me the features that fired on that word specifically.",
    why:
      "Features are per-token. The model's internal state at each word position is one vector, and the SAE decomposes that one vector. So 'the SAE features of the prompt' isn't really a thing you can ask for, you always have to ask 'features on this one token.' Which means picking the right token matters a lot. On content words like 'nurse' you tend to get semantically rich features (healthcare, caregiving, specific job-role stuff). On function words like 'the' or 'would' you mostly get grammatical features. 'She' is the interesting one here because it's a pronoun, and pronouns have to carry an opinion about who they're referring to. The features firing on 'she' are basically the model's best guess about who 'she' is, frozen in place for us to look at.",
    target: 'panel-b-token-strip',
    action: (ctx) => {
      const matched = ctx.findTokenIndex(
        (t) => t.text.trim().toLowerCase() === 'she',
      );
      if (matched !== undefined) ctx.setFocusTokenIndex(matched);
      else console.warn("tutorial: 'she' token not found in response");
    },
  },
  {
    id: '2.5',
    blurb:
      "Look at the top features on 'she.' Anything about nurses, women, caregiving roles? That's the bias, visible. Not inferred from outputs. Shown.",
    why:
      "This is the part most people don't realize you can do. When a feature labeled something like 'female professional' or 'caregiving role' fires hard on 'she' in this specific sentence, it's not a guess about what the model 'thinks.' It's a direct snapshot of the intermediate state the model was computing in, frozen at that one word. Whether you call that bias, or world-knowledge, or both at the same time, is a judgment call (a real one, not a gotcha). But you can only make the judgment call if the thing you're judging is actually visible. Interpretability doesn't fix any of this on its own. What it does is take these problems out of the vibes category and put them in the pointable-at category, and that's the first thing you need before anybody can do anything about them.",
    target: 'panel-b-features-list',
    action: () => {
      /* no-op */
    },
  },
  {
    id: '2.5b',
    blurb:
      "Now try something. I'm switching the SAE from layer 8 to layer 2. Watch how the features completely change. Same token, different depth in the model.",
    why:
      "The model has 12 layers, and each one builds on the last. Early layers (0-3 or so) tend to catch surface stuff, grammar, word shapes, the kind of patterns you'd spot in a sentence diagram. Later layers (8-11) catch meaning, roles, relationships between concepts. Layer 8 is where we started because it's deep enough to see semantic features but not so deep that everything becomes abstract mush. Switching to layer 2 on the same 'she' token is going to show you a completely different set of features, more about the word itself and less about what it means in context. This is why layer selection matters: the question isn't just 'what features fired' but 'what features fired at what depth,' and the answer changes a lot.",
    target: 'panel-b-layer-selector',
    awaitLayerSwitch: true,
    action: (ctx) => {
      ctx.switchSaeLayer?.(2);
    },
  },
  {
    id: '2.6',
    blurb:
      'This is the part that actually matters: you can watch one specific internal feature during training, alignment work, or fine-tuning.',
    why:
      "Imagine a safety researcher looking at what you're looking at right now. They wouldn't just shake their head and close the tab. They'd flag the feature, save its index, and watch what happens to it during downstream training. Fine-tuning a model for a hiring tool? You'd want to know whether the 'female-nurse' concept is getting louder or quieter with every training step. Red-teaming a jailbreak? You'd want to know whether the attack is actually suppressing the 'harmful content' features deep in the model, or just sneaking past a shallow classifier sitting on top. Feature-level interpretability is the difference between 'the model refused' and 'we know *why* it refused, and we know that reason generalizes.' Outputs lie. Features lie a lot less.",
    target: null,
    action: () => {
      /* no-op */
    },
  },
  {
    id: '2.7b',
    blurb:
      "There's more to explore. The tabs at the top of each panel unlock predictions, logit lens, steering, and more. Hit the ? icon and try the Advanced Tour when you're ready.",
    why: null,
    target: null,
    action: () => {
      /* no-op */
    },
  },
  {
    id: '2.7',
    blurb:
      "That's the tour. Bring it back anytime with the ? in the header. The panels are yours now. Try your own prompts.",
    why: null,
    target: null,
    action: (ctx) => {
      ctx.exit();
    },
  },
];
