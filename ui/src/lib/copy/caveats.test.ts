// Honesty caveats (plan pry-clarity-2026-10-12, "Honesty caveat test", crit:F5).
// Each caveat is pinned by an exact phrase at each surface that shows it. Only the
// Critic or the user may change a phrase here. A lane that wants plainer wording
// proposes it in its commit body and keeps the pinned phrase until that's approved.
//
// Existing phrases are asserted now, whoever owns the file. New phrases owed by a
// lane in PENDING_LANES run as `test.todo` until that lane merges.
import { describe, expect, it } from 'vitest';
import { tipsRegistry } from '../tips/tips-registry';
import { PENDING_LANES, read, type Lane } from './copy-files';

interface Pin {
  caveat: string;
  /** File under `ui/src`, or `tip:<id>` for a tip's blurb + why. */
  where: string;
  phrase: string;
  lane: Lane;
  /** True when the phrase is new copy the lane still has to write. */
  isNew?: boolean;
}

export const PINS: Pin[] = [
  { caveat: 'DLA direct only', where: 'tip:dla-waterfall', phrase: 'Only direct pushes count', lane: 'T4b' },
  { caveat: 'DLA direct only', where: 'lib/components/DLAPanel.svelte', phrase: "Help through other parts isn't counted", lane: 'T4c', isNew: true },
  { caveat: 'DLA direct only', where: 'routes/+page.svelte#dla-tab', phrase: 'directly', lane: 'T4e' },
  { caveat: 'DLA direct only', where: 'lib/readouts.ts', phrase: 'most directly', lane: 'T4c' },

  { caveat: 'Edges = direct value path', where: 'lib/components/CircuitPanel.svelte', phrase: 'direct value path', lane: 'T4c' },
  { caveat: 'Edges = direct value path', where: 'tip:circuit-graph', phrase: 'direct value path', lane: 'T4b' },

  {
    caveat: 'Compare = correlation',
    where: 'lib/compare.ts',
    phrase: 'On their own they don\u2019t show what causes the model\u2019s answer.',
    lane: 'T4c',
  },
  { caveat: 'Compare = correlation', where: 'tip:compare-panel', phrase: 'This view only shows what changed, not why.', lane: 'T4b' },

  { caveat: 'Labels auto-generated', where: 'lib/readouts.ts', phrase: 'Labels are best guesses from Neuronpedia, not certainties.', lane: 'T4c' },
  { caveat: 'Labels auto-generated', where: 'tip:panel-b-feature-row', phrase: "which means they're a best guess, not a guarantee.", lane: 'T4b' },
  {
    caveat: 'Labels auto-generated',
    where: 'lib/components/SteeringPanel.svelte',
    phrase: 'Labels are written by an AI and can be wrong',
    lane: 'T4c',
    isNew: true,
  },
  { caveat: 'Labels auto-generated', where: 'lib/experiments/experiments.json', phrase: 'written by an AI', lane: 'T4a', isNew: true },

  {
    caveat: 'Neuronpedia',
    where: 'lib/concept-search.ts',
    phrase:
      'Searching sends the words you type to Neuronpedia (neuronpedia.org), a public site that labels these features. Only your search words and which model and layer you are using are sent.',
    lane: 'T4c',
  },

  { caveat: 'Logit lens rough early', where: 'tip:logit-lens-heatmap', phrase: 'a hint, not proof', lane: 'T4b' },
  { caveat: 'Logit lens rough early', where: 'lib/experiments/experiments.json', phrase: 'So read the early rows as a rough hint.', lane: 'T4a' },
  {
    caveat: 'Logit lens rough early',
    where: 'lib/tutorial/tour-steps.ts',
    phrase: "It's an approximation, since the middle layers weren't built to be read this way.",
    lane: 'T4a',
  },
];

/** The text a pin is checked against. */
function surface(where: string): string {
  if (where.startsWith('tip:')) {
    const tip = tipsRegistry.find((t) => t.id === where.slice(4));
    expect(tip, where).toBeDefined();
    return `${tip!.blurb} ${tip!.why}`;
  }
  if (where === 'routes/+page.svelte#dla-tab') {
    const m = read('routes/+page.svelte').match(/id: 'dla',[^}]*?title:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
    expect(m, 'DLA tab has a title').not.toBeNull();
    return m![1];
  }
  return read(where);
}

describe('honesty caveats are present', () => {
  it('covers all six caveats', () => {
    expect(new Set(PINS.map((p) => p.caveat)).size).toBe(6);
  });

  for (const p of PINS) {
    const name = `${p.caveat}: ${p.where} "${p.phrase.slice(0, 50)}"`;
    if (p.isNew && PENDING_LANES.has(p.lane)) {
      it.todo(`${name} [${p.lane}]`);
      continue;
    }
    // Markup wraps long lines, so runs of whitespace compare as one space.
    it(name, () => expect(surface(p.where).replace(/\s+/g, ' ')).toContain(p.phrase));
  }
});
