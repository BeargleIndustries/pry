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
