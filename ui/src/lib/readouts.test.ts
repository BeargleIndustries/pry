import { describe, expect, it } from 'vitest';
import {
  attentionReadout,
  circuitReadout,
  dlaReadout,
  explainingLabel,
  featuresReadout,
  logitLensReadout,
  patchingReadout,
  pct,
  predictionsReadout,
  quoteToken,
  steeringReadout,
} from './readouts';
import type {
  CircuitResponse,
  DLAResponse,
  GenerateResponse,
  LogitLensResponse,
  PatchResponse,
  SteerResponse,
} from './types';
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
      'For the last word, "·is": the final answer, "·Paris", first becomes the top guess at layer 2 (layers run 0 to 4). ' +
        'Its chance grows from 3% there to 47% at the last layer.',
    );
  });

  it('golden: answer appears, drops out, then settles', () => {
    const r = clone(logitLens);
    r.grid[0][4].matches_final = true;
    r.grid[1][4].matches_final = false;
    expect(logitLensReadout(r)).toBe(
      'For the last word, "·is": the final answer, "·Paris", is already the top guess at layer 0, the very first layer. ' +
        'It drops back out, then stays on top from layer 2 onward. ' +
        'Early layers are a rough read, so that early guess is a hint, not proof.',
    );
  });

  it('golden: answer only appears at the last layer', () => {
    const r = clone(logitLens);
    for (let l = 0; l < 4; l++) r.grid[l][4].matches_final = false;
    expect(logitLensReadout(r)).toBe(
      'For the last word, "·is": the final answer, "·Paris", only becomes the top guess at the last layer (layer 4).',
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
      'For the only word, "of": the final answer, "·basketball", first becomes the top guess at layer 8 (layers run 0 to 11). ' +
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
      'The parts that pushed "·Paris" up most directly: the MLP in layer 10 and layer 9, head 8. ' +
        'Pushing it down most: layer 11, head 0 and layer 10, head 7.',
    );
  });

  it('golden: nothing pushes down', () => {
    const r = clone(dla);
    r.components = r.components.filter((c) => c.contribution > 0);
    expect(dlaReadout(r)).toBe(
      'The parts that pushed "·Paris" up most directly: the MLP in layer 10 and layer 9, head 8. ' +
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
    expect(attentionReadout(generate, 3, null, 'to')).toBe(
      '"·on" is the last word, so nothing comes after it to look back. Pick an earlier word.',
    );
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

// ---------------------------------------------------------------------------
// T4c edge cases (pry-clarity copy:R1-R9)
// ---------------------------------------------------------------------------

describe('predictionsReadout edge cases', () => {
  const p = (token: string, probability: number, rank: number) => ({ token, probability, rank });

  it('"the end of the text" for <|endoftext|>', () => {
    expect(predictionsReadout([p('<|endoftext|>', 0.4, 1), p(' The', 0.1, 2)])).toBe(
      'The model\'s top guess for what comes next is the end of the text (40%). Next most likely: "·The" (10%).',
    );
  });

  it('"a line break" for \\n', () => {
    expect(predictionsReadout([p('\n', 0.5, 1)])).toBe(
      "The model's top guess for what comes next is a line break (50%).",
    );
  });

  it('"word piece" for a fragment', () => {
    expect(predictionsReadout([p('orn', 0.7, 1)])).toBe(
      'The model\'s top guess for the next word is the word piece "orn" (part of a longer word) (70%).',
    );
  });

  it('punctuation is quoted as is', () => {
    expect(predictionsReadout([p('.', 0.3, 1)])).toBe('The model\'s top guess for what comes next is "." (30%).');
  });

  it('near tie wording', () => {
    expect(predictionsReadout([p(' Mary', 0.312, 1), p(' John', 0.308, 2)])).toBe(
      'The model\'s top guess for the next word is a near tie between "·Mary" and "·John" (31% each).',
    );
  });

  it('a certain guess skips a 0% runner-up', () => {
    expect(predictionsReadout([p(' yes', 1, 1), p(' no', 0, 2)])).toBe(
      'The model\'s top guess for the next word is "·yes" (100%).',
    );
  });

  it('two zero chances are not a tie', () => {
    expect(predictionsReadout([p(' a', 0, 1), p(' b', 0, 2)])).toBe(
      'The model\'s top guess for the next word is "·a" (0%).',
    );
  });
});

describe('logitLensReadout edge cases', () => {
  it('lens readout starts "For the last word, "', () => {
    expect(logitLensReadout(logitLens)!.startsWith('For the last word, "·is": ')).toBe(true);
  });

  it('a single word says "the only word"', () => {
    const r = clone(logitLens);
    r.tokens = r.tokens.slice(0, 1);
    r.grid = r.grid.map((row) => row.slice(0, 1));
    expect(logitLensReadout(r)!.startsWith('For the only word, "The": ')).toBe(true);
  });

  it('no layer matches the final answer', () => {
    const r = clone(logitLens);
    for (const row of r.grid) row[4].matches_final = false;
    expect(logitLensReadout(r)).toBe('For the last word, "·is": the model\'s final answer is "·Paris".');
  });

  it('an early first guess carries the rough-read caveat; a late one does not', () => {
    const early = clone(logitLens);
    early.grid[0][4].matches_final = true;
    early.grid[1][4].matches_final = true;
    expect(logitLensReadout(early)).toContain('Early layers are a rough read, so that early guess is a hint, not proof.');
    expect(logitLensReadout(logitLens)).not.toContain('rough read');
  });
});

describe('dlaReadout edge cases', () => {
  it('all-zero parts push nothing', () => {
    const r = clone(dla);
    for (const c of r.components) c.contribution = 0;
    expect(dlaReadout(r)).toBe('No part pushed "·Paris" up or down directly.');
  });

  it('only negative parts', () => {
    const r = clone(dla);
    r.components = r.components.filter((c) => c.contribution < 0);
    expect(dlaReadout(r)).toMatch(/^No part pushed "·Paris" up directly\. Pushing it down most: /);
  });

  it('keeps "most directly" (honesty caveat)', () => {
    expect(dlaReadout(dla)).toContain('most directly');
  });

  it('names heads as "layer L, head H"', () => {
    expect(dlaReadout(dla)).not.toMatch(/head \d+ in layer/);
  });
});

describe('explainingLabel', () => {
  it('names the word and counts words from 1', () => {
    expect(explainingLabel({ text: ' she', index: 2 })).toBe('Explaining the guess after ·she (word 3)');
  });

  it('falls back to the last word', () => {
    expect(explainingLabel(null)).toBe('Explaining the guess after the last word');
  });
});

describe('attentionReadout edge cases', () => {
  it('start marker can only look at itself', () => {
    const r = clone(generate);
    r.tokens[0].text = '<|endoftext|>';
    expect(attentionReadout(r, 0)).toBe('The start-of-text marker can only look at itself. Pick a word you typed.');
  });

  it('a tie is described as looking equally', () => {
    const r = clone(generate);
    r.attention[1].heads[1][2] = [0.4, 0.4, 0.2, 0];
    expect(attentionReadout(r, 2, { layer: 1, head: 1 })).toBe(
      'In layer 1, head 1, "·sat" looks equally at "The" and "·cat" (40% each).',
    );
  });

  it('single token returns null in both directions', () => {
    expect(attentionReadout({ ...generate, tokens: generate.tokens.slice(0, 1) }, 0, null, 'to')).toBeNull();
  });
});

describe('featuresReadout edge cases', () => {
  it('features start-marker caveat', () => {
    const text = featuresReadout(
      { token_index: 0, top_k: [{ id: 9, activation: 40, description: null }] },
      '<|endoftext|>',
    )!;
    expect(text).toContain('This is the start-of-text marker; features here are often odd, so pick a word you typed.');
    expect(featuresReadout({ token_index: 0, top_k: [] }, '<|endoftext|>')).toContain('start-of-text marker');
  });

  it('zero activations do not count as active', () => {
    expect(featuresReadout({ token_index: 0, top_k: [{ id: 9, activation: 0, description: 'x' }] }, 'The')).toBe(
      'No features are strongly active on "The".',
    );
  });
});

function patchFixture(): PatchResponse {
  const c = (name: string, layer: number, head: number | null, effect: number) => ({
    name,
    layer,
    head,
    position: null as number | null,
    effect,
    clean_logit: 4.8,
    corrupted_logit: 2.1,
    patched_logit: 2.1 + effect,
  });
  return {
    preset_id: 'gpt2-small',
    clean_prompt: 'When Mary and John went to the store, John gave a drink to',
    corrupted_prompt: 'When Mary and John went to the store, Mary gave a drink to',
    patch_type: 'head',
    target_token_index: 14,
    clean_predicted_token: ' Mary',
    corrupted_predicted_token: ' John',
    components: [
      c('L9H9', 9, 9, 1.234),
      c('L10H0', 10, 0, 0.5),
      c('L11H10', 11, 10, -0.8),
      c('L0H0', 0, 0, 0.01),
      c('L0H1', 0, 1, -0.02),
    ],
    timing_ms: {},
  };
}

describe('patchingReadout', () => {
  it('patching readout names the best part and its score change', () => {
    expect(patchingReadout(patchFixture())).toBe(
      'Copying layer 9, head 9 over from the original prompt raises the score for "·Mary" the most (+1.23). ' +
        '2 of 5 parts barely change it.',
    );
  });

  it('residual parts are named by word and layer', () => {
    const r = patchFixture();
    r.patch_type = 'resid';
    r.tokens = ['When', ' Mary'];
    r.components = [{ ...r.components[0], head: null, position: 1, layer: 3, name: 'L3P1' }];
    expect(patchingReadout(r)).toBe(
      'Copying the information at "·Mary" going into layer 3 over from the original prompt raises the score for "·Mary" the most (+1.23).',
    );
  });

  it('MLP parts', () => {
    const r = patchFixture();
    r.components = [{ ...r.components[0], head: null, name: 'MLP9' }];
    expect(patchingReadout(r)).toMatch(/^Copying the MLP in layer 9 over/);
  });

  it('only negative effects', () => {
    const r = patchFixture();
    r.components = r.components.map((c) => ({ ...c, effect: -Math.abs(c.effect) - 0.1 }));
    expect(patchingReadout(r)).toMatch(/^No single part brings "·Mary" back\./);
  });

  it('all zero effects', () => {
    const r = patchFixture();
    r.components = r.components.map((c) => ({ ...c, effect: 0 }));
    expect(patchingReadout(r)).toBe('None of the swaps changed the score for "·Mary".');
  });

  it('both prompts with the same guess', () => {
    const r = patchFixture();
    r.corrupted_predicted_token = ' Mary';
    expect(patchingReadout(r)).toContain('Both prompts already guess "·Mary", so expect small changes.');
  });

  it('returns null without parts', () => {
    expect(patchingReadout(null)).toBeNull();
    expect(patchingReadout({ ...patchFixture(), components: [] })).toBeNull();
  });
});

function circuitFixture(): CircuitResponse {
  return {
    preset_id: 'gpt2-small',
    prompt: 'x',
    threshold: 0.1,
    source: 'dla',
    nodes: [
      { id: 'L9H9', type: 'attention', layer: 9, head: 9, importance: 2.5 },
      { id: 'MLP10', type: 'mlp', layer: 10, head: null, importance: -0.7 },
      { id: 'L10H0', type: 'attention', layer: 10, head: 0, importance: 0.4 },
    ],
    edges: [],
    edges_method: 'direct_value_path',
    timing_ms: {},
  };
}

describe('circuitReadout', () => {
  it('key parts readout says lines show one kind of link', () => {
    expect(circuitReadout(circuitFixture())).toBe(
      '3 parts pushed the guess directly. The biggest is layer 9, head 9, which pushed toward it (+2.50). ' +
        'Lines show only one kind of link, the direct value path.',
    );
  });

  it('a negative biggest part pushes against it; one part is singular', () => {
    const r = circuitFixture();
    r.nodes = [r.nodes[1]];
    r.edges_method = 'none';
    expect(circuitReadout(r)).toBe(
      'One part pushed the guess directly. The biggest is the MLP in layer 10, which pushed against it (−0.70).',
    );
  });

  it('returns null with no parts', () => {
    expect(circuitReadout(null)).toBeNull();
    expect(circuitReadout({ ...circuitFixture(), nodes: [] })).toBeNull();
  });
});

describe('steeringReadout', () => {
  const steer = (original: string, steered: string): SteerResponse => ({
    preset_id: 'gpt2-small',
    prompt: 'I went to the',
    feature_id: 123,
    alpha: 5,
    original_generation: original,
    steered_generation: steered,
    original_top_predictions: [],
    steered_top_predictions: [],
    timing_ms: {},
  });

  it('steering readout counts changed words', () => {
    expect(steeringReadout(steer(' store to buy milk', ' beach to buy sand'))).toBe(
      'Steering feature #123 at strength 5 changed 2 of the 4 words it wrote.',
    );
  });

  it('no change suggests a bigger strength', () => {
    expect(steeringReadout(steer(' store', ' store'))).toBe(
      "Steering feature #123 at strength 5 didn't change the one word it wrote. Try a bigger strength.",
    );
  });

  it('every word changed', () => {
    expect(steeringReadout(steer(' a b', ' c d'))).toBe('Steering feature #123 at strength 5 changed all 2 words it wrote.');
  });

  it('nothing written', () => {
    expect(steeringReadout(steer('', ''))).toBe(
      'Steering feature #123 at strength 5 wrote nothing new. Press Run Steered again.',
    );
    expect(steeringReadout(null)).toBeNull();
  });
});
