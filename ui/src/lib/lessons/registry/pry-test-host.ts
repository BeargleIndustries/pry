// Test harness for the Pry registry (tests only): pry-walk-host.ts's page host and
// canned sidecar, with vitest spies on switchModel and openLink, and a recording
// fetch. Each test file mocks '@tauri-apps/api/core' (as sidecar-client.test.ts
// does) before importing it.

import { vi } from 'vitest';
import { answer, makeWalkHost, type Recorded, type WalkHost } from './pry-walk-host';
import type { PryHost } from './pry-state.svelte';

export { answer, fakeTokens, type Recorded } from './pry-walk-host';

/** Stubs the global fetch with the canned sidecar; returns the call log. */
export function recordingFetch(): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const endpoint = new URL(url).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ endpoint, body });
      return new Response(JSON.stringify(answer(endpoint, body)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

export interface TestHost extends WalkHost {
  switchModel: ReturnType<typeof vi.fn> & PryHost['switchModel'];
  openLink: ReturnType<typeof vi.fn> & PryHost['openLink'];
}

/** A fresh page: gpt2-small loaded, nothing run. Binds itself as the Pry host. */
export function makeHost(prompt = 'I like the river bank'): TestHost {
  const host = makeWalkHost(prompt) as TestHost;
  host.switchModel = vi.fn(host.switchModel) as TestHost['switchModel'];
  host.openLink = vi.fn(host.openLink) as TestHost['openLink'];
  return host;
}

export const ctx = (signal: AbortSignal = new AbortController().signal) => ({ signal, wait: () => {} });
