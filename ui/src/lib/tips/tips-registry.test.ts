import { describe, it, expect } from 'vitest';
import { tipsRegistry } from './tips-registry';
import { tourChapters } from '../tutorial/tour-steps';
import registrySource from './tips-registry.ts?raw';

// Every .svelte source file under src/, as raw text.
const svelteSources = Object.values(
  import.meta.glob('/src/**/*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >,
);

// Anchors that only render when a panel gets showTokenStrip={true}, which no layout does.
const HIDDEN_ANCHORS = new Set(['panel-a-token-strip', 'panel-b-token-strip']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('tipsRegistry', () => {
  it('every tip has a non-empty why', () => {
    for (const tip of tipsRegistry) expect(tip.why?.trim(), tip.id).toBeTruthy();
  });

  it('every tip anchor exists in a rendered component', () => {
    for (const tip of tipsRegistry) {
      const m = tip.target.match(/^\[data-(tip|tour)="([^"]+)"\]$/);
      expect(m, `${tip.id} target is a data-tip/data-tour selector`).not.toBeNull();
      const [, attr, value] = m!;
      expect(HIDDEN_ANCHORS.has(value), `${tip.id} uses a hidden anchor`).toBe(false);
      const v = escapeRe(value);
      // data-tip="x", or data-tip={cond ? 'x' : undefined}
      const re = new RegExp(`data-${attr}=(?:"${v}"|\\{[^}]*'${v}'[^}]*\\})`);
      expect(
        svelteSources.some((src) => re.test(src)),
        `${tip.id}: no component renders data-${attr}="${value}"`,
      ).toBe(true);
    }
  });

  it('tip ids are unique', () => {
    const ids = tipsRegistry.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tutorialStepId names a real tour step', () => {
    const stepIds = new Set(tourChapters.flatMap((c) => c.steps.map((s) => s.id)));
    for (const tip of tipsRegistry) {
      if (tip.tutorialStepId) expect(stepIds.has(tip.tutorialStepId), tip.id).toBe(true);
    }
  });

  // code:F. Comments named the removed `drivenSteps` and old step numbers.
  it('comments do not cite the old tour', () => {
    expect(registrySource).not.toMatch(/drivenSteps/);
    expect(registrySource).not.toMatch(/steps? \d\.\d/i);
  });
});
