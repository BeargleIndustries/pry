import { describe, expect, it } from 'vitest';
import {
  buildConceptSearchBody,
  isNeuronpediaUnavailable,
  parseConceptSearch,
  queryProblem,
  showToken,
  similarityLabel,
} from './concept-search';

// Shape of a real /concept-search answer for "the ocean" on GPT-2 small, layer 8.
const ocean = {
  preset_id: 'gpt2-small',
  sae_layer: 8,
  query: 'the ocean',
  status: 'ok',
  results: [
    {
      feature_id: 8548,
      description: 'references to the ocean',
      similarity: 0.7028,
      top_boosted_tokens: ['ographer', 'front', ' basin'],
    },
    {
      feature_id: 11403,
      description: 'references to underwater environments and activities',
      similarity: 0.539,
      top_boosted_tokens: [' landsl', ' mammals'],
    },
  ],
};

describe('queryProblem', () => {
  it('needs at least 3 characters after trimming', () => {
    expect(queryProblem('  ab ')).toMatch(/at least 3/);
    expect(queryProblem('the ocean')).toBeNull();
  });
  it('caps the length', () => {
    expect(queryProblem('x'.repeat(201))).toMatch(/under 200/);
  });
});

describe('buildConceptSearchBody', () => {
  it('trims and includes the preset when given', () => {
    expect(JSON.parse(buildConceptSearchBody('  anger ', 'gpt2-small'))).toEqual({
      query: 'anger',
      preset_id: 'gpt2-small',
    });
    expect(JSON.parse(buildConceptSearchBody('anger', null))).toEqual({ query: 'anger' });
  });
});

describe('parseConceptSearch', () => {
  it('reads a real-shaped answer', () => {
    const r = parseConceptSearch(ocean);
    expect(r.status).toBe('ok');
    expect(r.sae_layer).toBe(8);
    expect(r.results.map((h) => h.feature_id)).toEqual([8548, 11403]);
    expect(r.results[0].top_boosted_tokens).toEqual(['ographer', 'front', ' basin']);
  });
  it('drops malformed hits and tolerates junk', () => {
    const r = parseConceptSearch({
      results: [
        { feature_id: -1, description: 'neg' },
        { feature_id: 1.5, description: 'frac' },
        { feature_id: 3, description: '' },
        { feature_id: 4, description: 'ok', similarity: 'high', top_boosted_tokens: [1, 'a'] },
        null,
      ],
    });
    expect(r.results).toEqual([
      { feature_id: 4, description: 'ok', similarity: null, top_boosted_tokens: ['a'] },
    ]);
    expect(parseConceptSearch(null).results).toEqual([]);
  });
  it('passes no_coverage through', () => {
    expect(parseConceptSearch({ ...ocean, results: [], status: 'no_coverage' }).status).toBe('no_coverage');
  });
});

describe('isNeuronpediaUnavailable', () => {
  it('matches only the 502 neuronpedia_unavailable error', () => {
    const body = JSON.stringify({ error: 'neuronpedia_unavailable', detail: "Couldn't reach Neuronpedia" });
    expect(isNeuronpediaUnavailable({ status: 502, body })).toBe(true);
    expect(isNeuronpediaUnavailable({ status: 500, body })).toBe(false);
    expect(isNeuronpediaUnavailable({ status: 502, body: 'not json' })).toBe(false);
    expect(isNeuronpediaUnavailable({ status: 400, body: '{"error":"Type at least 3 characters to search."}' })).toBe(false);
    expect(isNeuronpediaUnavailable(null)).toBe(false);
  });
});

describe('display helpers', () => {
  it('formats similarity as a label match', () => {
    expect(similarityLabel(0.7028)).toBe('70% label match');
    expect(similarityLabel(null)).toBeNull();
    expect(similarityLabel(1.4)).toBe('100% label match');
  });
  it('marks a leading space', () => {
    expect(showToken(' basin')).toBe('·basin');
    expect(showToken('front')).toBe('front');
  });
});
