// Advanced tutorial steps -- opt-in tour of Phase B/C/D features.
import type { TutorialActions } from './actions';
import type { DrivenStep } from './driven-steps';

export const advancedDrivenSteps: DrivenStep[] = [
  {
    id: 'adv.1',
    blurb:
      "Click the Predictions tab on the right panel. This is the model's ranked list of guesses for the next word, sorted by confidence.",
    why:
      "This tab shows you where the model landed. The attention and features tabs explain *how* it got there. Predictions shows you *what it actually decided*. Having both visible at the same time is the whole point of the split layout.",
    target: null,
    action: (ctx) => {
      ctx.setRightTab?.('predictions');
    },
  },
  {
    id: 'adv.2',
    blurb:
      "Click the Logit Lens tab on the left. This heatmap shows what the model would guess at each layer, like watching it change its mind from top to bottom.",
    why:
      "The model doesn't decide its answer all at once. It builds it layer by layer, and some layers matter more than others. The logit lens freezes the model's state at each layer and asks 'what would you say right now?' A bright cell means that layer's guess matches the final answer. The pattern of when the correct answer first appears, and whether it ever wavers, tells you where the real work is happening inside the model.",
    target: null,
    action: (ctx) => {
      ctx.setLeftTab?.('logit-lens');
    },
  },
  {
    id: 'adv.3',
    blurb:
      "Click the DLA tab on the left. This chart shows which specific parts of the model pushed toward or against the predicted word. Blue bars helped, red bars fought it.",
    why:
      "If the model predicts 'mat,' this chart shows which of its 144 heads and 12 processing layers most wanted that answer. The tallest blue bar is the part that pushed hardest for 'mat.' The tallest red bar wanted something else. Once you know which parts are responsible, you can start asking how they connect to each other.",
    target: null,
    action: (ctx) => {
      ctx.setLeftTab?.('dla');
    },
  },
  {
    id: 'adv.4',
    blurb:
      "Click the Steering tab on the right. Pick a feature from the list, drag the slider to turn it up or down, and hit Run. You're changing how the model thinks. Compare the original and steered outputs side by side.",
    why:
      "This is where interpretability becomes a verb instead of a noun. Everything else in Pry is observation. Steering is intervention. If turning up a 'formal language' feature makes the model write more formally, that's causal evidence the feature does what it says. If it doesn't change anything, the label was misleading. Steering is also how alignment researchers test whether safety-relevant features actually control behavior or just correlate with it.",
    target: null,
    action: (ctx) => {
      ctx.setRightTab?.('steering');
    },
  },
  {
    id: 'adv.5',
    blurb:
      "Back on the Attention and Features tabs, look for the ablation toggle. It lets you mark individual heads or features for removal, then re-run the model without them. If the prediction shifts, that piece was doing real work.",
    why:
      "This is the flip side of steering. Instead of amplifying something, you remove it entirely. It answers a different question: not 'what does this part do' but 'does the model actually need it?' A lot of attention heads turn out to be redundant for any given input. The ones that aren't are the core circuit, and finding them is the first step toward understanding how the model actually works.",
    target: null,
    action: () => {
      /* no-op */
    },
  },
  {
    id: 'adv.6',
    blurb:
      "That's the advanced tour. Every tool in Pry follows the same pattern: look at something, understand what it means, then poke it to see if your understanding is right. The ? icon is always there if you want to run either tour again.",
    why: null,
    target: null,
    action: (ctx) => {
      ctx.exit();
    },
  },
];
