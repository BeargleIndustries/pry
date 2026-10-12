// The guided tour: one path through every part of Pry, in chapters.
//
// Each step can:
//  - enter(ctx): set up the screen when the step appears (switch tabs, pick a
//    word, choose a view). Runs again on Back and on chapter jumps, so it must
//    be quick and safe to repeat. No engine work except what a tab fetches on
//    its own.
//  - run: slow engine work done when the user presses Next (Run a prompt,
//    switch layers, knock out heads...). Success is "result(ctx) changed";
//    otherwise the card offers Try again or Skip.
//  - target: a `data-tour` or `data-tip` anchor to highlight (see anchors.ts).
//  - compare: true shows Compare mode for the step; every other step leaves it.
//
// Copy rules (checked in tour-steps.test.ts): short blurbs, an optional
// longer "Why?", plain words, no em dashes. Written for GPT-2 small.

import type { TourContext } from './actions';

export interface StepRun {
  /** Next button label while this step is current, e.g. "Run it". */
  label: string;
  act(ctx: TourContext): Promise<void>;
  /** Value that changes when the work succeeded (compared before and after). */
  result(ctx: TourContext): unknown;
  /** Already done (e.g. this prompt was just run): Next just moves on. */
  skipIf?(ctx: TourContext): boolean;
}

export interface TourStep {
  id: string;
  blurb: string;
  why: string | null;
  target: string | null;
  compare?: boolean;
  enter?(ctx: TourContext): void;
  run?: StepRun;
}

export interface TourChapter {
  id: string;
  title: string;
  /** One line for the chapter menu. */
  summary: string;
  steps: TourStep[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function focusWord(ctx: TourContext, word: string) {
  const i = ctx.findTokenIndex((t) => t.text.trim().toLowerCase() === word);
  if (i !== undefined) ctx.setFocusTokenIndex(i);
}

/** The plain Attention panel (not the copying-heads view, no ablation). */
function showAttention(ctx: TourContext, view: 'lines' | 'expert') {
  ctx.hideCopyingHeads();
  ctx.setHeadAblation(false);
  ctx.openLeftTab('attention');
  ctx.setAttentionView(view);
}

function runPrompt(prompt: string): StepRun {
  return {
    label: 'Run it',
    skipIf: (ctx) => ctx.response()?.prompt === prompt,
    act: async (ctx) => {
      ctx.setPrompt(prompt);
      await ctx.runGenerate();
    },
    result: (ctx) => ctx.response(),
  };
}

const CAT = 'The cat sat on the';
const JORDAN = 'Michael Jordan played the sport of';
const IOI = 'When Mary and John went to the store, John gave a drink to';
const IOI_CHANGED = 'When Mary and John went to the store, Mary gave a drink to';
const NAME_MOVERS = [
  { layer: 9, head: 9 },
  { layer: 9, head: 6 },
  { layer: 10, head: 0 },
];
const NURSE = 'The doctor told the nurse she would';
const COMPARE_A = 'The doctor said that';
const COMPARE_B = 'The nurse said that';

// ---------------------------------------------------------------------------
// Labels for the tour card, the ? menu and Settings (kept here with the rest
// of the tour's words so one copy pass covers everything).
// ---------------------------------------------------------------------------

export const tourUi = {
  cardLabel: 'Guided tour',
  chapterOf: (n: number, total: number) => `Chapter ${n} of ${total}`,
  stepOf: (n: number, total: number) => `step ${n}/${total}`,
  chaptersButton: 'Chapters',
  why: 'Why?',
  lookAt: 'Look at:',
  notOnScreen: "It isn't on screen yet. It shows up once the step's set up.",
  back: 'Back',
  next: 'Next',
  done: 'Done',
  exit: 'Exit',
  tryAgain: 'Try again',
  skip: 'Skip',
  complete: "You finished the tour. The ? button brings it back whenever you want.",
  busy: { loading: 'Loading the model…', running: 'Running…', layer: 'Switching layers…', working: 'Working…' },
  modelOffer: (model: string) =>
    `The tour's written for GPT-2 small, and you've got ${model} loaded. The steps still work, but the numbers and examples won't match.`,
  modelOfferFailed: "Couldn't load GPT-2 small. Try again, or keep going on the current model.",
  modelLoading: 'Loading GPT-2 small…',
  switchModel: 'Switch to GPT-2 small',
  retry: 'Try again',
  continueAnyway: 'Keep going anyway',
  menuButton: 'Help and tour',
  menuStart: 'Start the tour from the beginning',
  menuContinue: 'Continue where you left off',
  menuChapters: 'Jump to a chapter',
  menuDone: 'done',
  settingsHeading: 'Tour and tips',
  settingsRestart: 'Restart the full tour',
  settingsRestartHelp: 'Forget your tour progress and start again from chapter 1.',
  settingsRestartButton: 'Restart',
  settingsTips: 'Reset first-time tips',
  settingsTipsHelp: 'Show the pop-up tips again the next time each panel opens.',
  settingsTipsButton: 'Reset',
  settingsAll: 'Reset everything',
  settingsAllHelp: 'Clear tour progress and tips, as if Pry just opened for the first time.',
  settingsAllButton: 'Reset all',
  settingsAllDone: "All cleared. The tour's going to start on its own next time Pry opens.",
};

/** What each highlighted target is called, shown on the card as "Look at: ...". */
export const targetLabels: Record<string, string> = {
  'header-help': 'the ? button, top right',
  'prompt-input': 'the Prompt box, top of the window',
  'run-button': 'the Run button, top of the window',
  'token-strip': 'the word chips above the panels',
  'predictions-panel': 'the Predictions tab, right side',
  'panel-a-lines': 'the Attention lines, left side',
  'glossary-term': 'a word with a dotted underline',
  'panel-a-heatmap': 'the attention grid, left side',
  'panel-a-agg-selector': 'the Agg menu, above the grid',
  'panel-a-from-selector': 'the FROM and TO buttons, above the grid',
  'copying-heads-view': 'the copying-heads view, left side',
  'watch-it-write': 'Watch it write, under the predictions',
  'logit-lens-heatmap': 'the Logit Lens chart, left side',
  'dla-waterfall': 'the Why (DLA) chart, left side',
  'circuit-graph': 'the Key parts map, left side',
  'ablation-head-toggle': 'the Ablation button, above the grid',
  'ablation-results': 'the before and after guesses, left side',
  'patching-panel': 'the Swap & Compare panel, left side',
  'panel-b-features-list': 'the feature list, right side',
  'feature-histogram': 'the little chart under a feature',
  'panel-b-layer-selector': 'the layer menu, top of the Features tab',
  'ablation-feature-toggle': 'the Ablation button in Features',
  'steering-panel': 'the Steering tab, right side',
  'concept-search': 'the Find a concept box, in Steering',
  'compare-panel': 'the Compare view',
  'experiments-button': 'the Experiments button, top right',
  'notebook-button': 'the bookmark and Notebook buttons, top right',
  'export-button': 'the download button (arrow pointing down), top right',
  'model-switcher': 'the model menu, top left',
  'engine-chip': 'the engine chip, next to the model menu',
};

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export const tourChapters: TourChapter[] = [
  {
    id: 'basics',
    title: 'The basics',
    summary: 'Type a prompt, run it, read the guesses, follow the lines.',
    steps: [
      {
        id: 'basics.welcome',
        target: 'header-help',
        blurb:
          "Welcome to Pry! It's a microscope for a language model. You type a sentence, the model guesses the next word, and Pry shows you what went on inside while it guessed.",
        why:
          "Inside, a language model is a big stack of layers full of numbers, and it learned to guess the next word by reading a mountain of text, and nobody wrote its rules by hand, so even the people who build these things have to study them the way a biologist studies a cell. That's interpretability: looking inside to see how the answer got made. Pry runs GPT-2 small, a little model researchers know really well, right on your computer. You can hop around with the Chapters button, and the ? button up here gets you back to the tour later.",
      },
      {
        id: 'basics.prompt',
        target: 'prompt-input',
        enter: (ctx) => ctx.setPrompt(CAT),
        blurb:
          'First, a prompt. I typed "The cat sat on the" into the box. You already know how that one ends, so let\'s see if the model does.',
        why:
          "The prompt is the text you give the model, and Pry asks one question about it: what word comes next? Starting with a sentence everybody can finish means you know the answer before the model does. If it agrees with you, you get to look inside and see how it got there. If it surprises you, that's even more fun.",
      },
      {
        id: 'basics.run',
        target: 'run-button',
        enter: (ctx) => ctx.setPrompt(CAT),
        run: runPrompt(CAT),
        blurb:
          "Next I'll press Run for you. The first Run has to load the model into memory, so it takes a moment. After that it's quick.",
        why:
          "Behind the window there's a small engine (a Python program) holding the model. Run sends it your prompt, and it sends back everything Pry shows you: the word pieces, where the model looked, which concepts lit up, and its guesses. The model doesn't learn anything from you, and nothing carries over from one Run to the next. Same prompt in, same numbers out.",
      },
      {
        id: 'basics.tokens',
        target: 'token-strip',
        blurb:
          "See the chips above the panels? Those are tokens, the word pieces the model reads. A dot means the piece starts with a space. Click a chip to focus on it.",
        why:
          "Models don't read letters or whole words. They read tokens, chunks from a fixed list of about 50,000. Common words get one token, and rare words get chopped into a few, kind of like building a model out of standard LEGO bricks. Every chart in Pry is laid out by token, and clicking a chip tells all the panels which word you're asking about. Pry calls that word the focus.",
      },
      {
        id: 'basics.predictions',
        target: 'predictions-panel',
        enter: (ctx) => ctx.openRightTab('predictions'),
        blurb:
          "Here are the model's top guesses for the next word, each with its chance. The sentence in the shaded box says the same thing in plain words, and most panels have one.",
        why:
          "The model doesn't pick one word. It scores every token it knows and turns the scores into chances that add up to 100%, and the bars show the top few. One long bar means it's sure. A few bars about the same length means it's torn. Pry calls the plain-words sentence a readout, and it's built from the same numbers, so you can get the gist without squinting at a chart.",
      },
      {
        id: 'basics.lines',
        target: 'panel-a-lines',
        enter: (ctx) => showAttention(ctx, 'lines'),
        blurb:
          "Over here is Attention, in the Lines view. Each word on the left draws lines to the earlier words it looked at. Darker line, harder look.",
        why:
          "Attention's how a word pulls in information from the words before it. Picture a student glancing back at their notes before writing the next word. A word can look at itself and anything earlier, but never ahead. The model has lots of these lookers running at once, called attention heads, and the Lines view shows you one. On Auto, Pry picks the head that looks hardest from the focused word, and the Layer and Head menus let you pick a different one.",
      },
      {
        id: 'basics.focus',
        target: 'panel-a-lines',
        enter: (ctx) => {
          showAttention(ctx, 'lines');
          focusWord(ctx, 'cat');
        },
        blurb:
          'I clicked "cat", so the highlighted lines now belong to that one word. Click some other words yourself, on either side, and watch the readout follow along.',
        why:
          "Picking a word turns a tangle of lines into one question: when the model was working on this word, where did it look? Click a word on the left to see where it looks. Click one on the right to see which later words look back at it. Arrow keys work too. Lots of heads dump a big chunk of attention on the very first token when they've got nothing better to do (a parking spot, basically), so don't read much into those lines.",
      },
      {
        id: 'basics.glossary',
        target: 'glossary-term',
        blurb:
          'Spot a word with a dotted underline? Hover over it, or Tab to it, and you get a one-line definition. Attention head, logit and feature all have one.',
        why:
          "Interpretability has a LOT of jargon, and jargon keeps people out. The dotted words are Pry's glossary, with short, plain definitions written for someone who's never seen the term. You'll also get little first-time tips the first time you open each panel. They stay quiet while the tour's running, so they don't talk over it.",
      },
    ],
  },
  {
    id: 'attention',
    title: 'Where it looks',
    summary: 'All 144 heads at once, four ways to score them, and the copying heads.',
    steps: [
      {
        id: 'attention.grid',
        target: 'panel-a-heatmap',
        enter: (ctx) => showAttention(ctx, 'expert'),
        blurb:
          "Now the Expert view, a grid with every attention head in it: 12 layers top to bottom, 12 heads across. Each square's one head.",
        why:
          "GPT-2 small has 12 layers with 12 heads each, so 144 little lookers. The Lines view shows you one of them, and the grid shows all of them, each scored for the word you focused. Brighter squares score higher. Click a square to open that head's whole pattern, a table of which word looked at which. Think of a wall of security monitors: you scan the whole wall, then zoom in on the screen where something's going on.",
      },
      {
        id: 'attention.agg',
        target: 'panel-a-agg-selector',
        enter: (ctx) => {
          showAttention(ctx, 'expert');
          ctx.setPanelAAggregation('previous');
        },
        blurb:
          "Same numbers, new question. I switched the Agg menu from Strongest look to Previous word, so the bright squares are now heads that mostly look one word back.",
        why:
          "Each square has to squish a whole pattern down to one number, and the Agg menu picks how. Strongest look scores how hard the head locked onto a single earlier word. Spread scores whether it stuck to one word or scattered across lots of them. Looks back is how far back it reached, and Previous word is how much went to the word just before. A handful of heads light up bright on Previous word, since keeping track of the last word is one of the simplest jobs researchers have caught these models doing.",
      },
      {
        id: 'attention.from-to',
        target: 'panel-a-from-selector',
        enter: (ctx) => showAttention(ctx, 'expert'),
        blurb:
          'FROM and TO flip the question around. FROM asks where this word looked. TO asks which later words looked back at it.',
        why:
          "Attention has two ends, the word doing the looking and the word getting looked at. FROM asks about the first one and TO asks about the second. TO also gets an option called Average received, which is how much attention this word got, on average, from the words after it. A word that gets lots of attention is one the model keeps checking back on, like the main character everybody in a story keeps talking about.",
      },
      {
        id: 'attention.copying',
        target: 'copying-heads-view',
        enter: (ctx) => {
          ctx.setHeadAblation(false);
          ctx.openLeftTab('attention');
          ctx.showCopyingHeads();
        },
        blurb:
          'Time for a famous experiment! Pry feeds the model some random word pieces, then repeats them, and rings the heads that copy "what came next last time".',
        why:
          "A model can't guess random words. The second time the same random words come around, though, it can, as long as it remembers what followed each one the first time. Copying heads (researchers call them induction heads) handle exactly that: spot a repeat, look at what came after it last time, copy it forward. They often team up with previous-word heads, which get their own ring. Researchers at Anthropic wrote them up in 2021 and 2022, and they're still one of the best-understood tricks these models have. Press \"Back to your prompt\" to leave this view.",
      },
    ],
  },
  {
    id: 'guesses',
    title: 'What it guesses',
    summary: 'Confidence, watching it write, and the layer where the answer shows up.',
    steps: [
      {
        id: 'guesses.run',
        target: 'run-button',
        enter: (ctx) => ctx.setPrompt(JORDAN),
        run: runPrompt(JORDAN),
        blurb:
          'New prompt: "Michael Jordan played the sport of". To get this one right, the model needs a fact it picked up from its training text. Running it now.',
        why:
          "The cat sentence mostly takes habit and grammar. This one takes knowledge, since to say basketball the model has to have stored something about Michael Jordan. Fact recall makes a good test case because it raises a big question: where, in all those numbers, does a fact live? The next few steps give you two ways to watch the answer form.",
      },
      {
        id: 'guesses.predictions',
        target: 'predictions-panel',
        enter: (ctx) => ctx.openRightTab('predictions'),
        blurb:
          'Did basketball make the top spot? The readout gives you its chance in plain words, and a "confident" tag shows up when the top guess has better than even odds.',
        why:
          "A probability is the model's confidence, and confidence isn't a fact check (a model can be 90% sure and still wrong). The confident tag appears when the top guess is over 50%. The uncertain tag appears when the top three guesses are within a few points of each other. Keep an eye out for surprises, since a model that's confidently wrong about a fact is exactly what interpretability wants to catch and explain.",
      },
      {
        id: 'guesses.write',
        target: 'watch-it-write',
        enter: (ctx) => ctx.openRightTab('predictions'),
        blurb:
          'Down here is Watch it write. Press Write it and the model keeps going one word at a time, showing the word it picked and the runner-up at each step.',
        why:
          "A model writes by guessing a word, sticking it on the end, and guessing again, like laying track in front of a moving train. Temperature's how adventurous it gets. At 0 it always takes the top guess. Turn it up and it rolls weighted dice, so less likely words get a shot. Above 0 there's a checkbox to reuse the same random draws, so you can change one setting and compare fairly.",
      },
      {
        id: 'guesses.lens',
        target: 'logit-lens-heatmap',
        enter: (ctx) => ctx.openLeftTab('logit-lens'),
        blurb:
          "Over on the left, the Logit Lens. Each row is a layer, and it shows what the model would guess if you stopped it there. Look for the row where basketball shows up.",
        why:
          "The model builds its answer bit by bit as the text moves up through the layers. The logit lens grabs the half-built answer at each layer and asks: if you had to answer right now, what would you say? Early layers usually guess something generic. Somewhere along the way the right answer shows up and gets stronger, and the readout tells you which layer it first takes the lead in. It's an approximation, since the middle layers weren't built to be read this way.",
      },
    ],
  },
  {
    id: 'responsible',
    title: "Who's responsible",
    summary: 'Credit and blame for each part, and a map of the key parts.',
    steps: [
      {
        id: 'responsible.run',
        target: 'run-button',
        enter: (ctx) => ctx.setPrompt(IOI),
        run: runPrompt(IOI),
        blurb:
          'Next up: "When Mary and John went to the store, John gave a drink to". You know it\'s Mary. Let\'s find the parts of the model that know it too.',
        why:
          "This one's a classic in interpretability. To say Mary, the model has to notice the two names, notice that John showed up twice, and pick the other one. Researchers traced how GPT-2 small does it and found a whole team of heads working together. It makes a great test, because the answer depends on this exact sentence and not on some phrase the model memorized.",
      },
      {
        id: 'responsible.dla',
        target: 'dla-waterfall',
        enter: (ctx) => ctx.openLeftTab('dla'),
        blurb:
          'Why (DLA) hands out credit and blame. Blue bars pushed toward the predicted word and orange bars pushed against it. Bigger bar, bigger push.',
        why:
          "Direct Logit Attribution splits the word's final score (its logit) into pieces, one for each head and one for each layer's MLP (the model's other kind of part, which works on each word by itself). A +2 means that part raised the word's score by 2 logits. One catch: it only counts direct effects, meaning each part's own push on the answer. A part that helps by nudging other parts gets no credit here, so treat the chart as a list of suspects and not a verdict.",
      },
      {
        id: 'responsible.parts',
        target: 'circuit-graph',
        enter: (ctx) => ctx.openLeftTab('circuit'),
        blurb:
          'Key parts maps out the biggest pushers, highest layer on top. The lines between them show one kind of link, which Pry calls the direct value path.',
        why:
          "Each line measures one specific thing: how much an earlier part's output, once a later head reads it, pushes the predicted word up. That's the direct value path. Other ways parts affect each other (like changing where a head looks) don't get drawn, so a missing line doesn't prove two parts aren't connected. Change the Threshold to show more or fewer parts, and pick a part to list its connections.",
      },
    ],
  },
  {
    id: 'poke',
    title: 'Poke it',
    summary: 'Knock out heads, then swap pieces between two prompts.',
    steps: [
      {
        id: 'poke.knockout',
        target: 'ablation-head-toggle',
        enter: (ctx) => {
          ctx.hideCopyingHeads();
          ctx.openLeftTab('attention');
          ctx.setHeadAblation(true, NAME_MOVERS);
        },
        run: {
          label: 'Knock them out',
          act: (ctx) => ctx.runHeadAblation(),
          result: (ctx) => ctx.headAblationResult(),
        },
        blurb:
          "Looking only gets you suspects, so let's poke something! I picked three heads researchers call name movers: 9.9, 9.6 and 10.0. Next switches them off and runs again.",
        why:
          "Switching a part off to see what breaks is called ablation, and it's about the oldest trick in science. Pry knocks a head out by setting its output to zero. If the answer falls apart, that head mattered. If the answer holds, either the head didn't matter for this sentence or other parts covered for it. While Ablation is on you can click any square in the grid to add or drop a head, then press Run Ablated.",
      },
      {
        id: 'poke.knockout-result',
        target: 'ablation-results',
        enter: (ctx) => {
          ctx.hideCopyingHeads();
          ctx.openLeftTab('attention');
          ctx.setHeadAblation(true);
        },
        blurb:
          'Compare the normal top five with the knocked-out top five. Did Mary lose ground? Big networks have spare parts, so a small drop still counts as a result.',
        why:
          "In the original study, when the name movers got switched off, other heads partly took over (the researchers called them backup name movers). Worth remembering: a model can route around damage, so one knockout can make a part look less important than it is. While it's on, the button reads \"Ablation ON\", so press it again when you're done. Until then, the Attention panel sticks to the grid, since that's where you pick heads.",
      },
      {
        id: 'poke.swap',
        target: 'patching-panel',
        enter: (ctx) => {
          ctx.setHeadAblation(false);
          ctx.openLeftTab('patching');
        },
        run: {
          label: 'Run the swap',
          act: (ctx) => ctx.runPatching(IOI, IOI_CHANGED, 'resid'),
          result: (ctx) => ctx.patchingResult(),
        },
        blurb:
          'Swap & Compare takes two prompts one word apart, "John gave a drink to" and "Mary gave a drink to", and swaps pieces from one run into the other.',
        why:
          "Researchers call this activation patching. Pry runs the original prompt and the changed one, then reruns the changed one while pasting in a single piece of the model's inner state from the original run. If that one swap brings the original answer back, the piece was carrying the information that decides it. Both prompts need the same number of tokens so the pieces line up, and Pry counts them for you. Heads, MLPs and Residual pick which pieces get swapped.",
      },
      {
        id: 'poke.swap-result',
        target: 'patching-panel',
        enter: (ctx) => ctx.openLeftTab('patching'),
        blurb:
          "Check out the Residual view, a grid of layers by words. Each square swaps one layer at one word, and the strong squares show where the name that matters is sitting, and when.",
        why:
          "The residual stream is the model's running notes, a scratchpad every layer reads from and writes to. Swapping it at one word and one layer asks whether the deciding information is sitting in that exact spot. Often it's on the repeated name in the early layers, then it turns up at the last word in later layers, where the answer gets written. You're watching information move through the sentence. Try Heads next to see which single heads matter most.",
      },
    ],
  },
  {
    id: 'concepts',
    title: 'Concepts inside',
    summary: 'Features, their labels and history, layers, and steering.',
    steps: [
      {
        id: 'concepts.run',
        target: 'run-button',
        enter: (ctx) => ctx.setPrompt(NURSE),
        run: runPrompt(NURSE),
        blurb:
          'New prompt: "The doctor told the nurse she would". Who\'s "she"? Most people decide without noticing they did. Let\'s see what the model decides, and how.',
        why:
          "Attention shows where the model looks, and features show what it's thinking about. Pry uses a sparse autoencoder (SAE), a tool that splits the model's inner state at a word into thousands of possible concepts, where only a few are switched on at once. Lots of them match ideas a person can put a name to, and sometimes that includes stereotypes the model soaked up from its training text.",
      },
      {
        id: 'concepts.features',
        target: 'panel-b-features-list',
        enter: (ctx) => {
          ctx.openRightTab('features');
          focusWord(ctx, 'she');
        },
        blurb:
          'Here are the features that fired on "she", strongest first, each with a label, a strength bar and a Neuronpedia link. See anything about nurses, women or caregiving?',
        why:
          "A feature is a direction in the model's inner state that tends to mean one thing, and act is how strongly it's on for this word. The labels are auto-generated: another AI read the text each feature fires hardest on and wrote a short description, which Neuronpedia (a public site) publishes. Labels can be vague or flat wrong, so take them as hints. If a gender or job feature fires hard on she here, you're looking at the bias inside the model, not guessing at it from outputs.",
      },
      {
        id: 'concepts.history',
        target: 'feature-histogram',
        enter: (ctx) => ctx.openRightTab('features'),
        blurb:
          "Under each feature there's a tiny chart across your words, showing how hard it fired on each one. A hatched bar means it wasn't in that word's top five.",
        why:
          "One word gives you a snapshot, and the little chart gives you the whole movie. Some features fire on a single word, and others hum along across a whole phrase, like a theme. Comparing them tells you whether a concept belongs to one word or to the sentence. A hatched bar doesn't mean zero. It means the feature didn't make that word's top five, so Pry didn't keep its exact strength.",
      },
      {
        id: 'concepts.layer',
        target: 'panel-b-layer-selector',
        enter: (ctx) => ctx.openRightTab('features'),
        run: {
          label: 'Switch to layer 2',
          skipIf: (ctx) => ctx.currentSaeLayer() === 2,
          act: (ctx) => ctx.switchSaeLayer(2),
          result: (ctx) => ctx.response(),
        },
        blurb:
          'Features live at every depth, and GPT-2 small starts you at layer 8. Next switches to layer 2, near the bottom, so you can see the features change for the same word.',
        why:
          "Early layers tend to pick up surface stuff like spelling, word shape and grammar. Later layers pick up meaning: roles, topics, who's who. Kind of like reading a page for the letters first, then the sentences, then the story. Each layer has its own feature dictionary, so switching loads a new one and reruns your prompt, which takes a few seconds. So when you ask what fired, it's worth asking at what depth, too.",
      },
      {
        id: 'concepts.knockout',
        target: 'ablation-feature-toggle',
        enter: (ctx) => ctx.openRightTab('features'),
        blurb:
          'You can knock out features too. Turn on Ablation here, tick the features to switch off, and press Run Ablated. If the guesses shift, those features mattered.',
        why:
          "A feature firing shows it's there. Switching it off tests whether it matters. If removing a caregiving feature changes what the model guesses after she, that's evidence the feature takes part in the decision instead of just tagging along. If nothing changes, it was along for the ride, or other features covered for it. Same logic as knocking out heads, one level up.",
      },
      {
        id: 'concepts.steer',
        target: 'steering-panel',
        enter: (ctx) => ctx.openRightTab('steering'),
        blurb:
          'Steering is a volume knob for a concept. Pick a feature, drag the strength, press Run Steered, and compare the original and steered text side by side.',
        why:
          "Knockouts switch things off. Steering pushes a feature harder, or pushes it negative. If cranking up a feature labeled formal language makes the writing more formal, that's causal evidence the label's right, and if nothing changes, the label might be off. Pry shows only the words the model added and highlights the ones that changed. Push too hard and the text turns to mush (which is its own kind of lesson).",
      },
      {
        id: 'concepts.find',
        target: 'concept-search',
        enter: (ctx) => ctx.openRightTab('steering'),
        blurb:
          'Want a concept that isn\'t in your prompt? Type it into Find a concept, like "the ocean", and Pry searches Neuronpedia for matching features to steer with.',
        why:
          "Search ranks feature labels by how close their words are to yours, so there's always a top result, even when nothing really fits. Another AI wrote the labels, so check a match makes sense before you trust it. Privacy note: searching sends the words you type, plus which model and layer you're on, to Neuronpedia, a public website. That's all it sends. The tour won't search for you, so it's your call.",
      },
    ],
  },
  {
    id: 'compare',
    title: 'Compare two prompts',
    summary: 'Change one word and see what moves inside.',
    steps: [
      {
        id: 'compare.run',
        target: 'compare-panel',
        compare: true,
        enter: (ctx) => ctx.setComparePrompts(COMPARE_A, COMPARE_B),
        run: {
          label: 'Compare them',
          skipIf: (ctx) => {
            const r = ctx.compareResult() as { a?: { prompt?: string }; b?: { prompt?: string } } | null;
            return r?.a?.prompt === COMPARE_A && r?.b?.prompt === COMPARE_B;
          },
          act: (ctx) => ctx.runCompare(),
          result: (ctx) => (ctx.compareResult() as { a?: unknown } | null)?.a ?? null,
        },
        blurb:
          'Compare mode runs two prompts side by side: "The doctor said that" and "The nurse said that". One word different. What changes inside?',
        why:
          "Scientists love a controlled experiment: change one thing, keep everything else the same, and study the difference. Compare mode does that for prompts. It shows which next words gained or lost chance, which features show up for only one prompt, and how differently each attention head looks from the word you pick.",
      },
      {
        id: 'compare.read',
        target: 'compare-panel',
        compare: true,
        blurb:
          'Check the next-word changes. Did "he" or "she" move? Keep in mind a difference shows what changed along with the word. It doesn\'t prove what caused what.',
        why:
          "Compare shows correlation, and correlation isn't causation. If a feature only shows up for nurse, it travels with that word in these two prompts, and that's all you know so far. To test whether it causes a different guess, grab the poking tools: knock it out, steer it, or swap it with Swap & Compare. The Compare button in the header takes you back to the single-prompt view.",
      },
    ],
  },
  {
    id: 'lab',
    title: 'Your lab',
    summary: 'Guided experiments, the lab notebook, and exporting results.',
    steps: [
      {
        id: 'lab.experiments',
        target: 'experiments-button',
        blurb:
          'Experiments opens eight guided experiments, like "Who gets the drink?" and "Can it count years?". Each one sets everything up and tells you what to look for.',
        why:
          "Each experiment is a recipe from real research, shrunk down to run on your computer. Pick one and Pry loads the prompt, opens the right tabs, and gives you a short guide: what to look for, then what the researchers found, with links to their papers. They make a great next stop after the tour, because each one takes a tool you just met and points it at an actual question.",
      },
      {
        id: 'lab.notebook',
        target: 'notebook-button',
        blurb:
          "Found something cool? The bookmark button saves this run to your lab notebook with a note, and Notebook opens everything you've saved.",
        why:
          "Scientists write stuff down. The notebook keeps each saved run with its prompt, its results and your notes, all on your computer. You can drop a saved prompt back in the box to run it again, or save one entry (or the whole notebook) as a single web page. That page works offline and doesn't load anything from the internet, so it's easy to share.",
      },
      {
        id: 'lab.export',
        target: 'export-button',
        blurb:
          "The download button saves this run's raw numbers as a JSON file, through a normal Save dialog. Handy if you want to dig in with your own code.",
        why:
          "Everything Pry draws comes from numbers, and you can have them. The export holds the run plus any extra analysis you did on it: Logit Lens, Why (DLA), knockouts, steering, Swap & Compare and Key parts. JSON is a plain text format that pretty much every programming language can read, so it's an easy way to get your results into your own notebooks and scripts.",
      },
    ],
  },
  {
    id: 'models',
    title: 'Models and engine',
    summary: 'Switch models, add your own, and check on the engine.',
    steps: [
      {
        id: 'models.switcher',
        target: 'model-switcher',
        blurb:
          "This menu switches models, and each one gets a badge for how well it fits your computer. Gemma 2 2B needs a graphics card. The tour sticks with GPT-2 small.",
        why:
          "Different models, different specimens. Pythia-70M is tiny, GPT-2 small is the classic, and Gemma 2 2B is way bigger and needs a graphics card plus a free Hugging Face account (Pry walks you through that part). Under the full model list there's a button to add a model from Hugging Face by name, and Pry checks whether it can run it and estimates its size first. Models you add don't come with a feature dictionary, so Features and Steering won't work for them.",
      },
      {
        id: 'models.engine',
        target: 'engine-chip',
        blurb:
          "This chip shows the engine: whether it's running on your graphics card (GPU) or main processor (CPU), and which model's loaded. Click it for details and a Restart button.",
        why:
          "The engine's the Python program doing all the math. A GPU does it way faster, but Pry works on the CPU too, just slower. If the engine ever stops, a banner tells you within a few seconds, and Restart brings it back and reloads your model. If something feels stuck, check the chip first.",
      },
      {
        id: 'models.done',
        target: 'header-help',
        blurb:
          "You made it through the tour! The ? button gets you back anytime, to start over, pick up where you left off, or jump to a chapter. Settings can restart it too.",
        why:
          "Pretty much every tool here follows the scientific method: look at something, guess what it means, then poke it to test the guess. In Pry, you look with attention and features, and you poke with knockouts, steering and swaps. Try your own prompts, and try saying the same idea a different way to see if the same parts light up. If a pattern holds up through that, you've probably found something real.",
      },
    ],
  },
];
