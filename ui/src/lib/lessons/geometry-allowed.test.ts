import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { existsSync, readFileSync } from 'node:fs';
import { ALLOWED_FILE, allowedAdditions, allowedJson } from '../../../scripts/geometry-allowed';

describe('geometry allowed additions', () => {
  it('› scripts/dev/geometry-allowed-additions.json is generated from pry-anchors.ts and up to date', () => {
    expect(existsSync(ALLOWED_FILE)).toBe(true);
    expect(readFileSync(ALLOWED_FILE, 'utf-8').replace(/\r\n/g, '\n')).toBe(allowedJson());
  });

  it('holds lessons-toggle and the hideable regions, not the sidebar-only anchors', () => {
    const { allowed } = allowedAdditions();
    expect(allowed).toContain('lessons-toggle');
    for (const a of ['predictions-panel', 'patching-grid', 'feature-labels', 'steering-coherence', 'prediction-bar', 'head-cell']) expect(allowed).toContain(a);
    expect(allowed).not.toContain('embedding-view');
    expect(allowed).not.toContain('embedding-values');
  });
});
