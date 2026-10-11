import { describe, expect, it } from 'vitest';
import {
  CPU_OK_COPY,
  displayName,
  isPickable,
  neuronpediaUrl,
  neuronpediaUrlBase,
  verdictInfo,
} from './preset-display';
import type { PresetDisplay } from './types';

const gpt2: PresetDisplay = {
  name: 'GPT-2 small',
  blurb: '124M params',
  params: '124M',
  size_label: '600 MB',
  n_layers: 12,
  n_heads: 12,
  neuronpedia_model_id: 'gpt2-small',
  neuronpedia_release_suffix: 'res-jb',
  recommended: true,
};

describe('displayName', () => {
  it('uses display.name from a compat row', () => {
    expect(displayName({ preset_id: 'gpt2-small', display: gpt2 })).toBe('GPT-2 small');
  });
  it('looks up a bare id in a list', () => {
    expect(displayName('gpt2-small', [{ preset_id: 'gpt2-small', display: gpt2 }])).toBe('GPT-2 small');
    expect(displayName('gpt2-small', [{ id: 'gpt2-small', display: gpt2 }])).toBe('GPT-2 small');
  });
  it('falls back to the id when display is missing', () => {
    expect(displayName({ preset_id: 'pythia-70m', display: null })).toBe('pythia-70m');
    expect(displayName('pythia-70m')).toBe('pythia-70m');
    expect(displayName(null)).toBe('No model');
  });
});

describe('neuronpediaUrl', () => {
  it('builds the feature URL from the display block', () => {
    expect(neuronpediaUrl(gpt2, 8, 1234)).toBe('https://www.neuronpedia.org/gpt2-small/8-res-jb/1234');
    expect(neuronpediaUrlBase(gpt2, 8)).toBe('gpt2-small/8-res-jb');
  });
  it('returns null without coverage', () => {
    expect(neuronpediaUrl(null, 8, 1)).toBeNull();
    expect(neuronpediaUrl({ ...gpt2, neuronpedia_model_id: null }, 8, 1)).toBeNull();
    expect(neuronpediaUrl({ ...gpt2, neuronpedia_release_suffix: null }, 8, 1)).toBeNull();
    expect(neuronpediaUrl(gpt2, -1, 1)).toBeNull();
  });
});

describe('verdictInfo', () => {
  it('treats CpuOk as pickable with the plain-language copy', () => {
    const v = verdictInfo('CpuOk');
    expect(v.label).toBe(CPU_OK_COPY);
    expect(v.label).toBe('Works on your computer (slower)');
    expect(v.pickable).toBe(true);
  });
  it('covers every verdict', () => {
    expect(verdictInfo('Comfortable').pickable).toBe(true);
    expect(verdictInfo('Tight').pickable).toBe(true);
    expect(verdictInfo('Insufficient').pickable).toBe(false);
  });
  it('isPickable respects enabled', () => {
    expect(isPickable({ verdict: 'CpuOk', enabled: true })).toBe(true);
    expect(isPickable({ verdict: 'Comfortable', enabled: false })).toBe(false);
  });
});
