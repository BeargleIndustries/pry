import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { lessonFile, makeKit, send } from './test-kit';
import { pryUi } from '../registry/pry-state.svelte';
import { pryReadouts } from '../registry/pry-readouts';

afterEach(() => vi.unstubAllGlobals());

const P25 = 'fixtures/outline-coverage/P2.5.md';

async function atGuess() {
  const kit = makeKit();
  await kit.runner.open(lessonFile(P25), { source: { kind: 'bundled' }, sectionId: 's3-5' });
  return kit;
}

describe('hide until predict', () => {
  it('› hides lift on commit', async () => {
    const kit = await atGuess();
    expect(pryUi.hidden['feature-labels']).toBe(true);
    expect(kit.runner.hide.hidden).toEqual(['feature-labels']);
    await send(kit, { type: 'answer', step: 'label-guess', choice: 0 });
    expect(pryUi.hidden['feature-labels']).toBe(false);
    // The drift chip doesn't count the runner's own reveal as a change.
    expect(kit.runner.render().drift).toBe(false);
  });

  it('› hides lift on just-show-me', async () => {
    const kit = await atGuess();
    expect(pryUi.hidden['feature-labels']).toBe(true);
    await send(kit, { type: 'skip', step: 'label-guess' });
    expect(pryUi.hidden['feature-labels']).toBe(false);
  });

  it('› feature labels stay hidden in every view until reveal', async () => {
    const kit = await atGuess();
    await kit.host.analysis.generate(kit.host.page.prompt);
    await send(kit, { type: 'do', step: 'open-card' });
    // Still hidden after the section's own step ran, in every readout that carries a label.
    expect(pryUi.hidden['feature-labels']).toBe(true);
    expect(pryReadouts['features.label'].read({ id: 100 })).toBeUndefined();
    const top = pryReadouts['features.top'].read({ n: 2 }) as { label?: string }[];
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((f) => f.label === undefined)).toBe(true);
    await send(kit, { type: 'answer', step: 'label-guess', choice: 1 });
    const shown = pryReadouts['features.top'].read({ n: 2 }) as { id: number; label?: string }[];
    expect(shown.some((f) => typeof f.label === 'string')).toBe(true);
    expect(pryReadouts['features.label'].read({ id: shown.find((f) => f.label)!.id })).toBeTypeOf('string');
    // Leaving the section reveals anything still hidden.
    const k2 = await atGuess();
    await k2.runner.goto(k2.runner.sectionIndex('s3-6'));
    expect(pryUi.hidden['feature-labels']).not.toBe(true);
  });
});
