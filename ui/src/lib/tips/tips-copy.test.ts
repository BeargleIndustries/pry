// Lane-local closure rows for T4b (tips and loading cards). T4e folds these into
// `copy/copy-closure.test.ts` once the shared visible-string extractor exists.
// Until then, "visible" means the string literals in a tip's title/blurb/why
// fields, and the LOADING_TIPS headings.
import { describe, it, expect } from 'vitest';
import { LOADING_TIPS } from '../loading-deck';
import { tipsRegistry } from './tips-registry';
import tipsSource from './tips-registry.ts?raw';
import deckSource from '../loading-deck.ts?raw';

/** String literals in title/blurb/why fields, escapes decoded. */
function tipStrings(src: string): string[] {
  const re = /\b(?:title|blurb|why):\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  return [...src.matchAll(re)].map((m) =>
    m[1].slice(1, -1).replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1'),
  );
}

const visibleTips = tipStrings(tipsSource);
const visibleDeck = Object.values(LOADING_TIPS);

interface Row {
  id: string;
  file: 'tips' | 'deck';
  mustContain?: string[];
  mustNotContain?: string[];
}

const rows: Row[] = [
  { id: 'copy:P1', file: 'tips', mustContain: ['A dot means the piece starts with a space'] },
  { id: 'copy:P2', file: 'tips', mustContain: ['Score by'], mustNotContain: ['currently-focused token'] },
  {
    id: 'copy:P3',
    file: 'tips',
    mustContain: ['Only direct pushes count', '30 biggest'],
    mustNotContain: ['mattered most'],
  },
  {
    id: 'copy:P4',
    file: 'tips',
    mustContain: ['Indigo cells', 'a hint, not proof'],
    mustNotContain: ['from the start'],
  },
  {
    id: 'copy:P5',
    file: 'tips',
    mustContain: ['the word right before'],
    mustNotContain: ['causal masking', 'query \u00d7 key'],
  },
  { id: 'copy:P6', file: 'tips', mustContain: ['round x'], mustNotContain: ['Toggle this'] },
  { id: 'copy:P7', file: 'tips', mustContain: ["fits your computer's memory"] },
  { id: 'copy:P8', file: 'tips', mustNotContain: ['basically nothing'] },
  { id: 'copy:P9', file: 'tips', mustContain: ['top 10'] },
  { id: 'copy:P10', file: 'tips', mustContain: ['Run Steered'], mustNotContain: ['rewired'] },
  { id: 'copy:P11', file: 'tips', mustContain: ['Run both'] },
  { id: 'copy:P12', file: 'tips', mustNotContain: ['heatmap'] },
  {
    id: 'copy:P13',
    file: 'tips',
    mustContain: ['layer 7, head 3', 'Swap test'],
    mustNotContain: ['head 7.3'],
  },
  {
    id: 'copy:L2',
    file: 'deck',
    mustContain: ['Logit Lens', 'Key parts', 'Find a concept'],
    mustNotContain: ['Circuit', 'Concept search'],
  },
  { id: 'rename:tips', file: 'tips', mustNotContain: ['Swap & Compare', 'clean', 'corrupted'] },
  { id: 'rename:deck', file: 'deck', mustNotContain: ['Swap & Compare'] },
];

describe('T4b copy closure rows', () => {
  for (const row of rows) {
    it(row.id, () => {
      const text = row.file === 'tips' ? tipsSource : deckSource;
      const visible = row.file === 'tips' ? visibleTips : visibleDeck;
      for (const s of row.mustContain ?? []) expect(text, `${row.id} +"${s}"`).toContain(s);
      for (const s of row.mustNotContain ?? [])
        for (const v of visible) expect(v, `${row.id} -"${s}"`).not.toContain(s);
    });
  }

  it('extractor sees every tip in the registry', () => {
    // Registry tips (flag-gated custom-model tip may be absent) all show up in the scan.
    for (const tip of tipsRegistry) {
      expect(visibleTips).toContain(tip.title);
      expect(visibleTips).toContain(tip.blurb);
    }
  });

  it('copy:P1 the word strip tip anchors the visible strip, and the dead tips are gone', () => {
    const tip = tipsRegistry.find((t) => t.id === 'word-strip');
    expect(tip?.target).toBe('[data-tour="token-strip"]');
    expect(tipsSource).not.toMatch(/panel-a-token-strip|panel-b-token-strip/);
  });

  // Pinned honesty caveats (plan: Honesty caveat test, crit:F5). Exact phrases.
  it('honesty caveats are present', () => {
    const pinned: [string, string][] = [
      ['dla-waterfall', 'Only direct pushes count'],
      ['circuit-graph', 'direct value path'],
      ['compare-panel', 'This view only shows what changed, not why.'],
      ['panel-b-feature-row', "which means they're a best guess, not a guarantee."],
      ['logit-lens-heatmap', 'a hint, not proof'],
    ];
    for (const [id, phrase] of pinned) {
      const tip = tipsRegistry.find((t) => t.id === id)!;
      expect(`${tip.blurb} ${tip.why}`, id).toContain(phrase);
    }
  });

  it('no em dashes in visible tip or loading-card text', () => {
    for (const v of [...visibleTips, ...visibleDeck]) expect(v).not.toContain('\u2014');
  });
});
