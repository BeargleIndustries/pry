// Language-neutral request key (plan T2, R3-12): SHA-256 (lowercase hex) of the
// UTF-8 canonical JSON of {endpoint, model: <preset id>, body}.
//
// Canonical JSON:
// - object keys sorted by Unicode code point; no whitespace;
// - strings escaped only as JSON requires (", \, control characters below
//   U+0020 as \b \f \n \r \t or \u00xx lowercase); non-ASCII written raw;
// - integral numbers (including 1.0 and -0) as plain integer digits;
// - other finite numbers in shortest round-trip form, laid out the way
//   ECMAScript Number::toString does (e.g. 0.00001, 1e-7, 1.5e-10);
// - null kept; absent (undefined) keys omitted; NaN and Infinity rejected.
//
// sidecar/tests/fixtures/request-keys.json holds vectors computed by an
// independent Python reference; request-key.test.ts and the sidecar's
// test_request_key.py both reproduce every vector.

export interface KeyedRequest {
  endpoint: string;
  /** Preset id, e.g. 'gpt2-small'. */
  model: string;
  body: unknown;
}

function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const d = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (d !== 0) return d;
  }
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`request key: non-finite number ${n}`);
  if (Number.isInteger(n)) return BigInt(n).toString();
  return String(n);
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalNumber(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort(compareCodePoints);
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`request key: unsupported value of type ${typeof value}`);
  }
}

export function canonicalRequest(req: KeyedRequest): string {
  return canonicalJson({ endpoint: req.endpoint, model: req.model, body: req.body });
}

export async function requestKey(req: KeyedRequest): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRequest(req));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
