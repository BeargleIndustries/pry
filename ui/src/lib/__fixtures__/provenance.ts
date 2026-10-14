// A run that touched every tool, with the provenance echoes the sidecar returns
// since T4-py (model_revision, sae, steer layer and control, ablation targets,
// DLA answer/contrast). Used by notebook/report tests and the T5b sample export.
import type { BuildEntryInput, ProvenanceExtras } from '../notebook';
import type {
  AblateResponse,
  CircuitResponse,
  DLAResponse,
  GenerateResponse,
  LogitLensResponse,
  PatchResponse,
  SteerResponse,
} from '../types';
import generateJson from './readouts/generate.json';
import logitLensJson from './readouts/logit-lens.json';
import dlaJson from './readouts/dla.json';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function fullRun(): BuildEntryInput['run'] {
  const response = {
    ...(clone(generateJson) as GenerateResponse),
    temperature_used: 0.7,
    seed_used: 42,
    model_revision: '607a30d783dfa663caf39e06633721c8d4cfcd7e',
    sae: { release: 'gpt2-small-res-jb', id: 'blocks.8.hook_resid_pre' },
  } as GenerateResponse;
  const ablate = {
    preset_id: 'gpt2-small',
    prompt: response.prompt,
    original_predictions: [{ token: ' Mary', probability: 0.62, rank: 1 }],
    ablated_predictions: [{ token: ' John', probability: 0.31, rank: 1 }],
    prediction_delta: [],
    timing_ms: {},
  };
  return {
    response,
    saeLayer: 8,
    activePresetId: 'gpt2-small',
    logitLensResponse: clone(logitLensJson) as LogitLensResponse,
    dlaResponse: { ...(clone(dlaJson) as DLAResponse), answer_token: ' Mary', contrast_token: ' John' } as DLAResponse,
    steerResponse: {
      preset_id: 'gpt2-small',
      prompt: response.prompt,
      feature_id: 1234,
      alpha: 8,
      sae_layer: 8,
      original_generation: ' the store.',
      steered_generation: ' the beach.',
      original_top_predictions: [],
      steered_top_predictions: [],
      control: { feature_id: 777, generation: ' the park.' },
      timing_ms: {},
    } as SteerResponse,
    headAblateResponse: { ...ablate, ablations: [{ layer: 9, head: 9 }] } as AblateResponse,
    featureAblateResponse: { ...ablate, feature_ablations: [{ feature_index: 1234, layer: 8 }] } as AblateResponse,
    patchResponse: {
      preset_id: 'gpt2-small',
      clean_prompt: 'When Mary and John went to the store, John gave a drink to',
      corrupted_prompt: 'When Mary and John went to the store, Mary gave a drink to',
      patch_type: 'heads',
      target_token_index: 14,
      clean_predicted_token: ' Mary',
      corrupted_predicted_token: ' John',
      components: [],
      timing_ms: {},
    } as PatchResponse,
    circuitResponse: {
      preset_id: 'gpt2-small',
      prompt: response.prompt,
      threshold: 0.05,
      source: 'dla',
      nodes: [],
      edges: [],
    } as unknown as CircuitResponse,
  };
}

export function fullExtras(): ProvenanceExtras {
  return {
    appVersion: '0.4.0',
    health: {
      version: '0.4.0',
      device: 'cuda',
      torch: '2.5.1+cu124',
      cuda: '12.4',
      transformer_lens: '2.15.4',
      sae_lens: '6.5.1',
      transformers: '4.46.3',
    },
    persistencePrompts: ['I went to the'],
    compare: { a: 'The doctor said that he', b: 'The nurse said that she' },
    snapshot: { tab: 'dla' },
  };
}
