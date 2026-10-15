import { describe, expect, it, vi } from 'vitest';
import { pryReadouts } from './registry/pry-readouts';
import type { Slot } from './format/schema';
import { derive, evaluateAssert, formatValue, PLACEHOLDER, renderSlot, renderText, type SlotSource } from './slots';
import { formatReading } from './runner/checks';

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

  it('› row-constant slot formats a layer label', () => {
    // From the bundled rows.json constants: row 27's peak cell is at L2, row 23's head is L2H8.
    const slots: Record<string, Slot> = {
      peak: { row: '27.peak_layer' },
      head: { row: '23.head' },
      word: { row: '27.peak_word' },
      p: { row: '1.basketball' },
      gone: { row: '27.no_such_field' },
    };
    expect(renderSlot('peak', slots, source({}))).toBe('L2');
    expect(renderSlot('head', slots, source({}))).toBe('8');
    expect(renderSlot('word', slots, source({}))).toBe('" John"');
    expect(renderSlot('p', slots, source({}))).toBe('42.2% (about 3 in 7)');
    expect(renderSlot('gone', slots, source({}))).toBe(PLACEHOLDER);
    // A runner may pass its own lookup.
    const own: SlotSource = { ...source({}), row: (id, field) => (id === '9' && field === 'top' ? { value: 11, unit: 'layer' } : undefined) };
    expect(renderSlot('x', { x: { row: '9.top' } }, own)).toBe('L11');
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

  describe('formatting (first-timer rubric)', () => {
    it('› natural frequency only for a probability in (0, 1]; a change prints as signed points', () => {
      expect(formatValue(-0.125, 'probability')).toBe('−12.5 points');
      expect(formatValue(0.036, 'points')).toBe('+3.6 points');
      expect(formatValue(-0.022, 'points')).toBe('−2.2 points');
      expect(formatValue(0, 'probability')).toBe('0%');
      expect(formatValue(0.677, 'probability')).toBe('67.7% (about 2 in 3)');
    });

    it('› a small probability keeps two significant figures and a rounded 1 in N', () => {
      expect(formatValue(0.000914, 'probability')).toBe('0.091% (about 1 in 1,100)');
    });

    it('› a *delta readout and a difference slot print as points', () => {
      const slots: Record<string, Slot> = {
        d: { read: 'ablation.delta', args: { token: ' Mary' } },
        a: { read: 'top_guess.prob' },
        b: { read: 'rest_mass' },
        gap: { from: ['a', 'b'], formula: 'difference', format: 'probability' },
      };
      const src = source({ 'ablation.delta{"token":" Mary"}': -0.125, 'top_guess.prob': 0.097, rest_mass: 0.049 });
      expect(renderSlot('d', slots, src)).toBe('−12.5 points');
      expect(renderSlot('gap', slots, src)).toBe('+4.8 points');
    });

    it('› a prob field reads as a probability and a Swap test logit field to two decimals, not a bare decimal', () => {
      const slots: Record<string, Slot> = {
        p: { read: 'prediction', args: { token: ' golf' }, field: 'prob' },
        c: { read: 'patch.cell', args: { layer: 2, position: 10 }, field: 'clean' },
      };
      const src = source({ 'prediction{"token":" golf"}': { prob: 0.677 }, 'patch.cell{"layer":2,"position":10}': { clean: 18.46638 } });
      expect(renderSlot('p', slots, src)).toBe('67.7% (about 2 in 3)');
      expect(renderSlot('c', slots, src)).toBe('18.47');
    });

    it('› records and lists read in words, never as JSON', () => {
      const top = [
        { token: ' Mary', prob: 0.677 },
        { token: ' them', prob: 0.128 },
      ];
      const shown = formatReading(top, pryReadouts.top_k, undefined, 'top_k');
      expect(shown).toBe('" Mary" 67.7% (about 2 in 3), " them" 12.8% (about 1 in 8)');
      expect(shown).not.toContain('{');
      const scale = formatValue({ strength: 25, activation_p50: 0, activation_p99: 0.12, activation_max: 0.31 }, 'number');
      expect(scale).toBe('strength 25, activation p50 0, activation p99 0.12, activation max 0.31');
      const cell = formatValue({ layer: 2, position: 10, clean: 18.4664, corrupted: 14.967, patched: 18.4751, share: 1.0024 }, 'number');
      expect(cell).toBe('L2: position 10, clean 18.47, corrupted 14.97, patched 18.48, share 100.2%');
      expect(formatValue({ layer: 9, head: 9 }, 'number')).toBe('L9H9');
      expect(formatValue([{ part: 'L9H9', contribution: 1.234 }, { part: 'MLP 9', contribution: -0.5 }], 'number')).toBe('L9H9 contribution 1.23, MLP 9 contribution -0.50');
    });
  });
});
