import { describe, expect, it } from 'vitest';
import {
  failureHeadline,
  laterKey,
  promptCopy,
  shouldPrompt,
  type RuntimeUpdateStatus,
} from './runtime-update';

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
  it('says "faster" only for a CPU engine moving to a GPU build', () => {
    const faster =
      'A faster engine is available for your graphics card (one-time ~3.5 GB download).';
    expect(promptCopy('cpu', 'cu128', 3500)).toBe(faster);
    expect(promptCopy('unknown-cpu', 'cu128', 3500)).toBe(faster);
    expect(promptCopy('cu128', 'cu128', 3500)).toBe(
      'An engine update is available (one-time ~3.5 GB download).',
    );
    expect(promptCopy('cu124', 'cu124', 2700)).toBe(
      'An engine update is available (one-time ~2.7 GB download).',
    );
    expect(promptCopy('cpu', 'cpu', 420)).toBe('Engine update (~420 MB).');
    expect(promptCopy('unknown-cpu', 'cpu', 420)).toBe('Engine update (~420 MB).');
  });

  it('explains a cu124 -> cu128 move as the card needing it', () => {
    expect(promptCopy('cu124', 'cu128', 3500)).toBe(
      'Your graphics card needs a newer engine (one-time ~3.5 GB download).',
    );
  });

  it('claims the current engine still works only when it is running', () => {
    expect(failureHeadline('rolled_back')).toContain('still works');
    expect(failureHeadline('not_started')).toContain('still works');
    expect(failureHeadline('restart_required')).not.toContain('still works');
    expect(failureHeadline('restart_required')).toContain('restart Pry');
    expect(failureHeadline('unknown')).not.toContain('still works');
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
