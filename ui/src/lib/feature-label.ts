// How much detail a feature's Neuronpedia label has. This is about label length,
// not about whether the label is right.
import type { FeatureHit } from './types';

export type LabelDetail = 'detailed' | 'short' | 'none';

/** `label_detail`, falling back to the deprecated `confidence` alias from older sidecars. */
export function labelDetailOf(hit: FeatureHit): LabelDetail {
  if (hit.label_detail) return hit.label_detail;
  switch (hit.confidence) {
    case 'high':
      return 'detailed';
    case 'medium':
    case 'low':
      return 'short';
    default:
      return 'none';
  }
}

/**
 * Whether to show the label as the feature's name. While the sidecar still sends
 * the old alias, one-word labels ('low') stay hidden, as before.
 */
export function isNamedFeature(hit: FeatureHit): boolean {
  if (hit.confidence) return hit.confidence === 'high' || hit.confidence === 'medium';
  const d = labelDetailOf(hit);
  return d === 'detailed' || d === 'short';
}
