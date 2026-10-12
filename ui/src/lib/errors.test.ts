import { describe, expect, it } from 'vitest';
import { friendlyError } from './errors';

describe('friendlyError', () => {
  it('maps the bad-token 403 body', () => {
    const r = friendlyError("Pry's engine rejected the request (bad token).");
    expect(r.message).toMatch(/didn't accept the request/);
    expect(r.details).toBe("Pry's engine rejected the request (bad token).");
  });

  it('maps an unreachable engine', () => {
    expect(friendlyError(new TypeError('Failed to fetch')).message).toMatch(/isn't running/);
    expect(
      friendlyError("Pry's engine is unreachable at http://127.0.0.1:8765. Is the Python sidecar running?").message,
    ).toMatch(/isn't running/);
  });

  it('maps prompts of different length', () => {
    const r = friendlyError('clean and corrupted prompts have different token lengths (9 vs 10)');
    expect(r.message).toMatch(/same number of tokens/);
  });

  it('maps a layer mismatch', () => {
    expect(friendlyError('SAE layer 5 is not loaded for preset gpt2-small').message).toMatch(
      /feature layer isn't available/,
    );
  });

  it('maps out-of-range values', () => {
    expect(friendlyError('head 14 out of range for model with 12 heads').message).toMatch(
      /outside what this model supports/,
    );
  });

  it('maps a model that is not loaded', () => {
    expect(friendlyError("preset 'gpt2-small' not loaded").message).toMatch(/No model is loaded/);
  });

  it('falls back to the server text with details', () => {
    const r = friendlyError('CUDA error: device-side assert triggered');
    expect(r.message).toBe('CUDA error: device-side assert triggered');
    expect(r.details).toBe('CUDA error: device-side assert triggered');
  });

  it('truncates very long unknown messages but keeps them in details', () => {
    const long = 'x'.repeat(400);
    const r = friendlyError(long);
    expect(r.message.length).toBeLessThanOrEqual(160);
    expect(r.details).toBe(long);
  });

  it('handles empty input', () => {
    expect(friendlyError('').message).toMatch(/Something went wrong/);
  });
});
