import { describe, expect, it } from 'vitest';
import { isNamedFeature, labelDetailOf } from './feature-label';
import type { FeatureHit } from './types';

const hit = (extra: Partial<FeatureHit>): FeatureHit => ({
  id: 1,
  activation: 1,
  description: 'a label',
  ...extra,
});

describe('labelDetailOf', () => {
  it('prefers label_detail', () => {
    expect(labelDetailOf(hit({ label_detail: 'short', confidence: 'high' }))).toBe('short');
  });
  it('maps the old alias', () => {
    expect(labelDetailOf(hit({ confidence: 'high' }))).toBe('detailed');
    expect(labelDetailOf(hit({ confidence: 'medium' }))).toBe('short');
    expect(labelDetailOf(hit({ confidence: 'low' }))).toBe('short');
    expect(labelDetailOf(hit({ confidence: 'none' }))).toBe('none');
    expect(labelDetailOf(hit({}))).toBe('none');
  });
});

describe('isNamedFeature', () => {
  it('matches the old rule while the alias is sent', () => {
    expect(isNamedFeature(hit({ confidence: 'high', label_detail: 'detailed' }))).toBe(true);
    expect(isNamedFeature(hit({ confidence: 'medium', label_detail: 'short' }))).toBe(true);
    expect(isNamedFeature(hit({ confidence: 'low', label_detail: 'short' }))).toBe(false);
    expect(isNamedFeature(hit({ confidence: 'none', label_detail: 'none' }))).toBe(false);
  });
  it('uses label_detail alone when the alias is gone', () => {
    expect(isNamedFeature(hit({ label_detail: 'short' }))).toBe(true);
    expect(isNamedFeature(hit({ label_detail: 'none' }))).toBe(false);
  });
});
