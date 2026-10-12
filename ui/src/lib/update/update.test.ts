import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_CHECK_KEY,
  SKIPPED_VERSION_KEY,
  autoCheckEnabled,
  compareVersions,
  formatMb,
  notesExcerpt,
  setAutoCheck,
  shouldOffer,
  skipVersion,
  skippedVersion,
  type KV,
} from './update-core';
import { UpdateState, type DownloadEvent, type UpdateDeps, type UpdateHandle } from './update-store.svelte';
import { UPDATE_COPY } from './update-copy';

class MemoryStorage implements KV {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

class ThrowingStorage implements KV {
  getItem(): string | null {
    throw new Error('denied');
  }
  setItem(): void {
    throw new Error('denied');
  }
  removeItem(): void {
    throw new Error('denied');
  }
}

function fakeUpdate(version = '0.3.7', over: Partial<UpdateHandle> = {}): UpdateHandle {
  return {
    version,
    currentVersion: '0.3.6',
    body: '## 0.3.7\n- Faster loading\n- Fixes',
    async download(onEvent?: (e: DownloadEvent) => void) {
      onEvent?.({ event: 'Started', data: { contentLength: 3 * 1024 * 1024 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 1024 * 1024 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 2 * 1024 * 1024 } });
      onEvent?.({ event: 'Finished' });
    },
    install: vi.fn(async () => {}),
    ...over,
  };
}

function makeDeps(over: Partial<UpdateDeps> = {}): UpdateDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    check: vi.fn(async () => fakeUpdate()),
    currentVersion: async () => '0.3.6',
    stopSidecar: vi.fn(async () => {
      calls.push('stop');
    }),
    restartSidecar: vi.fn(async () => {
      calls.push('restart');
    }),
    relaunch: vi.fn(async () => {
      calls.push('relaunch');
    }),
    storage: new MemoryStorage(),
    warn: vi.fn(),
    ...over,
  };
}

describe('compareVersions', () => {
  it('orders plain semver', () => {
    expect(compareVersions('0.3.7', '0.3.6')).toBe(1);
    expect(compareVersions('0.3.6', '0.3.7')).toBe(-1);
    expect(compareVersions('0.3.6', '0.3.6')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
  });

  it('accepts a leading v and puts pre-releases before the release', () => {
    expect(compareVersions('v0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.4.0-alpha', '0.4.0')).toBe(-1);
    expect(compareVersions('0.4.0', '0.4.0-alpha')).toBe(1);
    expect(compareVersions('0.4.0-alpha.2', '0.4.0-alpha.10')).toBe(-1);
    expect(compareVersions('0.4.0-beta', '0.4.0-alpha')).toBe(1);
  });

  it('treats garbage as equal so it never prompts', () => {
    expect(compareVersions('latest', '0.3.6')).toBe(0);
    expect(shouldOffer('nonsense', '0.3.6', null)).toBe(false);
  });
});

describe('preferences', () => {
  it('auto-check defaults on and persists off/on', () => {
    const kv = new MemoryStorage();
    expect(autoCheckEnabled(kv)).toBe(true);
    setAutoCheck(kv, false);
    expect(kv.getItem(AUTO_CHECK_KEY)).toBe('false');
    expect(autoCheckEnabled(kv)).toBe(false);
    setAutoCheck(kv, true);
    expect(autoCheckEnabled(kv)).toBe(true);
  });

  it('skip-version is remembered and cleared', () => {
    const kv = new MemoryStorage();
    expect(skippedVersion(kv)).toBeNull();
    skipVersion(kv, '0.3.7');
    expect(kv.getItem(SKIPPED_VERSION_KEY)).toBe('0.3.7');
    expect(shouldOffer('0.3.7', '0.3.6', skippedVersion(kv))).toBe(false);
    expect(shouldOffer('0.3.8', '0.3.6', skippedVersion(kv))).toBe(true);
    skipVersion(kv, null);
    expect(skippedVersion(kv)).toBeNull();
  });

  it('survives storage that throws', () => {
    const kv = new ThrowingStorage();
    expect(autoCheckEnabled(kv)).toBe(true);
    expect(() => setAutoCheck(kv, false)).not.toThrow();
    expect(skippedVersion(kv)).toBeNull();
    expect(() => skipVersion(kv, '1.0.0')).not.toThrow();
    expect(autoCheckEnabled(null)).toBe(true);
  });

  it('never offers an older or equal version', () => {
    expect(shouldOffer('0.3.6', '0.3.6', null)).toBe(false);
    expect(shouldOffer('0.3.5', '0.3.6', null)).toBe(false);
  });
});

describe('notesExcerpt / formatMb', () => {
  it('keeps short lines: bold lead-ins, first sentences, no headings', () => {
    const r = notesExcerpt(
      '### New\n\n- **Loading screen.** Loading a model can take a minute.\n* Fix `x` in the lens. It was wrong before.\n### Fixed\n- three\n- four',
      3,
    );
    expect(r.lines).toEqual(['Loading screen', 'Fix x in the lens', 'three']);
    expect(r.more).toBe(true);
    expect(notesExcerpt(undefined)).toEqual({ lines: [], more: false });
    const long = notesExcerpt(`- ${'word '.repeat(60)}`).lines[0];
    expect(long.length).toBeLessThanOrEqual(110);
    expect(long.endsWith('…')).toBe(true);
  });

  it('formats megabytes', () => {
    expect(formatMb(1024 * 1024 * 12.34)).toBe('12.3');
    expect(formatMb(1024 * 1024 * 250)).toBe('250');
  });
});

describe('UpdateState', () => {
  it('startup check shows a newer version and announces it', async () => {
    const s = new UpdateState(makeDeps());
    await s.startupCheck();
    expect(s.phase).toBe('available');
    expect(s.info?.version).toBe('0.3.7');
    expect(s.visible).toBe(true);
    expect(s.announcement).toBe(UPDATE_COPY.announceFound('0.3.7'));
  });

  it('respects the auto-check toggle', async () => {
    const deps = makeDeps();
    const s = new UpdateState(deps);
    s.setAutoCheck(false);
    await s.startupCheck();
    expect(deps.check).not.toHaveBeenCalled();
    expect(s.visible).toBe(false);
    // a fresh instance reads the stored choice
    expect(new UpdateState(deps).autoCheck).toBe(false);
  });

  it('failures at startup are silent: no throw, nothing shown, console only', async () => {
    const deps = makeDeps({ check: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const s = new UpdateState(deps);
    await expect(s.startupCheck()).resolves.toBeUndefined();
    expect(s.phase).toBe('idle');
    expect(s.visible).toBe(false);
    expect(s.lastCheck.kind).toBe('idle');
    expect(deps.warn).toHaveBeenCalledOnce();
  });

  it('a 404 / no manifest is treated like any other failure', async () => {
    const s = new UpdateState(makeDeps({ check: async () => { throw 'Could not fetch a valid release JSON from the remote'; } }));
    await s.startupCheck();
    expect(s.visible).toBe(false);
  });

  it('check now reports up to date, available and errors', async () => {
    const none = new UpdateState(makeDeps({ check: async () => null }));
    await none.checkNow();
    expect(none.lastCheck).toEqual({ kind: 'none', version: '0.3.6' });

    const found = new UpdateState(makeDeps());
    await found.checkNow();
    expect(found.lastCheck).toEqual({ kind: 'available', version: '0.3.7', skipped: false });

    const err = new UpdateState(makeDeps({ check: async () => { throw new Error('dns'); } }));
    await err.checkNow();
    expect(err.lastCheck).toEqual({ kind: 'error' });
  });

  it('skip hides the version now and on later checks, but not a newer one', async () => {
    const deps = makeDeps();
    const s = new UpdateState(deps);
    await s.startupCheck();
    s.skip();
    expect(s.visible).toBe(false);
    expect(deps.storage!.getItem(SKIPPED_VERSION_KEY)).toBe('0.3.7');

    const again = new UpdateState(deps);
    await again.startupCheck();
    expect(again.visible).toBe(false);
    await again.checkNow();
    expect(again.lastCheck).toEqual({ kind: 'available', version: '0.3.7', skipped: true });
    again.showSkipped();
    expect(again.visible).toBe(true);
    expect(deps.storage!.getItem(SKIPPED_VERSION_KEY)).toBeNull();

    deps.storage!.setItem(SKIPPED_VERSION_KEY, '0.3.7');
    const newer = new UpdateState({ ...deps, check: async () => fakeUpdate('0.3.8') });
    await newer.startupCheck();
    expect(newer.visible).toBe(true);
  });

  it('later hides for the session only', async () => {
    const deps = makeDeps();
    const s = new UpdateState(deps);
    await s.startupCheck();
    s.later();
    expect(s.visible).toBe(false);
    expect(deps.storage!.getItem(SKIPPED_VERSION_KEY)).toBeNull();
    const next = new UpdateState(deps);
    await next.startupCheck();
    expect(next.visible).toBe(true);
  });

  it('banner yields to a loading-screen card', async () => {
    const s = new UpdateState(makeDeps());
    await s.startupCheck();
    expect(s.showBanner).toBe(true);
    const release = s.registerLoadingHost();
    expect(s.showBanner).toBe(false);
    release();
    release();
    expect(s.loadingHosts).toBe(0);
    expect(s.showBanner).toBe(true);
  });

  it('install downloads with progress, stops the engine, then installs and relaunches', async () => {
    const update = fakeUpdate();
    const order: string[] = [];
    const deps = makeDeps({ check: async () => update });
    update.install = vi.fn(async () => {
      order.push(...deps.calls, 'install');
    });
    const s = new UpdateState(deps);
    await s.startupCheck();
    await s.install();
    expect(s.downloaded).toBe(3 * 1024 * 1024);
    expect(s.total).toBe(3 * 1024 * 1024);
    expect(order).toEqual(['stop', 'install']);
    expect(deps.calls).toEqual(['stop', 'relaunch']);
    expect(deps.restartSidecar).not.toHaveBeenCalled();
  });

  it('a failed download leaves the engine alone and shows an error', async () => {
    const deps = makeDeps({
      check: async () => fakeUpdate('0.3.7', { download: async () => { throw new Error('signature mismatch'); } }),
    });
    const s = new UpdateState(deps);
    await s.startupCheck();
    await s.install();
    expect(s.phase).toBe('error');
    expect(s.errorKind).toBe('download');
    expect(deps.stopSidecar).not.toHaveBeenCalled();
    s.later();
    expect(s.visible).toBe(false);
  });

  it('a failed install brings the engine back', async () => {
    const deps = makeDeps({
      check: async () => fakeUpdate('0.3.7', { install: async () => { throw new Error('installer blocked'); } }),
    });
    const s = new UpdateState(deps);
    await s.startupCheck();
    await s.install();
    expect(s.phase).toBe('error');
    expect(s.errorKind).toBe('install');
    expect(deps.calls).toEqual(['stop', 'restart']);
  });

  it('downloadOnly never installs and reports the error text', async () => {
    const ok = makeDeps();
    const a = new UpdateState(ok);
    await a.startupCheck();
    expect(await a.downloadOnly()).toBeNull();
    expect(a.phase).toBe('available');
    expect(ok.stopSidecar).not.toHaveBeenCalled();

    const bad = new UpdateState(
      makeDeps({ check: async () => fakeUpdate('0.3.7', { download: async () => { throw new Error('InvalidSignature'); } }) }),
    );
    await bad.startupCheck();
    expect(await bad.downloadOnly()).toContain('InvalidSignature');
  });
});

describe('copy', () => {
  it('has no em dashes', () => {
    const flat = JSON.stringify(
      Object.values(UPDATE_COPY).map((v) => (typeof v === 'function' ? (v as (...a: string[]) => string)('1.2.3', '4') : v)),
    );
    expect(flat).not.toMatch(/—/);
  });
});
