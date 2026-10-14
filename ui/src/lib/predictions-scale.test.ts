// Prediction bars and the shape sentence (plan T4-ui, MF-1 / N1). Rules are
// pinned here; changing one needs Critic or Brad sign-off.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  barWidthPct,
  everythingElse,
  predictionLogitLine,
  predictionShape,
  predictionTags,
  probabilityWithFrequency,
  SHAPE_FEW,
  SHAPE_ONE,
  SHAPE_SPREAD,
} from './readouts';
import type { TopPrediction } from './types';

const panel = readFileSync(new URL('./components/PredictionsPanel.svelte', import.meta.url), 'utf8');

/** Top-k predictions from a list of probabilities, ranked in order. */
const preds = (ps: number[]): TopPrediction[] =>
  ps.map((probability, i) => ({ token: ` t${i}`, probability, rank: i + 1, logit: 10 - i }));

describe('prediction bars', () => {
  it('9% bar is 9%', () => {
    expect(barWidthPct(0.09)).toBe('9%');
    // The width is the probability itself, not scaled to the top bar.
    expect(barWidthPct(0.5)).toBe('50%');
    expect(barWidthPct(1)).toBe('100%');
    expect(panel).toContain('style:width={barWidthPct(pred.probability)}');
    expect(panel).toMatch(/<span>0%<\/span>[\s\S]*<span>100%<\/span>/);
  });

  it('everything-else row = 1 − the top ten', () => {
    const p = preds([0.3, 0.2, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.03, 0.02, 0.01]);
    expect(everythingElse(p)).toBeCloseTo(0.1, 10);
    expect(everythingElse(preds([0.6, 0.5]))).toBe(0);
    expect(panel).toMatch(/data-tour="everything-else-row"[\s\S]*Everything else[\s\S]*barWidthPct\(rest\)/);
  });

  it('natural frequency beside each percentage', () => {
    expect(probabilityWithFrequency(0.097)).toBe('9.7% (about 1 in 10)');
    expect(probabilityWithFrequency(0.34)).toBe('34% (about 1 in 3)');
    expect(panel).toContain('{probabilityWithFrequency(pred.probability)}');
    expect(panel).toContain('{probabilityWithFrequency(rest)}');
  });

  it('logit on click', () => {
    expect(predictionLogitLine({ token: ' Paris', probability: 0.1, rank: 1, logit: 12.346 })).toBe(
      '"·Paris" has a logit of 12.35. Softmax turns the logits into the probabilities above.',
    );
    expect(predictionLogitLine({ token: ' Paris', probability: 0.1, rank: 1 })).toBeNull();
    expect(panel).toMatch(/onclick=\{\(\) => \{ selectedRank = /);
    expect(panel).toContain('predictionLogitLine(selected)');
  });
});

describe('shape sentence and tags', () => {
  it('shape cutoffs at exactly 0.5', () => {
    // top-1 exactly 0.5 is not "most"; the top ten summing to exactly 0.5 is "half or less".
    expect(predictionShape(preds([0.5, 0.25]))).toBe(SHAPE_FEW);
    expect(predictionShape(preds([0.5000001]))).toBe(SHAPE_ONE);
    expect(predictionShape(preds([0.25, 0.25]))).toBe(SHAPE_SPREAD);
    expect(predictionShape(preds([0.25, 0.2500001]))).toBe(SHAPE_FEW);
    expect(SHAPE_ONE).toBe('One token has most of the probability.');
    expect(SHAPE_FEW).toBe('A few tokens share most of the probability.');
    expect(SHAPE_SPREAD).toBe('The probability is spread over many tokens; the top ten have half or less.');
    expect(predictionTags(preds([0.5, 0.1]))).not.toContain('over 50%');
    expect(predictionTags(preds([0.51, 0.1]))).toContain('over 50%');
  });

  it('top three within 5 points', () => {
    expect(predictionTags(preds([0.2, 0.18, 0.16]))).toEqual(['top three within 5 points']);
    expect(predictionTags(preds([0.2, 0.18, 0.15]))).toEqual([]);
  });

  it('shape before tag, and no "confident" or "unsure"', () => {
    const shapeAt = panel.indexOf('{shape}');
    const tagAt = panel.indexOf('{tag}');
    expect(shapeAt).toBeGreaterThan(-1);
    expect(tagAt).toBeGreaterThan(shapeAt);
    for (const word of ['confident', 'unsure', 'uncertain', 'maxProb']) expect(panel).not.toContain(word);
  });
});
