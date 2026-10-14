import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson, canonicalRequest, requestKey } from './request-key';

interface Vector {
  name: string;
  endpoint: string;
  model: string;
  body: unknown;
  canonical: string;
  key: string;
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../sidecar/tests/fixtures/request-keys.json', import.meta.url)), 'utf-8'),
) as { vectors: Vector[] };

describe('request key', () => {
  it('fixture holds 12 vectors', () => {
    expect(fixture.vectors).toHaveLength(12);
  });

  it('reproduces every vector in request-keys.json', async () => {
    for (const v of fixture.vectors) {
      const req = { endpoint: v.endpoint, model: v.model, body: v.body };
      expect(canonicalRequest(req), v.name).toBe(v.canonical);
      expect(await requestKey(req), v.name).toBe(v.key);
    }
  });

  it('omits absent keys and keeps null', () => {
    expect(canonicalJson({ b: undefined, a: null })).toBe('{"a":null}');
  });

  it('writes 1.0 and -0 as integers', () => {
    expect(canonicalJson([1.0, -0, 2.5])).toBe('[1,0,2.5]');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ t: Number.NaN })).toThrow();
    expect(() => canonicalJson({ t: Infinity })).toThrow();
  });

  it('sorts keys by code point, not UTF-16 unit', () => {
    expect(canonicalJson({ '\u{1F600}': 1, '￿': 2 })).toBe('{"￿":2,"\u{1F600}":1}');
  });
});
