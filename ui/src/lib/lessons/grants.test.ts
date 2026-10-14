import { describe, expect, it } from 'vitest';
import { grant, grantStatus, hashPermissions, isAllowed, reconcile, type LessonManifest } from './grants';

const now = new Date('2026-10-13T12:00:00Z');
const base: LessonManifest = {
  id: 'my.lesson',
  sourcePath: 'C:/app/lessons/my.lesson',
  permissions: { download: ['gpt2-medium'], network: ['neuronpedia'] },
};

describe('lesson grants', () => {
  it('› grant stored by id + path + hash', async () => {
    expect(grantStatus({}, base)).toEqual({
      status: 'ask',
      ask: { download: ['gpt2-medium'], network: ['neuronpedia'] },
      granted: {},
    });
    const store = await grant({}, base, base.permissions, now);
    expect(store['my.lesson']).toEqual({
      sourcePath: base.sourcePath,
      permissionsHash: await hashPermissions(base.permissions),
      granted: { download: ['gpt2-medium'], network: ['neuronpedia'] },
      grantedAt: now.toISOString(),
    });
    expect(grantStatus(store, base).status).toBe('granted');
    expect(isAllowed(store, base, 'network', 'neuronpedia')).toBe(true);
    expect(isAllowed(store, base, 'external', 'arxiv.org')).toBe(false);
  });

  it('› changed manifest re-asks only new entries', async () => {
    const store = await grant({}, base, base.permissions, now);
    const changed = { ...base, permissions: { ...base.permissions, external: ['arxiv.org'] } };
    const st = grantStatus(store, changed);
    expect(st).toEqual({
      status: 'ask',
      ask: { external: ['arxiv.org'] },
      granted: { download: ['gpt2-medium'], network: ['neuronpedia'] },
    });
    const after = await grant(store, changed, { external: ['arxiv.org'] }, now);
    expect(grantStatus(after, changed).status).toBe('granted');
  });

  it('› removed entries drop', async () => {
    const store = await grant({}, base, base.permissions, now);
    const fewer = { ...base, permissions: { network: ['neuronpedia'] } };
    expect(grantStatus(store, fewer)).toEqual({ status: 'granted', granted: { network: ['neuronpedia'] } });
    const after = await reconcile(store, fewer, now);
    expect(after['my.lesson'].granted).toEqual({ network: ['neuronpedia'] });
    expect(after['my.lesson'].permissionsHash).toBe(await hashPermissions(fewer.permissions));
    // Re-adding the dropped entry asks again.
    expect(grantStatus(after, base)).toMatchObject({ status: 'ask', ask: { download: ['gpt2-medium'] } });
  });

  it('› same id from another folder gets nothing', async () => {
    const store = await grant({}, base, base.permissions, now);
    const other = { ...base, sourcePath: 'C:/app/lessons/somewhere-else' };
    expect(grantStatus(store, other)).toEqual({ status: 'other-folder', granted: {} });
    expect(isAllowed(store, other, 'network', 'neuronpedia')).toBe(false);
    expect(await grant(store, other, other.permissions, now)).toBe(store);
  });
});
