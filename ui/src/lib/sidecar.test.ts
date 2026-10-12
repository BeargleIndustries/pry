import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ENGINE_NOT_RUNNING,
  _setConnectionRetryForTests,
  health,
  loadPreset,
  realWeightsVerified,
  sidecarFetch,
} from './sidecar';

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('X-Pry-Token');
}

describe('sidecar client under Tauri', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    _setConnectionRetryForTests(2, 0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { window?: unknown }).window;
  });

  it('sends X-Pry-Token and caches the connection pair', async () => {
    invokeMock.mockResolvedValue({ base_url: 'http://127.0.0.1:50001', token: 'tok-a' });
    fetchMock.mockImplementation(async () => json({ status: 'ok', version: '0.2.0' }));

    await health();
    await health();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('sidecar_connection');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:50001/health');
    expect(tokenOf(fetchMock.mock.calls[0][1])).toBe('tok-a');
  });

  it('on 403 re-fetches the pair once and retries once', async () => {
    invokeMock
      .mockResolvedValueOnce({ base_url: 'http://127.0.0.1:50001', token: 'stale' })
      .mockResolvedValueOnce({ base_url: 'http://127.0.0.1:50002', token: 'fresh' });
    fetchMock
      .mockResolvedValueOnce(json({ error: "Pry's engine rejected the request (bad token)." }, 403))
      .mockResolvedValueOnce(json({ status: 'ok', version: '0.2.0' }));

    const res = await sidecarFetch('/health');

    expect(res.status).toBe(200);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenOf(fetchMock.mock.calls[0][1])).toBe('stale');
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:50002/health');
    expect(tokenOf(fetchMock.mock.calls[1][1])).toBe('fresh');
  });

  it('does not loop when the retry is also a 403', async () => {
    invokeMock.mockResolvedValue({ base_url: 'http://127.0.0.1:50001', token: 'tok' });
    fetchMock.mockImplementation(async () =>
      json({ error: "Pry's engine rejected the request (bad token)." }, 403),
    );

    await expect(health()).rejects.toThrow(/bad token/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never falls back to :8765 when the engine is not running', async () => {
    invokeMock.mockRejectedValue({ kind: 'Sidecar', detail: 'not running' });

    await expect(health()).rejects.toThrow(ENGINE_NOT_RUNNING);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('subscribes to crash/restart events to invalidate the pair', async () => {
    invokeMock.mockResolvedValue({ base_url: 'http://127.0.0.1:50001', token: 'tok' });
    fetchMock.mockImplementation(async () => json({ status: 'ok', version: '0.2.0' }));
    await health();
    const events = listenMock.mock.calls.map((c) => c[0]);
    expect(events).toContain('sidecar:crashed');
    expect(events).toContain('sidecar:restarted');
  });

  function sse(events: object[]): Response {
    const body = events.map((e) => `data: ${JSON.stringify(e)}

`).join('');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  it('loadPreset rejects when the stream ends without ready', async () => {
    invokeMock.mockResolvedValue({ base_url: 'http://127.0.0.1:50001', token: 'tok' });
    fetchMock.mockImplementation(async () =>
      sse([{ stage: 'load_model', message: 'Loading', progress: 0.5 }]),
    );
    const seen: string[] = [];
    await expect(loadPreset('gpt2-small', (ev) => seen.push(ev.stage))).rejects.toThrow('load ended early');
    expect(seen).toEqual(['load_model']);
  });

  it('loadPreset resolves on ready', async () => {
    invokeMock.mockResolvedValue({ base_url: 'http://127.0.0.1:50001', token: 'tok' });
    fetchMock.mockImplementation(async () =>
      sse([{ stage: 'load_model', message: 'Loading', progress: 0.5 }, { stage: 'ready', message: 'Ready', progress: 1 }]),
    );
    await expect(loadPreset('gpt2-small', () => {})).resolves.toBeUndefined();
  });
});

describe('realWeightsVerified', () => {
  it('treats a missing field as verified and only false as unverified', () => {
    expect(realWeightsVerified({})).toBe(true);
    expect(realWeightsVerified(null)).toBe(true);
    expect(realWeightsVerified({ real_weights_verified: true })).toBe(true);
    expect(realWeightsVerified({ real_weights_verified: false })).toBe(false);
  });
});
