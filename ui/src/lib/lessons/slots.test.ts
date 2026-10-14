import { describe, expect, it, vi } from 'vitest';
import { pryReadouts } from './registry/pry-readouts';
import type { Slot } from './format/schema';
import { derive, evaluateAssert, PLACEHOLDER, renderSlot, renderText, type SlotSource } from './slots';

function source(values: Record<string, unknown>): SlotSource {
  return { read: (name, args) => values[args ? `${name}${JSON.stringify(args)}` : name], readouts: pryReadouts };
}

describe('slots', () => {
  it('› slot renders the live value, not expect', () => {
    const slots: Record<string, Slot> = { p: { read: 'top_guess.prob', expect: 0.42 } };
    expect(renderSlot('p', slots, source({ 'top_guess.prob': 0.097 }))).toBe('9.7% (about 1 in 10)');
    const logit: Record<string, Slot> = { clean: { read: 'patch.cell', args: { layer: 9, position: 5 }, field: 'clean', expect: 3.21, format: 'logit' } };
    expect(renderSlot('clean', logit, source({ 'patch.cell{"layer":9,"position":5}': { clean: 2.5 } }))).toBe('2.50');
  });

  it('› slot in a predict choice renders', () => {
    const slots: Record<string, Slot> = { tok: { read: 'top_guess.token', expect: ' Paris' } };
    expect(renderText('It stays {tok}', slots, source({ 'top_guess.token': ' Paris' }))).toBe('It stays " Paris"');
  });

  it('› undefined slot renders the placeholder', () => {
    const slots: Record<string, Slot> = { p: { read: 'top_guess.prob', expect: 0.1 } };
    expect(renderSlot('p', slots, source({}))).toBe(PLACEHOLDER);
    expect(PLACEHOLDER).toBe('(appears after you run it)');
  });

  it('› string slot renders quoted', () => {
    const slots: Record<string, Slot> = { label: { read: 'features.label', args: { id: 7 }, expect: 'basketball terms' } };
    expect(renderSlot('label', slots, source({ 'features.label{"id":7}': 'sports, especially basketball' }))).toBe('"sports, especially basketball"');
  });

  it('› assert takes the else line when the requirement fails and logs it', () => {
    const slots: Record<string, Slot> = { share: { read: 'dla.actual', expect: 0.8, format: 'number' } };
    const a = { require: { slot: 'share', op: 'gt' as const, value: 0.5 }, say: 'a lot of the difference', else: 'some of the difference' };
    const log = vi.fn();
    expect(evaluateAssert(a, slots, source({ 'dla.actual': 0.8 }), log)).toBe('a lot of the difference');
    expect(log).not.toHaveBeenCalled();
    expect(evaluateAssert(a, slots, source({ 'dla.actual': 0.2 }), log)).toBe('some of the difference');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ slot: 'share', else: 'some of the difference' }));
  });

  it('› assert compares two live slots with abs', () => {
    const slots: Record<string, Slot> = { gap: { read: 'dla.gap', expect: -0.3 }, bars_total: { read: 'dla.bars_total', expect: 2 } };
    const a = { require: { slot: 'gap', op: 'lt' as const, slot2: 'bars_total', abs: true }, say: 'a small leftover', else: 'a leftover' };
    expect(evaluateAssert(a, slots, source({ 'dla.gap': -0.3, 'dla.bars_total': -2 }))).toBe('a small leftover');
    expect(evaluateAssert(a, slots, source({ 'dla.gap': -3, 'dla.bars_total': 2 }))).toBe('a leftover');
  });

  it('› share formula matches (patched − corrupted) ÷ (clean − corrupted)', () => {
    const [clean, corrupted, patched] = [3.21, 0.5, 2.1];
    expect(derive('share', [clean, corrupted, patched])).toBeCloseTo((patched - corrupted) / (clean - corrupted), 12);
    const slots: Record<string, Slot> = {
      clean: { read: 'r.clean', expect: clean },
      corrupted: { read: 'r.corrupted', expect: corrupted },
      patched: { read: 'r.patched', expect: patched },
      share: { from: ['clean', 'corrupted', 'patched'], formula: 'share' },
    };
    const src = source({ 'r.clean': 4, 'r.corrupted': 0, 'r.patched': 3 });
    expect(renderSlot('share', slots, src)).toBe('75% (about 3 in 4)');
    expect(derive('share', [1, 1, 2])).toBeUndefined();
    // P2.4:72: 67.7% over 2.3% is about 29 times as likely, a logit difference of about 3.4.
    expect(derive('ratio', [0.677, 0.023])).toBeCloseTo(29.43, 1);
    expect(derive('ln', [29.43])).toBeCloseTo(3.38, 2);
    expect(derive('ratio', [1, 0])).toBeUndefined();
    expect(derive('ln', [0])).toBeUndefined();
  });
});
