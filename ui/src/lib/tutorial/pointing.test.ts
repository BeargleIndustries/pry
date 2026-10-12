import { describe, expect, it } from 'vitest';
import { tourChapters, targetLabels } from './tour-steps';
import { tipsRegistry } from '../tips/tips-registry';

// Every popup has to say what it's pointing at, in words, not just by position.
describe('popups name what they point at', () => {
  it('every tour target has a "Look at" label', () => {
    const targets = tourChapters.flatMap((c) => c.steps.map((s) => s.target)).filter((t): t is string => !!t);
    for (const t of targets) expect(targetLabels[t], t).toBeTruthy();
  });

  it('every first-time tip has a title', () => {
    for (const tip of tipsRegistry) expect(tip.title?.trim(), tip.id).toBeTruthy();
  });
});
