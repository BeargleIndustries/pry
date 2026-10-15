import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { tipsRegistry } from '../tips/tips-registry';
import { pryAnchors } from '../lessons/registry/pry-anchors';
import quickTour from '../../lessons/pry.quick-tour/lesson.md?raw';

// Every popup has to say what it's pointing at, in words, not just by position.
describe('popups name what they point at', () => {
  it('every quick-tour pointer names a labelled anchor', () => {
    const looks = [...quickTour.matchAll(/:look\{at=\[?([^\]}]+)\]?\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    expect(looks.length).toBeGreaterThan(10);
    for (const a of looks) expect((pryAnchors as Record<string, { label?: string }>)[a]?.label, a).toBeTruthy();
  });

  it('every first-time tip has a title', () => {
    for (const tip of tipsRegistry) expect(tip.title?.trim(), tip.id).toBeTruthy();
  });
});
