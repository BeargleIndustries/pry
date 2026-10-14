import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  attentionReadout,
  circuitReadout,
  coherenceLine,
  COHERENCE_SOURCE,
  controlHeading,
  dlaGapParts,
  dlaReadout,
  dlaTotalLine,
  explainingLabel,
  FEATURE_KNOCKOUT_NOTE,
  featuresReadout,
  keyPartsHeader,
  logitLensReadout,
  PATCH_BELOW_ZERO,
  PATCH_EVERY_POSITION,
  PATCH_LEGEND_FORMULA,
  PATCH_NULL_SHARE,
  PATCH_OVERSHOOT,
  patchingReadout,
  patchLogitsLine,
  patchShareEdge,
  patchShareLine,
  pct,
  predictionsReadout,
  quoteToken,
  STEERING_LIMIT,
  steeringPersistLine,
  steeringReadout,
  steeringScaleLine,
  steeringSections,
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

/** A file under `ui/src`, for markup checks (no component renderer in this suite). */
const readSrc = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

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

  // Replaces the old "never claims the parts add up" assertions (plan T4-ui,
  // MF-2b): the bars' total, the real logit and the gap now show side by side.
  it('DLA total line: bars total, real logit and the gap, labelled', () => {
    const r = { ...clone(dla), bars_total: 3.5, answer_logit: 4.25, contrast_logit: null, actual: 4.25, gap: 0.75 };
    expect(dlaTotalLine(r)).toBe(
      'Bars total 3.50. Real logit 4.25. Gap 0.75: the embedding\'s own direct push plus the attention-output and unembedding biases, not drawn as bars.',
    );
  });

  it('DLA total line shows both logits and their difference whenever a contrast is set', () => {
    const r = {
      ...clone(dla),
      answer_token: ' Mary',
      contrast_token: ' John',
      bars_total: 2.9,
      answer_logit: 15.1,
      contrast_logit: 12.0,
      actual: 3.1,
      gap: 0.2,
    };
    expect(dlaTotalLine(r)).toBe(
      'Bars total 2.90. Real logits 15.10 and 12.00, difference 3.10. Gap 0.20: the embedding\'s own direct push plus the attention-output and unembedding biases, not drawn as bars.',
    );
  });

  it('DLA total line uses a real minus sign and is null on an older engine', () => {
    const r = { ...clone(dla), bars_total: -1.5, answer_logit: -0.25, contrast_logit: null, actual: -0.25, gap: 1.25 };
    expect(dlaTotalLine(r)).toMatch(/^Bars total −1\.50\. Real logit −0\.25\. Gap 1\.25:/);
    expect(dlaTotalLine(dla)).toBeNull();
    expect(dlaTotalLine(null)).toBeNull();
  });

  it('the fold lists the gap parts by name', () => {
    const r = { ...clone(dla), gap_parts: { embedding_direct: 0.5, biases: -0.25 } };
    expect(dlaGapParts(r)).toEqual([
      { name: "The embedding's own direct push", value: '0.50' },
      { name: 'The attention-output and unembedding biases', value: '−0.25' },
    ]);
    expect(dlaGapParts(dla)).toEqual([]);
  });

  it('DLAPanel marks the total line dla-total-line and keeps the explaining label', () => {
    const src = readSrc('lib/components/DLAPanel.svelte');
    expect(src).toMatch(/data-tour="dla-total-line"[\s\S]*\{totalLine\}/);
    expect(src).toContain('explainingLabel(');
    expect(src).toContain('Bar length: push in logits');
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

  it('"a line break" for a newline token', () => {
    expect(predictionsReadout([p('\n', 0.5, 1)])).toBe(
      "The model's top guess for what comes next is a line break (50%).",
    );
  });

  it('"word piece" for a fragment', () => {
    expect(predictionsReadout([p('orn', 0.7, 1)], ' unic')).toBe(
      'The model\'s top guess for the next word is the word piece "orn" (part of a longer word) (70%).',
    );
  });

  it('a letter guess after a newline, quote, space or start marker is not a word piece', () => {
    for (const prev of ['\n', '"', ' "', ' ', '<|endoftext|>', null, undefined]) {
      const text = predictionsReadout([p('The', 0.6, 1)], prev);
      expect(text, JSON.stringify(prev)).toBe('The model\'s top guess for the next word is "The" (60%).');
    }
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
    expect(patchingReadout(r)).toMatch(/^No single part raises the score for "·Mary"\./);
  });

  it('all zero effects', () => {
    const r = patchFixture();
    r.components = r.components.map((c) => ({ ...c, effect: 0 }));
    expect(patchingReadout(r)).toBe('None of the swaps changed the score for "·Mary".');
  });

  it('both prompts with the same guess', () => {
    const r = patchFixture();
    r.corrupted_predicted_token = ' Mary';
    expect(patchingReadout(r)).toContain('Both prompts already guess "·Mary", so don\'t expect big changes.');
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

  // MF-4: no changed-word count anywhere; the marked tokens show what changed.
  it('steering readout says the text changed, with no word count', () => {
    const text = steeringReadout(steer(' store to buy milk', ' beach to buy sand'))!;
    expect(text).toBe('Steering feature #123 at strength 5 changed the text it wrote; the changed tokens are marked.');
    expect(text).not.toMatch(/\d+ (of the )?\d* ?words/);
  });

  it('no change suggests a bigger strength', () => {
    expect(steeringReadout(steer(' store', ' store'))).toBe(
      "Steering feature #123 at strength 5 didn't change the text it wrote. Try a bigger strength.",
    );
  });

  it('reads changed_token_indices when the engine sends them', () => {
    const r = { ...steer(' a b', ' a b'), changed_token_indices: [1] };
    expect(steeringReadout(r)).toMatch(/changed the text it wrote/);
    expect(steeringReadout({ ...steer(' a b', ' c d'), changed_token_indices: [] })).toMatch(/didn't change the text/);
  });

  it('nothing written', () => {
    expect(steeringReadout(steer('', ''))).toBe(
      "Steering feature #123 at strength 5 didn't write anything. Press Run Steered again.",
    );
    expect(steeringReadout(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Measurement display rules (plan T4-ui, rules table plan:457-469)
// ---------------------------------------------------------------------------

describe('Swap test three logits (MF-3)', () => {
  const withShare = (share: number | null, patched: number): PatchResponse => {
    const r = patchFixture();
    r.target_token = ' Mary';
    r.clean_logit = 4.8;
    r.corrupted_logit = 2.1;
    r.components = [{ ...r.components[0], patched_logit: patched, share }];
    return r;
  };

  it('one line names the target and its logit in all three runs', () => {
    const r = withShare(0.5, 3.45);
    expect(patchLogitsLine(r, r.components[0])).toBe(
      "' Mary''s logit: Original prompt 4.80, Changed prompt 2.10, after this swap 3.45.",
    );
  });

  it('the share formula shows its numbers beside the logits', () => {
    const r = withShare(0.5, 3.45);
    expect(patchShareLine(r, r.components[0])).toBe('Share = (3.45 − 2.10) ÷ (4.80 − 2.10) = 50%');
  });

  it('below 0% says the swap moved the logit away', () => {
    const r = withShare(-0.2, 1.56);
    expect(patchShareEdge(r.components[0])).toBe(PATCH_BELOW_ZERO);
    expect(PATCH_BELOW_ZERO).toBe('The swap moved the logit away from the Original value.');
  });

  it('above 100% says the swap overshot', () => {
    const r = withShare(1.3, 5.61);
    expect(patchShareEdge(r.components[0])).toBe(PATCH_OVERSHOOT);
    expect(PATCH_OVERSHOOT).toBe('The swap overshot the Original value.');
    expect(patchShareEdge(withShare(0.5, 3.45).components[0])).toBeNull();
  });

  it("a null share says a share doesn't mean anything", () => {
    const r = withShare(null, 2.1);
    expect(patchShareLine(r, r.components[0])).toBe(PATCH_NULL_SHARE);
    expect(PATCH_NULL_SHARE).toBe("Original and Changed give nearly the same logit here, so a share doesn't mean anything.");
    expect(patchShareEdge(r.components[0])).toBeNull();
  });

  it('notes that heads and MLPs are swapped at every position; the legend states the formula', () => {
    expect(PATCH_EVERY_POSITION).toBe('Heads and MLPs are swapped at every position.');
    expect(PATCH_LEGEND_FORMULA).toContain('(after this swap − Changed prompt) ÷ (Original prompt − Changed prompt)');
    const src = readSrc('lib/components/PatchingPanel.svelte');
    expect(src).toMatch(/data-tour="patch-three-logits"[\s\S]*patchLogitsLine\(/);
    expect(src).toContain('PATCH_EVERY_POSITION');
    expect(src).toContain('PATCH_LEGEND_FORMULA');
    expect(src).toContain('signedColor(comp.share ?? 0, 1)');
  });
});

describe('Steering measures (MF-4, N13)', () => {
  const full: SteerResponse = {
    preset_id: 'gpt2-small',
    prompt: 'I went to the',
    feature_id: 123,
    alpha: 5,
    original_generation: ' store to buy milk and eggs',
    steered_generation: ' beach to buy sand and shells',
    original_top_predictions: [],
    steered_top_predictions: [],
    changed_token_indices: [0, 3, 5],
    coherence: { original: -1.407, steered: -2.129 },
    scale: { strength: 5, activation_p50: 0.5, activation_p99: 3.25, activation_max: 4.1 },
    control: {
      feature_id: 9,
      decoder_norm: 1,
      steered_decoder_norm: 1.05,
      cosine: 0.01,
      method: 'norm_matched_lowest_cos',
      generation: ' store to buy milk and bread',
      changed_token_indices: [5],
      coherence: { original: -1.407, steered: -1.5 },
      top_predictions: [],
      top_changed: [],
    },
    timing_ms: {},
  };

  it('steering order: what changed, coherence, the control, scale', () => {
    expect(steeringSections(full)).toEqual(['changed', 'coherence', 'control', 'scale']);
    expect(steeringSections({ ...full, control: null })).toEqual(['changed', 'coherence', 'scale']);
    expect(steeringSections(null)).toEqual([]);
  });

  it('scale line', () => {
    expect(steeringScaleLine(full)).toBe(
      "Steering strength 5; this feature's activation on this prompt runs up to 4.1 (most positions under 3.25).",
    );
    expect(steeringScaleLine({ ...full, scale: null })).toBeNull();
  });

  it('coherence fallback: both numbers with their source, no band label', () => {
    const line = coherenceLine(full.coherence)!;
    expect(line).toBe(
      'Coherence: Original −1.41, Steered −2.13 (average log-probability per token of each continuation, under the unsteered model).',
    );
    expect(COHERENCE_SOURCE).toBe('average log-probability per token of each continuation, under the unsteered model');
    expect(STEERING_LIMIT).toBe(
      'The push is added at every position, prompt included. Repetitive text scores as very natural, so breaking a loop can look like a drop.',
    );
    // Calibration: the bands didn't separate, so no band wording renders anywhere.
    const bands = ['Reads about as naturally as before.', 'Reads less naturally.', 'Reads much less naturally'];
    const panel = readSrc('lib/components/SteeringPanel.svelte');
    const readouts = readSrc('lib/readouts.ts');
    for (const b of bands) {
      expect(line).not.toContain(b);
      expect(panel).not.toContain(b);
      expect(readouts).not.toContain(b);
    }
  });

  it('coherence is hidden under 5 tokens (null)', () => {
    expect(coherenceLine({ original: null, steered: -2 })).toBeNull();
    expect(steeringSections({ ...full, coherence: { original: -1, steered: null } })).toEqual(['changed', 'control', 'scale']);
  });

  it('steering coherence line sits inside the steering-coherence hideable region', () => {
    const src = readSrc('lib/components/SteeringPanel.svelte');
    const region = src.match(
      /<div\s+data-tour="steering-coherence"\s+data-lesson-hidden=\{isHidden\('steering-coherence'\) \|\| undefined\}[\s\S]*?<\/div>/,
    );
    expect(region, 'steering-coherence wrapper').not.toBeNull();
    expect(region![0]).toContain('coherenceLine(steerResponse.coherence)');
    expect(region![0]).toContain('STEERING_LIMIT');
    // The line renders nowhere outside the region.
    expect(src.split('coherenceLine(steerResponse.coherence)').length).toBe(2);
  });

  it('the control runs at the same strength with the same readouts', () => {
    expect(controlHeading(full.control!, full.alpha)).toBe('Control: feature #9, same strength 5');
    expect(coherenceLine(full.control!.coherence, ['Original', 'Control'])).toMatch(/^Coherence: Original −1\.41, Control −1\.50 /);
  });

  it('persistence summary counts the prompts it shows', () => {
    const runs = [
      { prompt: 'a', response: full },
      { prompt: 'b', response: { ...full, steered_generation: full.original_generation } },
    ];
    expect(steeringPersistLine(runs)).toBe('The steering changed the text on 1 of 2 prompts.');
    expect(steeringPersistLine([])).toBeNull();
  });
});

describe('feature knockout description (C21)', () => {
  it('says the SAE leftover error stays', () => {
    expect(FEATURE_KNOCKOUT_NOTE).toBe(
      "Knocking out a feature removes only the part of the residual stream the SAE accounts for. The SAE's leftover error stays, so a small change can mean the feature mattered little or that its share was small.",
    );
    expect(readSrc('lib/components/PanelB.svelte')).toContain('{FEATURE_KNOCKOUT_NOTE}');
  });
});

describe('Key parts header', () => {
  it("names the top guess and the selected word", () => {
    expect(keyPartsHeader(' Mary', { text: ' to', index: 13 })).toBe(
      "Explains the top guess ' Mary' after the selected word ' to'",
    );
    expect(readSrc('lib/components/CircuitPanel.svelte')).toContain('keyPartsHeader(topGuess, targetLabel)');
  });

  it('falls back to the explaining label when the top guess is unknown', () => {
    expect(keyPartsHeader(null, { text: ' she', index: 2 })).toBe('Explaining the guess after ·she (word 3)');
  });
});
