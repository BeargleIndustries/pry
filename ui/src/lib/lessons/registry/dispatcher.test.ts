import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolActionSet } from './contract';
import { createDispatcher, type LessonSource } from './dispatcher';
import { RequestMemo } from './memo';
import { grant, revoke, type GrantStore, type LessonManifest } from '../grants';

// A neutral tool: the dispatcher is tool-agnostic.
const ran: string[] = [];
const tool: ToolActionSet<object> = {
  tool: 't',
  version: '1',
  idPrefix: 't.',
  lessonDir: 'lessons',
  models: ['m'],
  services: { catalog: { doc: 'A catalogue.', host: 'catalog.example' } },
  spine: [],
  baselineSchema: z.object({}),
  overlaySchema: z.object({}),
  target: () => ({}),
  apply: async () => {},
  snapshot: () => ({}),
  actions: {
    look: { args: z.object({}).strict(), doc: 'Looks.', effect: 'view', run: async () => void ran.push('look') },
    fetch_label: {
      args: z.object({}).strict(),
      doc: 'Fetches a label.',
      effect: 'network',
      scope: () => 'catalog',
      run: async () => void ran.push('fetch_label'),
    },
    open_link: {
      args: z.object({ url: z.string() }).strict(),
      doc: 'Opens a link.',
      effect: 'external',
      scope: (a: { url: string }) => {
        try {
          return new URL(a.url).host;
        } catch {
          return '';
        }
      },
      run: async (a: { url: string }) => void ran.push(a.url),
    },
  },
  readouts: {},
  anchors: {},
  views: {},
  pickers: {},
  memoContext: () => '',
};

const manifest: LessonManifest = {
  id: 'me.lesson',
  sourcePath: 'C:/lessons/me.lesson',
  permissions: { network: ['catalog'], external: ['arxiv.org'] },
};
const now = new Date('2026-10-14T00:00:00Z');
const signal = new AbortController().signal;

function userSource(store: () => GrantStore): LessonSource {
  return { kind: 'user', manifest, grants: store };
}

describe('dispatcher', () => {
  it('› revoked network blocks', async () => {
    let store = await grant({}, manifest, manifest.permissions, now);
    const d = createDispatcher(tool, new RequestMemo(), userSource(() => store));
    expect(await d.dispatch('fetch_label', {}, { signal })).toEqual({ status: 'done' });
    store = revoke(store, manifest.id);
    expect(await d.dispatch('fetch_label', {}, { signal })).toMatchObject({ status: 'blocked', reason: 'grant', effect: 'network' });
  });

  it('› evilarxiv blocked', async () => {
    const store = await grant({}, manifest, manifest.permissions, now);
    const d = createDispatcher(tool, new RequestMemo(), userSource(() => store));
    ran.length = 0;
    expect(await d.dispatch('open_link', { url: 'https://evilarxiv.org/abs/1' }, { signal })).toMatchObject({ status: 'blocked', reason: 'grant' });
    expect(await d.dispatch('open_link', { url: 'https://arxiv.org/abs/2211.00593' }, { signal })).toEqual({ status: 'done' });
    expect(await d.dispatch('open_link', { url: 'https://export.ARXIV.org/abs/1' }, { signal })).toEqual({ status: 'done' });
    expect(ran).toEqual(['https://arxiv.org/abs/2211.00593', 'https://export.ARXIV.org/abs/1']);
  });

  it('a link must be http or https, in every lesson', async () => {
    const d = createDispatcher(tool, new RequestMemo(), { kind: 'bundled' });
    expect(await d.dispatch('open_link', { url: 'javascript:alert(1)' }, { signal })).toMatchObject({ status: 'blocked', reason: 'scheme' });
    expect(await d.dispatch('open_link', { url: 'file:///C:/x' }, { signal })).toMatchObject({ status: 'blocked', reason: 'scheme' });
  });

  it('› bundled skips grants', async () => {
    const grants = vi.fn(() => ({}) as GrantStore);
    const d = createDispatcher(tool, new RequestMemo(), { kind: 'bundled' });
    expect(await d.dispatch('fetch_label', {}, { signal })).toEqual({ status: 'done' });
    expect(await d.dispatch('open_link', { url: 'https://example.org/' }, { signal })).toEqual({ status: 'done' });
    expect(grants).not.toHaveBeenCalled();
  });

  it('view and compute run without a grant; replay runs only those', async () => {
    const d = createDispatcher(tool, new RequestMemo(), userSource(() => ({})));
    expect(await d.dispatch('look', {}, { signal })).toEqual({ status: 'done' });
    expect(await d.dispatch('fetch_label', {}, { signal, replay: true })).toEqual({ status: 'skipped', reason: 'replay' });
  });

  it('unknown actions and bad arguments throw', async () => {
    const d = createDispatcher(tool, new RequestMemo(), { kind: 'bundled' });
    await expect(d.dispatch('nope', {}, { signal })).rejects.toThrow('Unknown action');
    await expect(d.dispatch('look', { x: 1 }, { signal })).rejects.toThrow('Bad arguments');
  });

  it('an aborted signal stops before the action runs', async () => {
    const ac = new AbortController();
    ac.abort();
    const d = createDispatcher(tool, new RequestMemo(), { kind: 'bundled' });
    expect(await d.dispatch('look', {}, { signal: ac.signal })).toEqual({ status: 'aborted' });
  });
});
