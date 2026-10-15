// Pry's models, services and spine (plan T2, map section 0).

import type { ToolActionSet } from './contract';

/** Legal front matter `model` values: the preset ids in sidecar/presets.json (checked in contract.test.ts). */
export const PRY_MODELS = ['gpt2-small', 'pythia-70m', 'gemma-2-2b', 'gemma-2-9b'] as const;

/** Legal `network` scopes. */
export const PRY_SERVICES: ToolActionSet<unknown>['services'] = {
  neuronpedia: {
    host: 'neuronpedia.org',
    doc: 'Neuronpedia, for concept search, feature labels and example snippets.',
  },
};

/** The spine strip, in order (map section 0). */
export const PRY_SPINE: ToolActionSet<unknown>['spine'] = [
  { id: 'text', label: 'text' },
  { id: 'tokens', label: 'tokens' },
  { id: 'embedding', label: 'embedding' },
  { id: 'residual-stream', label: 'residual stream' },
  { id: 'logits', label: 'logits' },
  { id: 'probabilities', label: 'probabilities' },
  { id: 'sampling', label: 'sampling' },
  { id: 'append', label: 'append' },
  { id: 'repeat', label: 'repeat' },
  // The bracket over every box: "training set every number in this box" (map 76; P1.1:62, P1.6:50).
  // Added by the T1 gate after T2b closed.
  { id: 'training', label: 'training set these numbers' },
];
