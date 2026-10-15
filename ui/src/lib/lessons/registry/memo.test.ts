import { describe, expect, it, vi } from 'vitest';
import { MEMO_MAX_BYTES, MEMO_MAX_ENTRIES, RequestMemo, isUnseededSampling, memoKey } from './memo';

const req = (body: unknown, memoContext = 'sae:8') => ({
  endpoint: '/generate',
  model: 'gpt2-small',
  body,
  memoContext,
});

describe('request memo', () => {
  it('defaults to 64 entries and 256 MB', () => {
    const m = new RequestMemo();
    expect(m.maxEntries).toBe(64);
    expect(m.maxBytes).toBe(256 * 1024 * 1024);
    expect(MEMO_MAX_ENTRIES).toBe(64);
    expect(MEMO_MAX_BYTES).toBe(268435456);
  });

  it('a second identical runner call makes no fetch', async () => {
    const m = new RequestMemo();
    const fetcher = vi.fn(async () => ({ ok: 1 }));
    await m.call(req({ prompt: 'a' }), fetcher);
    expect(await m.call(req({ prompt: 'a' }), fetcher)).toEqual({ ok: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry past 64 entries', () => {
    const m = new RequestMemo();
    for (let i = 0; i < 64; i++) m.set(`k${i}`, i);
    m.get('k0'); // k0 becomes most recent, so k1 is the oldest
    m.set('k64', 64);
    expect(m.size).toBe(64);
    expect(m.has('k0')).toBe(true);
    expect(m.has('k1')).toBe(false);
    expect(m.has('k64')).toBe(true);
  });

  it('evicts by bytes past 256 MB', () => {
    const MB = 1024 * 1024;
    const m = new RequestMemo({ sizeOf: (v) => (v as { mb: number }).mb * MB });
    m.set('a', { mb: 100 });
    m.set('b', { mb: 100 });
    expect(m.bytes).toBe(200 * MB);
    m.set('c', { mb: 100 });
    expect(m.has('a')).toBe(false);
    expect(m.has('b')).toBe(true);
    expect(m.has('c')).toBe(true);
    expect(m.bytes).toBe(200 * MB);
    m.set('huge', { mb: 300 });
    expect(m.has('huge')).toBe(false);
    expect(m.bytes).toBeLessThanOrEqual(256 * MB);
  });

  it('is cleared on model load', async () => {
    const m = new RequestMemo();
    const fetcher = vi.fn(async () => 1);
    await m.call(req({ prompt: 'a' }), fetcher);
    m.onModelLoad();
    expect(m.size).toBe(0);
    expect(m.bytes).toBe(0);
    await m.call(req({ prompt: 'a' }), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never memoises unseeded sampling', async () => {
    const m = new RequestMemo();
    const fetcher = vi.fn(async () => 'text');
    const body = { prompt: 'Once', temperature: 0.8 };
    await m.call(req(body), fetcher);
    await m.call(req(body), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(m.size).toBe(0);
    expect(isUnseededSampling({ temperature: 0.8, seed: null })).toBe(true);
    expect(isUnseededSampling({ temperature: 0.8, seed: 3 })).toBe(false);
    expect(isUnseededSampling({ temperature: 0 })).toBe(false);
  });

  it('memoises seeded sampling', async () => {
    const m = new RequestMemo();
    const fetcher = vi.fn(async () => 'text');
    const body = { prompt: 'Once', temperature: 0.8, seed: 1 };
    await m.call(req(body), fetcher);
    await m.call(req(body), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('key differs by memoContext', async () => {
    expect(memoKey('k', 'rev', 'sae:8')).not.toBe(memoKey('k', 'rev', 'sae:9'));
    const m = new RequestMemo();
    const fetcher = vi.fn(async () => 1);
    await m.call(req({ prompt: 'a' }, 'sae:8'), fetcher);
    await m.call(req({ prompt: 'a' }, 'sae:9'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('key differs by model revision', () => {
    expect(memoKey('k', 'rev1', 'c')).not.toBe(memoKey('k', 'rev2', 'c'));
    expect(memoKey('k', undefined, 'c')).toBe(memoKey('k', null, 'c'));
  });

  it('a fresh call fetches on a memoised key and stores the new result', async () => {
    const m = new RequestMemo();
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    await m.call(req({ prompt: 'a' }), fetcher);
    expect(await m.call({ ...req({ prompt: 'a' }), fresh: true }, fetcher)).toBe(2);
    expect(await m.call(req({ prompt: 'a' }), fetcher)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
