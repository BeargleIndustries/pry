import { describe, expect, it } from 'vitest';
import { laterKey, promptCopy, shouldPrompt, type RuntimeUpdateStatus } from './runtime-update';

const base: RuntimeUpdateStatus = {
  state: 'update_available',
  current_variant: 'unknown-cpu',
  target_variant: 'cu124',
  download_mb: 2500,
  required_free_gb: 6.5,
  schema: 2,
  reason: 'legacy runtime without runtime.json',
};

describe('runtime update prompt', () => {
  it('uses GPU copy for cu124 and short copy for cpu', () => {
    expect(promptCopy('cu124')).toContain('graphics card');
    expect(promptCopy('cu124')).toContain('2.7 GB');
    expect(promptCopy('cpu')).toBe('Engine update (~400 MB).');
  });

  it('scopes Later per schema and variant', () => {
    expect(laterKey(2, 'cu124')).not.toBe(laterKey(2, 'cpu'));
    expect(laterKey(2, 'cu124')).not.toBe(laterKey(3, 'cu124'));
  });

  it('shows only for update_available with a known target that is not deferred', () => {
    const none = () => false;
    expect(shouldPrompt(base, none)).toBe(true);
    expect(shouldPrompt({ ...base, target_variant: null }, none)).toBe(false);
    expect(shouldPrompt({ ...base, state: 'ok' }, none)).toBe(false);
    expect(shouldPrompt(null, none)).toBe(false);
    const deferred = new Set([laterKey(2, 'cu124')]);
    expect(shouldPrompt(base, (k) => deferred.has(k))).toBe(false);
    expect(shouldPrompt({ ...base, target_variant: 'cpu' }, (k) => deferred.has(k))).toBe(true);
  });
});
