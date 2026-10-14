// `npm run lessons:compile -- --rows` row constants (plan:297, :299): every
// `constants:` entry in verified-rows.yaml derives from its row's recorded
// values, and the committed rows.json holds exactly what the derivation gives.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveConstant, deriveRowConstants, ROWS_JSON, ROWS_YAML, withRowConstants } from '../../../scripts/lessons-compile';
import { constantsByRow } from './row-constants';

describe('lessons-compile --rows', () => {
  it('› row constants derive from recorded values and match the committed rows.json', () => {
    const yamlText = readFileSync(ROWS_YAML, 'utf8');
    const rowsText = readFileSync(ROWS_JSON, 'utf8');
    const derived = deriveRowConstants(yamlText, rowsText);
    expect(derived.size).toBeGreaterThan(0);
    const committed = constantsByRow(JSON.parse(rowsText));
    expect(committed, 'rows.json constants are stale: run `npm run lessons:compile -- --rows`').toEqual(
      Object.fromEntries([...derived].map(([id, c]) => [String(id), c])),
    );
    // Idempotent: writing them again changes nothing.
    expect(withRowConstants(rowsText, derived)).toBe(rowsText);
    // Spot checks against the recorded values.
    const values = new Map((JSON.parse(rowsText) as { rows: { id: number; values: any }[] }).rows.map((r) => [r.id, r.values]));
    expect(committed['23'].layer).toEqual({ value: 2, unit: 'layer' });
    expect(values.get(23).pick.head).toBe('L2H8');
    expect(committed['27'].peak_layer.value).toBe(values.get(27).peak[0].layer);
    expect(committed['14'].to_position.value).toBe(values.get(14).tokens - 1);
    // from_row reads another row's record: row 14's " Mary" head is row 47's.
    expect(values.get(47).head).toBe(`L${committed['14'].mary_head_layer.value}H${committed['14'].mary_head.value}`);
    expect(committed['26'].task_threshold.value).toBe(values.get(57).suggested_threshold / 100);
  });

  it('› each derivation reads the recorded value and refuses a missing one', () => {
    const values = {
      pick: { head: 'L10H7' },
      tokens: 15,
      top4: [[' Mary', 0.68, 18.5], [' them', 0.13, 16.8]],
      top3: [['L9.H6', 2.1], ['MLP.9', 1.8]],
      grid: [{ layer: 0, share: 0.9 }, { layer: 1, share: 0.3 }, { layer: 3, share: 0.25 }],
      word: 'rain',
    };
    const reqs = [{ name: 'river', action: 'embedding', positions: [5] }];
    const d = (spec: object) => deriveConstant(spec as never, values, reqs, 'row x').value;
    expect(d({ parse_head: 'pick.head', unit: 'record' })).toEqual({ layer: 10, head: 7 });
    expect(d({ parse_head: 'pick.head', take: 'layer', unit: 'layer' })).toBe(10);
    expect(d({ parse_head: 'top3.0.0', take: 'head', unit: 'head' })).toBe(6);
    expect(d({ last_position: 'tokens', unit: 'position' })).toBe(14);
    expect(d({ token_prob: 'top4', token: ' them', unit: 'probability' })).toBe(0.13);
    expect(d({ first_mlp_layer: 'top3', unit: 'layer' })).toBe(9);
    expect(d({ argmax: 'grid', by: 'share', exclude_layer: 0, take: 'layer', unit: 'layer' })).toBe(1);
    expect(d({ count: 'top4', unit: 'count' })).toBe(2);
    expect(d({ list: ['word'], unit: 'list', of: 'string' })).toEqual(['rain']);
    expect(d({ request: 'river.positions.0', unit: 'position' })).toBe(5);
    expect(d({ points: 'tokens', unit: 'probability' })).toBe(0.15);
    expect(d({ points: 'tokens', negate: true, unit: 'probability' })).toBe(-0.15);
    expect(() => d({ path: 'pick.layer', unit: 'layer' })).toThrow(/row x: no recorded value at `pick.layer`/);
    expect(() => d({ token_prob: 'top4', token: ' John', unit: 'probability' })).toThrow(/isn't in/);
    expect(() => d({ path: 'tokens', count: 'top4', unit: 'count' })).toThrow(/exactly one/);
    expect(() => d({ path: 'tokens', unit: 'inches' })).toThrow(/unit must be/);
  });
});
