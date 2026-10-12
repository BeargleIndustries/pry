import { describe, expect, it } from 'vitest';
import { gateStepMissing } from './hf-gate';
import { friendlyError } from './errors';

// Copies of the sidecar's messages (sidecar/pry_sidecar/registry.py _gate_message).
const NO_TOKEN =
  "Gemma 2 2B needs one more setup step: Pry doesn't have your Hugging Face token yet. Add it in the Hugging Face token step, then load Gemma 2 2B again.";
const BAD_TOKEN =
  "Gemma 2 2B needs one more setup step: Hugging Face didn't accept the token Pry has saved. Paste a fresh read token in the Hugging Face token step, then load Gemma 2 2B again.";
const NO_LICENSE =
  "Gemma 2 2B needs one more setup step: your Hugging Face account hasn't accepted Google's Gemma license yet. Accept it at huggingface.co/google/gemma-2-2b in your browser, then load Gemma 2 2B again.";

describe('gateStepMissing', () => {
  it('names the missing step', () => {
    expect(gateStepMissing(NO_TOKEN)).toBe('token');
    expect(gateStepMissing(BAD_TOKEN)).toBe('token');
    expect(gateStepMissing(NO_LICENSE)).toBe('license');
  });

  it('ignores other errors', () => {
    expect(gateStepMissing(null)).toBeNull();
    expect(gateStepMissing('')).toBeNull();
    expect(gateStepMissing('Load failed: CUDA out of memory')).toBeNull();
    expect(gateStepMissing("Pry's engine rejected the request (bad token).")).toBeNull();
  });
});

describe('friendlyError keeps gate messages whole', () => {
  it('shows the sidecar sentence untouched and untruncated', () => {
    for (const msg of [NO_TOKEN, BAD_TOKEN, NO_LICENSE]) {
      expect(friendlyError(msg)).toEqual({ message: msg, details: null });
    }
  });
});
