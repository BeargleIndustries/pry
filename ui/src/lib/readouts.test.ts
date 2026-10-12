import { describe, expect, it } from 'vitest';
import {
  attentionReadout,
  dlaReadout,
  featuresReadout,
  logitLensReadout,
  pct,
  predictionsReadout,
  quoteToken,
} from './readouts';
import type { DLAResponse, GenerateResponse, LogitLensResponse } from './types';
import generateJson from './__fixtures__/readouts/generate.json';
import logitLensJson from './__fixtures__/readouts/logit-lens.json';
import dlaJson from './__fixtures__/readouts/dla.json';

const generate = generateJson as GenerateResponse;
const logitLens = logitLensJson as LogitLensResponse;
const dla = dlaJson as DLAResponse;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('quoteToken / pct', () => {
  it('quotes tokens and shows a leading space as a middle dot, like the panels', () => {
    expect(quoteToken(' Paris')).toBe('"·Paris"');
    expect(quoteToken('The')).toBe('"The"');
    expect(quoteToken('\n')).toBe('"\\n"');
  });

  it('rounds to whole percentages without faking 0% or 100%', () => {
    expect(pct(0.6234)).toBe('62%');
    expect(pct(0.001)).toBe('<1%');
    expect(pct(0)).toBe('0%');
    expect(pct(0.9996)).toBe('>99%');
    expect(pct(1)).toBe('100%');
  });
});

describe('predictionsReadout', () => {
  it('golden', () => {
    expect(predictionsReadout(generate.top_predictions)).toBe(
      'The model\'s top guess for the next word is "·the" (62%). Next most likely: "·a" (11%).',
    );
  });

  it('orders by rank, not array order', () => {
    const preds = [...(generate.top_predictions ?? [])].reverse();
    expect(predictionsReadout(preds)).toMatch(/^The model's top guess for the next word is "·the"/);
  });

  it('handles a single prediction and none', () => {
    expect(predictionsReadout([{ token: ' yes', probability: 0.9, rank: 1 }])).toBe(
      'The model\'s top guess for the next word is "·yes" (90%).',
    );
    expect(predictionsReadout([])).toBeNull();
    expect(predictionsReadout(undefined)).toBeNull();
  });
});

describe('logitLensReadout', () => {
  it('golden: answer first becomes top guess mid-stack', () => {
    expect(logitLensReadout(logitLens)).toBe(
      'The final answer, "·Paris", first becomes the top guess at layer 2 (layers run 0 to 4). ' +
        'Its chance grows from 3% there to 47% at the last layer.',
    );
  });

  it('golden: answer appears, drops out, then settles', () => {
    const r = clone(logitLens);
    r.grid[0][4].matches_final = true;
    r.grid[1][4].matches_final = false;
    expect(logitLensReadout(r)).toBe(
      'The final answer, "·Paris", is already the top guess at layer 0, the very first layer. ' +
        'It drops back out, then stays on top from layer 2 onward.',
    );
  });

  it('golden: answer only appears at the last layer', () => {
    const r = clone(logitLens);
    for (let l = 0; l < 4; l++) r.grid[l][4].matches_final = false;
    expect(logitLensReadout(r)).toBe(
      'The final answer, "·Paris", only becomes the top guess at the last layer (layer 4).',
    );
  });

  // Real last-token column from gpt2-small, "Michael Jordan played the sport of".
  // Layers 8 and 11 are both 42%, with a 93% peak between them. This used to
  // read "grows from 42% there to 42%".
  function jordanLens(): LogitLensResponse {
    const col: [string, number][] = [
      [' the', 0.6687], [' the', 0.7944], [' the', 0.62], [' the', 0.46], [' the', 0.4229],
      [' course', 0.5757], [' course', 0.2721], [' baseball', 0.2756],
      [' basketball', 0.4222], [' basketball', 0.932], [' basketball', 0.8336], [' basketball', 0.4221],
    ];
    return {
      preset_id: 'gpt2-small',
      prompt: 'Michael Jordan played the sport of',
      tokens: [{ index: 0, text: 'of' }] as LogitLensResponse['tokens'],
      grid: col.map(([t, p]) => [{ predicted_token: t, probability: p, matches_final: t === ' basketball' }]),
      n_layers: 12,
      timing_ms: {},
    };
  }

  it('regression: a mid-stack peak is reported, not "grows from 42% to 42%"', () => {
    const text = logitLensReadout(jordanLens());
    expect(text).toBe(
      'The final answer, "·basketball", first becomes the top guess at layer 8 (layers run 0 to 11). ' +
        'Its chance peaks at 93% at layer 9, then ends at 42% at the last layer.',
    );
    expect(text).not.toMatch(/grows from (\d+%) there to \1/);
  });

  it('equal ends with no peak never say "grows from X to X"', () => {
    const r = jordanLens();
    r.grid[9][0].probability = 0.42;
    r.grid[10][0].probability = 0.42;
    expect(logitLensReadout(r)).toMatch(/Its chance is about 42% there and at the last layer\.$/);
  });

  it('a chance that drops is described as falling', () => {
    const r = jordanLens();
    r.grid[8][0].probability = 0.9;
    r.grid[9][0].probability = 0.7;
    r.grid[10][0].probability = 0.5;
    expect(logitLensReadout(r)).toMatch(/Its chance falls from 90% there to 42% at the last layer\.$/);
  });

  it('returns null without data', () => {
    expect(logitLensReadout(null)).toBeNull();
    expect(logitLensReadout({ ...logitLens, n_layers: 0, grid: [] })).toBeNull();
  });
});

describe('dlaReadout', () => {
  it('golden', () => {
    expect(dlaReadout(dla)).toBe(
      'The parts that pushed "·Paris" up most directly: the MLP in layer 10 and head 8 in layer 9. ' +
        'Pushing it down most: head 0 in layer 11 and head 7 in layer 10.',
    );
  });

  it('golden: nothing pushes down', () => {
    const r = clone(dla);
    r.components = r.components.filter((c) => c.contribution > 0);
    expect(dlaReadout(r)).toBe(
      'The parts that pushed "·Paris" up most directly: the MLP in layer 10 and head 8 in layer 9. ' +
        'No part pushed it down directly.',
    );
  });

  it('never claims the parts add up to the score', () => {
    const variants: DLAResponse[] = [dla];
    const onlyDown = clone(dla);
    onlyDown.components = onlyDown.components.filter((c) => c.contribution < 0);
    variants.push(onlyDown);
    const single = clone(dla);
    single.components = single.components.slice(0, 1);
    variants.push(single);
    for (const v of variants) {
      for (const n of [1, 2, 3, 5]) {
        const text = dlaReadout(v, n)!.toLowerCase();
        expect(text).not.toContain('add up');
        expect(text).not.toContain('sum');
        expect(text).not.toContain('total');
      }
    }
  });

  it('returns null without components', () => {
    expect(dlaReadout(null)).toBeNull();
    expect(dlaReadout({ ...dla, components: [] })).toBeNull();
  });
});

describe('attentionReadout', () => {
  it('golden: averaged over all heads (no head selected)', () => {
    expect(attentionReadout(generate, 3)).toBe(
      'Averaged over all 4 heads, "·on" looks mostly at "The" (33% of its attention). Next: "·cat" (27%).',
    );
  });

  it('golden: one selected head', () => {
    expect(attentionReadout(generate, 3, { layer: 1, head: 1 })).toBe(
      'In layer 1, head 1, "·on" looks mostly at "·cat" (72% of its attention). Next: "·sat" (18%).',
    );
  });

  it('golden: a word looking at itself', () => {
    expect(attentionReadout(generate, 1, { layer: 0, head: 1 })).toBe(
      'In layer 0, head 1, "·cat" looks mostly at itself (80% of its attention). Next: "The" (20%).',
    );
  });

  it('golden: the first word', () => {
    expect(attentionReadout(generate, 0)).toBe('The first word, "The", can only look at itself.');
  });

  it('"to" view: names the later word that looks at the focus word most', () => {
    const m = generate.attention[1].heads[1];
    const later = [2, 3].map((k) => ({ k, w: m[k][1] })).sort((x, y) => y.w - x.w)[0];
    const text = attentionReadout(generate, 1, { layer: 1, head: 1 }, 'to')!;
    expect(text.startsWith('In layer 1, head 1, the word that looks at "·cat" most is ')).toBe(true);
    expect(text).toContain(`"${generate.tokens[later.k].text.replace(/^ /, '·')}"`);
  });

  it('explains the start-of-text marker when a word looks mostly at it', () => {
    const r = clone(generate);
    r.tokens[0].text = '<|endoftext|>';
    for (const layer of r.attention) for (const m of layer.heads) m[2] = m[2].map((_, k) => (k === 0 ? 0.9 : k <= 2 ? 0.05 : 0));
    expect(attentionReadout(r, 2)).toContain('start-of-text marker');
    expect(attentionReadout(generate, 3)).not.toContain('start-of-text marker');
  });

  it('"to" view: nothing comes after the last word', () => {
    expect(attentionReadout(generate, 3, null, 'to')).toBe('No later word looks back at "·on".');
  });

  it('golden: focused word has no attention row (past the cutoff)', () => {
    const r = clone(generate);
    r.tokens.push({ index: 4, text: ' the' });
    expect(attentionReadout(r, 4)).toBe('There is no attention data for "·the".');
  });

  it('never claims causality', () => {
    for (const pos of [1, 2, 3]) {
      for (const head of [null, { layer: 0, head: 0 }, { layer: 1, head: 1 }]) {
        const text = attentionReadout(generate, pos, head)!.toLowerCase();
        expect(text).not.toMatch(/\buses?\b|because/);
      }
    }
  });

  it('returns null without data', () => {
    expect(attentionReadout(null, 0)).toBeNull();
    expect(attentionReadout({ ...generate, tokens: generate.tokens.slice(0, 1) }, 0)).toBeNull();
  });
});

describe('featuresReadout', () => {
  const featuresAt = (i: number) => generate.sae_features.find((f) => f.token_index === i) ?? null;

  it('golden: strongest three, labelled and unlabelled', () => {
    expect(featuresReadout(featuresAt(3), ' on')).toBe(
      'The strongest features on "·on": #15301 ("prepositions before a location"), #902 ("the word on") ' +
        'and #77 (no label yet). Labels are best guesses from Neuronpedia, not certainties.',
    );
  });

  it('golden: two features', () => {
    expect(featuresReadout(featuresAt(2), ' sat')).toBe(
      'The strongest features on "·sat": #4120 ("past-tense verbs of motion") and #88 (no label yet). ' +
        'Labels are best guesses from Neuronpedia, not certainties.',
    );
  });

  it('golden: only unlabelled features skips the label caveat', () => {
    expect(featuresReadout({ token_index: 0, top_k: [{ id: 9, activation: 1, description: null }] }, 'The')).toBe(
      'The strongest feature on "The": #9 (no label yet).',
    );
  });

  it('golden: no active features', () => {
    expect(featuresReadout({ token_index: 0, top_k: [] }, 'The')).toBe(
      'No features are strongly active on "The".',
    );
    expect(featuresReadout(null, 'The')).toBeNull();
  });
});
