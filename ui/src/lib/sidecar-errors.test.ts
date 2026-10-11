import { describe, expect, it } from 'vitest';
import { sidecarErrorMessage } from './sidecar-errors';

describe('sidecarErrorMessage', () => {
  it('prefers a string detail', () => {
    expect(
      sidecarErrorMessage('{"error":"inference_error","detail":"Prompts must be the same length"}'),
    ).toBe('Prompts must be the same length');
  });

  it('uses a plain-sentence error', () => {
    expect(sidecarErrorMessage('{"error":"preset \'x\' not loaded; POST /load first"}')).toBe(
      "preset 'x' not loaded; POST /load first",
    );
  });

  it('ignores bare error codes and list details', () => {
    expect(sidecarErrorMessage('{"error":"validation_error","detail":[{"loc":["x"]}]}')).toBeNull();
  });

  it('returns null for non-JSON bodies', () => {
    expect(sidecarErrorMessage('Internal Server Error')).toBeNull();
    expect(sidecarErrorMessage('')).toBeNull();
  });
});
