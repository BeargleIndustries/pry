// Pry anchors (plan T2, N11): every name a lesson can point at or hide, each
// with `label`, `locate`, and where it applies `reveal`, `hide`, `large` and
// `focus`. Anchors stay `data-tour` / `data-tip` in the markup; anchors with
// arguments match a second attribute on the element (data-token,
// data-token-index, data-feature-id, data-part).
//
// T2b took over the 0.3.8 tour's anchor data (its step file's targetLabels,
// LARGE_TARGETS and the focus fractions its steps used), copied here so the
// tour file could go (T7b removed it).

import { z } from 'zod';
import type { AnchorDef } from './contract';
import { anchorSelector, findAnchor } from '../../tutorial/anchors';
import { hasPryHost, pryHost, pryUi } from './pry-state.svelte';

/** Regions a predict step can hide until the learner commits (TN-2 / N2). */
export const HIDEABLE_ANCHORS = [
  'predictions-panel',
  'patching-grid',
  'feature-labels',
  'embedding-values',
  'steering-coherence',
] as const;

/** What each 0.3.8 tour target is called (was the tour's targetLabels). */
const TOUR_LABELS: Record<string, string> = {
  'header-help': 'the ? button, top right',
  'prompt-input': 'the Prompt box, top of the window',
  'run-button': 'the Run button, top of the window',
  'token-strip': 'the word chips above the panels',
  'predictions-panel': 'the Predictions tab, right side',
  'panel-a-lines': 'the Attention lines, left side',
  'glossary-term': 'a word with a dotted underline',
  'panel-a-heatmap': 'Expert view (the grid), left side',
  'panel-a-agg-selector': 'the Score by menu, above the grid',
  'panel-a-from-selector': 'the FROM and TO buttons, above the grid',
  'copying-heads-view': 'the copying-heads view, left side',
  'watch-it-write': 'Watch it write, under the predictions',
  'logit-lens-heatmap': 'the Logit Lens chart, left side',
  'dla-waterfall': 'the Why (DLA) chart, left side',
  'circuit-graph': 'the Key parts map, left side',
  'ablation-head-toggle': 'the Ablation button, above the grid',
  'ablation-results': 'the before and after guesses, left side',
  'patching-panel': 'the Swap test panel, left side',
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

/** Too big for a card to sit beside; a pointer aims at `focus` inside them (was LARGE_TARGETS). */
const LARGE: readonly string[] = [
  'predictions-panel',
  'patching-panel',
  'compare-panel',
  'steering-panel',
  'panel-a-lines',
  'panel-a-heatmap',
  'logit-lens-heatmap',
  'dla-waterfall',
  'circuit-graph',
  'copying-heads-view',
  'watch-it-write',
  'panel-b-features-list',
  'ablation-results',
];

/** Where in the target the pointer aims, as fractions of its rect (the tour steps' values). */
const FOCUS: Record<string, [number, number]> = {
  'token-strip': [0.2, 0.5],
  'predictions-panel': [0.5, 0.2],
  'panel-a-lines': [0.3, 0.3],
  'panel-a-heatmap': [0.5, 0.4],
  'copying-heads-view': [0.5, 0.3],
  'watch-it-write': [0.5, 0.3],
  'logit-lens-heatmap': [0.5, 0.5],
  'dla-waterfall': [0.5, 0.3],
  'circuit-graph': [0.5, 0.4],
  'ablation-results': [0.5, 0.3],
  'patching-panel': [0.5, 0.2],
  'panel-b-features-list': [0.5, 0.2],
  'steering-panel': [0.5, 0.2],
  'compare-panel': [0.5, 0.25],
};

/** The tab that shows an anchor, so a hidden anchor can be opened ("Open it"). */
const PANEL_OF: Record<string, string> = {
  'predictions-panel': 'predictions',
  'prediction-bar': 'predictions',
  'everything-else-row': 'predictions',
  'watch-it-write': 'watch-it-write',
  'write-it-step': 'watch-it-write',
  'write-it-temperature': 'watch-it-write',
  'write-it-seed': 'watch-it-write',
  'panel-a-lines': 'attention',
  'panel-a-heatmap': 'attention',
  'head-cell': 'attention',
  'panel-a-agg-selector': 'attention',
  'panel-a-from-selector': 'attention',
  'copying-heads-view': 'attention',
  'ablation-head-toggle': 'attention',
  'ablation-results': 'attention',
  'logit-lens-heatmap': 'logit-lens',
  'dla-waterfall': 'dla',
  'dla-bar': 'dla',
  'dla-total-line': 'dla',
  'circuit-graph': 'circuit',
  'patching-panel': 'patching',
  'patching-grid': 'patching',
  'patch-three-logits': 'patching',
  'panel-b-features-list': 'features',
  'panel-b-layer-selector': 'features',
  'ablation-feature-toggle': 'features',
  'feature-histogram': 'features',
  'feature-row': 'features',
  'steering-panel': 'steering',
  'concept-search': 'steering',
  'steering-feature-menu': 'steering',
  'steering-strength': 'steering',
  'steering-coherence': 'steering',
};

// Anchors whose element doesn't exist yet locate to null until it does
// (`dla-total-line` on an engine without the total, `steering-coherence`
// under 5 tokens).
// The Lessons button carries `data-tour="lessons-toggle"` (+page.svelte); the
// sidebar draws `highlight` from pryUi.highlight (T3).

/** First on-screen element marked `name` whose `attr` equals `value`. */
function findWith(name: string, attr: string, value: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  for (const el of document.querySelectorAll<HTMLElement>(anchorSelector(name))) {
    if (el.getAttribute(attr) === value && el.getClientRects().length > 0) return el;
  }
  return null;
}

const byName = (name: string) => () => (typeof document === 'undefined' ? null : findAnchor(name));

const occurrence = z.union([z.literal('first'), z.literal('last'), z.number().int().min(1)]);

/** Index of the token chip for {text, occurrence} in the current run. */
function chipIndex(args: { text: string; occurrence?: 'first' | 'last' | number }): number | undefined {
  if (!hasPryHost()) return undefined;
  const tokens = pryHost().analysis.state.response?.tokens ?? [];
  const hits = tokens.filter((t) => t.text === args.text);
  const occ = args.occurrence ?? 'first';
  const t = occ === 'first' ? hits[0] : occ === 'last' ? hits[hits.length - 1] : hits[occ - 1];
  return t?.index;
}

function setHidden(name: string) {
  return (on: boolean) => {
    pryUi.hidden = { ...pryUi.hidden, [name]: on };
  };
}

const added: Record<string, Omit<AnchorDef, 'locate'> & { locate?: AnchorDef['locate'] }> = {
  'left-tab-strip': { doc: 'The tab row above the left panel.', label: 'the tabs above the left panel' },
  'right-tab-strip': { doc: 'The tab row above the right panel.', label: 'the tabs above the right panel' },
  'tab-features': {
    doc: 'The Features tab in the one-panel layout, next to Attention.',
    label: 'the Features tab, above the panel',
  },
  'compare-button': { doc: 'The Compare button in the header.', label: 'the Compare button, top right' },
  'lessons-toggle': { doc: 'The button that opens and closes Lessons.', label: 'the Lessons button' },
  'settings-button': { doc: 'The gear button that opens Settings.', label: 'the gear button, top right' },
  'compare-prompt-b': { doc: 'The second prompt box in Compare mode.', label: 'the second prompt box in Compare' },
  'tab-key-parts': { doc: 'The Key parts tab.', label: 'the Key parts tab, left side' },
  'steering-feature-menu': { doc: 'The feature menu in the Steering tab.', label: 'the feature menu, in Steering' },
  'steering-strength': { doc: 'The Steering strength control.', label: 'Steering strength, in Steering' },
  'embedding-view': { doc: 'The mounted embedding-compare view, inside the sidebar.', label: 'the embedding reader, in the lesson', view: 'embedding-compare' },
  'patch-three-logits': { doc: 'The clean, corrupted and patched logits with the share formula.', label: 'the three logits, in the Swap test panel' },
  'dla-total-line': { doc: 'The DLA line with the bars\' total, the real logit and the gap.', label: 'the total line, in Why (DLA)' },
  'write-it-step': { doc: 'The control that writes one more token in Watch it write.', label: 'the step control, in Watch it write' },
  'write-it-temperature': { doc: 'The temperature setting in Watch it write.', label: 'the temperature setting, in Watch it write' },
  'write-it-seed': { doc: 'The seed setting in Watch it write.', label: 'the seed setting, in Watch it write' },
  'prediction-bar': {
    doc: 'One bar in Predictions, picked by its token.',
    label: 'a bar in the Predictions tab',
    args: z.object({ token: z.string() }).strict(),
    locate: (a: { token: string }) => findWith('prediction-bar', 'data-token', a.token),
  },
  'everything-else-row': { doc: 'The Predictions row for every token outside the top list.', label: 'the everything-else row, in Predictions' },
  'token-chip': {
    doc: 'One token chip, picked by its text and which occurrence.',
    label: 'a token chip above the panels',
    args: z.object({ text: z.string(), occurrence: occurrence.optional() }).strict(),
    locate: (a: { text: string; occurrence?: 'first' | 'last' | number }) => {
      const i = chipIndex(a);
      return i === undefined ? null : findWith('token-chip', 'data-token-index', String(i));
    },
  },
  'feature-row': {
    doc: 'One row in the feature list, picked by feature id.',
    label: 'a feature in the feature list, right side',
    args: z.object({ id: z.number().int().min(0) }).strict(),
    locate: (a: { id: number }) => findWith('feature-row', 'data-feature-id', String(a.id)),
  },
  'dla-bar': {
    doc: 'One bar in the DLA chart, picked by its part.',
    label: 'a bar in the Why (DLA) chart',
    args: z.object({ part: z.string() }).strict(),
    locate: (a: { part: string }) => findWith('dla-bar', 'data-part', a.part),
  },
  // Added by the T1 gate after T2b closed (critic M8, P3.2:51 "cells L9H9, L9H6, L10H0").
  // PanelA.svelte marks each grid cell `data-tour="head-cell" data-head="L9H9"` (T3).
  'head-cell': {
    doc: 'One cell in the attention head grid, picked by layer and head.',
    label: 'a head in the attention grid, left side',
    args: z.object({ layer: z.number().int().min(0), head: z.number().int().min(0) }).strict(),
    locate: (a: { layer: number; head: number }) => findWith('head-cell', 'data-head', `L${a.layer}H${a.head}`),
  },
  'patching-grid': { doc: 'The Swap test grid.', label: 'the Swap test grid, left side' },
  'feature-labels': {
    doc: 'Every place a feature label shows: the Features list, feature cards, the steering menu and the histogram tooltip.',
    label: 'the feature labels',
  },
  'embedding-values': { doc: 'The numbers in the embedding reader.', label: 'the numbers in the embedding reader' },
  'steering-coherence': { doc: 'The coherence line in Steering.', label: 'the coherence line, in Steering' },
};

function build(): Record<string, AnchorDef> {
  const out: Record<string, AnchorDef> = {};
  for (const [name, label] of Object.entries(TOUR_LABELS)) {
    out[name] = { doc: label, label, locate: byName(name) };
  }
  for (const [name, def] of Object.entries(added)) {
    out[name] = { ...out[name], ...def, locate: def.locate ?? byName(name) };
  }
  for (const [name, def] of Object.entries(out)) {
    if (LARGE.includes(name)) def.large = true;
    if (FOCUS[name]) def.focus = FOCUS[name];
    if (PANEL_OF[name]) def.reveal = { action: 'open_panel', args: { panel: PANEL_OF[name] } };
  }
  for (const name of HIDEABLE_ANCHORS) out[name].hide = setHidden(name);
  return out;
}

export const pryAnchors: Record<string, AnchorDef> = build();

/** The anchors 0.4.0 adds (N11) beyond the 0.3.8 tour's targets. */
export const ADDED_ANCHORS: readonly string[] = Object.keys(added);

/** Anchors that live inside the Lessons sidebar, not the app (the embedding reader). */
export const SIDEBAR_ANCHORS: readonly string[] = ['embedding-view', 'embedding-values'];
