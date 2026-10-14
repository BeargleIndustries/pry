// Pry anchors (plan T2, N11): every name a lesson can point at or hide.
// T2a ships the names, labels, argument schemas and which anchors are
// hideable; `locate` and `hide` are stubs until T2b fills them in place.
// Anchors stay `data-tour` / `data-tip` in the markup. The labels and large
// flags of the anchors the 0.3.8 tour already uses come from tutorial/tour-steps.ts
// until T2b takes them over (with the focus fractions and `reveal`).

import { z } from 'zod';
import { notImplemented, type AnchorDef } from './contract';
import { LARGE_TARGETS, targetLabels } from '../../tutorial/tour-steps';

const locate = notImplemented as AnchorDef['locate'];
const hide = notImplemented as NonNullable<AnchorDef['hide']>;

/** Regions a predict step can hide until the learner commits (TN-2 / N2). */
export const HIDEABLE_ANCHORS = [
  'predictions-panel',
  'patching-grid',
  'feature-labels',
  'embedding-values',
  'steering-coherence',
] as const;

const tourAnchors: Record<string, AnchorDef> = Object.fromEntries(
  Object.entries(targetLabels).map(([name, label]) => [
    name,
    {
      doc: label,
      label,
      locate,
      ...(LARGE_TARGETS.includes(name) ? { large: true } : {}),
    } satisfies AnchorDef,
  ]),
);

const added: Record<string, Omit<AnchorDef, 'locate'>> = {
  'left-tab-strip': { doc: 'The tab row above the left panel.', label: 'the tabs above the left panel' },
  'right-tab-strip': { doc: 'The tab row above the right panel.', label: 'the tabs above the right panel' },
  'compare-button': { doc: 'The Compare button in the header.', label: 'the Compare button, top right' },
  'lessons-toggle': { doc: 'The button that opens and closes Lessons.', label: 'the Lessons button' },
  'settings-button': { doc: 'The gear button that opens Settings.', label: 'the gear button, top right' },
  'compare-prompt-b': { doc: 'The second prompt box in Compare mode.', label: 'the second prompt box in Compare' },
  'tab-key-parts': { doc: 'The Key parts tab.', label: 'the Key parts tab, left side' },
  'steering-feature-menu': { doc: 'The feature menu in the Steering tab.', label: 'the feature menu, in Steering' },
  'steering-strength': { doc: 'The Steering strength control.', label: 'Steering strength, in Steering' },
  'embedding-view': { doc: 'The mounted embedding-compare view, inside the sidebar.', label: 'the embedding reader, in the lesson' },
  'patch-three-logits': { doc: 'The clean, corrupted and patched logits with the share formula.', label: 'the three logits, in the Swap test panel' },
  'dla-total-line': { doc: 'The DLA line with the bars\' total, the real logit and the gap.', label: 'the total line, in Why (DLA)' },
  'write-it-step': { doc: 'The control that writes one more token in Watch it write.', label: 'the step control, in Watch it write' },
  'write-it-temperature': { doc: 'The temperature setting in Watch it write.', label: 'the temperature setting, in Watch it write' },
  'write-it-seed': { doc: 'The seed setting in Watch it write.', label: 'the seed setting, in Watch it write' },
  'prediction-bar': {
    doc: 'One bar in Predictions, picked by its token.',
    label: 'a bar in the Predictions tab',
    args: z.object({ token: z.string() }).strict(),
  },
  'everything-else-row': { doc: 'The Predictions row for every token outside the top list.', label: 'the everything-else row, in Predictions' },
  'token-chip': {
    doc: 'One token chip, picked by its text and which occurrence.',
    label: 'a token chip above the panels',
    args: z
      .object({ text: z.string(), occurrence: z.union([z.literal('first'), z.literal('last'), z.number().int().min(1)]).optional() })
      .strict(),
  },
  'feature-row': {
    doc: 'One row in the feature list, picked by feature id.',
    label: 'a feature in the feature list, right side',
    args: z.object({ id: z.number().int().min(0) }).strict(),
  },
  'dla-bar': {
    doc: 'One bar in the DLA chart, picked by its part.',
    label: 'a bar in the Why (DLA) chart',
    args: z.object({ part: z.string() }).strict(),
  },
  'patching-grid': { doc: 'The Swap test grid.', label: 'the Swap test grid, left side' },
  'feature-labels': {
    doc: 'Every place a feature label shows: the Features list, feature cards, the steering menu and the histogram tooltip.',
    label: 'the feature labels',
  },
  'embedding-values': { doc: 'The numbers in the embedding reader.', label: 'the numbers in the embedding reader' },
  'steering-coherence': { doc: 'The coherence line in Steering.', label: 'the coherence line, in Steering' },
};

export const pryAnchors: Record<string, AnchorDef> = { ...tourAnchors };
for (const [name, def] of Object.entries(added)) pryAnchors[name] = { ...def, locate };
for (const name of HIDEABLE_ANCHORS) pryAnchors[name] = { ...pryAnchors[name], hide };
