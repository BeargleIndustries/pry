import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MODEL_WORKS,
  customCompatibility,
  customPresetId,
  hfIdOf,
  isCustomPresetId,
  looksLikeHfId,
  NO_SAE_MESSAGE,
  SIZE_UNCHECKED_NOTE,
} from './custom-models';
import { displayName, isPickable } from './preset-display';
import type { CustomPreset, HardwareReport } from './tauri';

describe('custom model ids', () => {
  it('round-trips the HF id through the preset id', () => {
    const id = customPresetId('EleutherAI/pythia-160m-deduped');
    expect(id).toBe('custom:EleutherAI/pythia-160m-deduped');
    expect(isCustomPresetId(id)).toBe(true);
    expect(hfIdOf(id)).toBe('EleutherAI/pythia-160m-deduped');
  });

  it('leaves preset ids alone', () => {
    expect(isCustomPresetId('gpt2-small')).toBe(false);
    expect(isCustomPresetId(null)).toBe(false);
    expect(hfIdOf('gpt2-small')).toBe('gpt2-small');
  });

  it('shows the HF id as the display name', () => {
    expect(displayName('custom:EleutherAI/pythia-160m-deduped', [])).toBe('EleutherAI/pythia-160m-deduped');
  });

  it('checks the name shape like the sidecar does', () => {
    expect(looksLikeHfId('gpt2')).toBe(true);
    expect(looksLikeHfId(' EleutherAI/pythia-160m-deduped ')).toBe(true);
    expect(looksLikeHfId('a/b/c')).toBe(false);
    expect(looksLikeHfId('has space')).toBe(false);
    expect(looksLikeHfId('')).toBe(false);
  });
});

describe('customCompatibility', () => {
  const pythia: CustomPreset = {
    id: 'EleutherAI/pythia-160m-deduped',
    display_name: 'pythia-160m-deduped',
    architecture: 'GPTNeoXForCausalLM',
    added_at: '2026-10-11T00:00:00Z',
    sae_available: false,
    params_label: '162M',
    vram_estimate_mb: 2000,
    cpu_ok: true,
  };
  const hw = { vendor: 'cpu' } as HardwareReport;

  it('uses the Rust verdict, keyed by the custom preset id', async () => {
    const calls: unknown[] = [];
    const row = await customCompatibility(pythia, hw, async (id, mb, cpuOk) => {
      calls.push([id, mb, cpuOk]);
      return { preset_id: id, verdict: 'CpuOk', headroom_mb: -2000, notes: ['Works on your computer (slower).'], display: null, enabled: true };
    });
    expect(calls).toEqual([['EleutherAI/pythia-160m-deduped', 2000, true]]);
    expect(row.preset_id).toBe('custom:EleutherAI/pythia-160m-deduped');
    expect(row.verdict).toBe('CpuOk');
    expect(row.display?.name).toBe('EleutherAI/pythia-160m-deduped');
    expect(row.display?.params).toBe('162M');
    expect(isPickable(row)).toBe(true);
    expect(displayName(row)).toBe('EleutherAI/pythia-160m-deduped');
  });

  it('says so when the size was never checked', async () => {
    const old = { ...pythia, vram_estimate_mb: undefined };
    const row = await customCompatibility(old, hw, () => {
      throw new Error('should not evaluate');
    });
    expect(row.notes).toEqual([SIZE_UNCHECKED_NOTE]);
  });
});

describe('custom model copy', () => {
  it('promises only SAE-free analyses', () => {
    const all = CUSTOM_MODEL_WORKS.join(' ').toLowerCase();
    expect(all).not.toMatch(/feature|steer/);
    expect(all).toMatch(/attention/);
    expect(all).toMatch(/logit lens/);
  });

  it('matches the sidecar message', () => {
    expect(NO_SAE_MESSAGE).toBe(
      "Features need a trained sparse autoencoder (SAE); this model doesn't have one in Pry yet.",
    );
  });
});
