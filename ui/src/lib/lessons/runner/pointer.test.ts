import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { GLYPHS, direction, planPointer, planSequence, type PointerEnv } from './pointer';
import { lookTargets, renderProse, looksIn } from '../render';
import type { AnchorDef } from '../registry/contract';
import type { RectLike } from '../../popup/place';
import { lessonSource, makeKit } from './test-kit';

afterEach(() => vi.unstubAllGlobals());

type Fake = { id: string; rect: RectLike | null; inside?: boolean };
const el = (f: Fake) => f as unknown as HTMLElement;

function envFor(side: 'left' | 'right', anchors: Record<string, AnchorDef>, extra: Partial<PointerEnv> = {}): PointerEnv {
  const sidebar: RectLike = side === 'right' ? { left: 900, top: 44, width: 380, height: 756 } : { left: 0, top: 44, width: 380, height: 756 };
  return {
    anchors,
    side,
    sidebar,
    rectOf: (e) => (e as unknown as Fake).rect,
    inSidebar: (e) => (e as unknown as Fake).inside === true,
    ...extra,
  };
}

const anchor = (f: Fake | null, more: Partial<AnchorDef> = {}): AnchorDef => ({ doc: 'x', label: 'the thing', locate: () => (f ? el(f) : null), ...more });

describe('pointer', () => {
  it('› an arrow only within 160px', () => {
    const near = anchor({ id: 'near', rect: { left: 800, top: 300, width: 60, height: 30 } });
    const far = anchor({ id: 'far', rect: { left: 100, top: 300, width: 60, height: 30 } });
    const env = envFor('right', { near, far });
    const a = planPointer({ anchor: 'near' }, env);
    const b = planPointer({ anchor: 'far' }, env);
    expect(a?.kind === 'ring' && a.arrow).toBeTruthy();
    if (a?.kind === 'ring' && a.arrow) expect(Math.hypot(a.arrow.to.x - a.arrow.from.x, a.arrow.to.y - a.arrow.from.y)).toBeLessThanOrEqual(160);
    expect(b?.kind).toBe('ring');
    expect(b?.kind === 'ring' && b.arrow).toBe(null); // ring + tick, no long arrow
  });

  it('› the tick sits on the inner edge, both sides', () => {
    const t = anchor({ id: 't', rect: { left: 500, top: 400, width: 100, height: 40 } });
    const right = planPointer({ anchor: 't' }, envFor('right', { t }));
    const left = planPointer({ anchor: 't' }, envFor('left', { t }));
    expect(right?.kind === 'ring' && right.tick).toMatchObject({ x: 900, edge: 'left', y: 420 });
    expect(left?.kind === 'ring' && left.tick).toMatchObject({ x: 380, edge: 'right', y: 420 });
  });

  it('› the glyph shows the direction', () => {
    expect(direction({ x: 900, y: 400 }, { x: 500, y: 400 })).toBe('w');
    expect(direction({ x: 900, y: 400 }, { x: 500, y: 60 })).toBe('nw');
    expect(direction({ x: 380, y: 400 }, { x: 900, y: 700 })).toBe('se');
    const t = anchor({ id: 't', rect: { left: 820, top: 0, width: 40, height: 20 } });
    const p = planPointer({ anchor: 't' }, envFor('right', { t }));
    expect(p?.kind === 'ring' && p.tick.glyph).toBe(GLYPHS.nw);
  });

  it('› a hidden anchor offers "Open it" through its reveal', () => {
    const hidden = anchor(null, { label: 'the Why (DLA) chart, left side', reveal: { action: 'open_panel', args: { panel: 'dla' } } });
    const p = planPointer({ anchor: 'dla-waterfall' }, envFor('right', { 'dla-waterfall': hidden }));
    expect(p).toEqual({ kind: 'hidden', anchor: 'dla-waterfall', label: 'the Why (DLA) chart, left side', reveal: { action: 'open_panel', args: { panel: 'dla' } } });
  });

  it('› a sequence keeps each highlight and the last is active', async () => {
    const a = anchor({ id: 'a', rect: { left: 100, top: 100, width: 10, height: 10 } });
    const b = anchor({ id: 'b', rect: { left: 200, top: 200, width: 10, height: 10 } });
    const seq = planSequence([{ anchor: 'a' }, { anchor: 'b' }], envFor('right', { a, b }));
    expect(seq.plans.map((p) => p?.kind)).toEqual(['ring', 'ring']);
    expect(seq.active).toBe(1);
    // The runner hands a sequence to the presenter in order.
    const kit = makeKit();
    await kit.runner.open(
      lessonSource(`---\nformat: 1\nid: pry.fixture-look\ntitle: "Look"\ntool: pry\nsummary: "s"\nminutes: 1\n---\n\n## One {id=one}\n\n:::explain\nSee :look{at=[run-button, predictions-panel]}[these two].\n:::\n`),
      { source: { kind: 'bundled' } },
    );
    expect(kit.presenter.pointers).toEqual([{ anchor: 'run-button' }, { anchor: 'predictions-panel' }]);
  });

  it('› points at one bar by token', () => {
    const nodes = renderProse(':look{at=prediction-bar token=" one"}[the bar]', { slot: () => null, earlier: () => ({ text: '', state: 'missing' }) });
    const [targets] = looksIn(nodes);
    expect(targets).toEqual([{ anchor: 'prediction-bar', args: { token: ' one' } }]);
    const seen: unknown[] = [];
    const bar = anchor(null, {
      locate: (args) => {
        seen.push(args);
        return el({ id: 'bar', rect: { left: 700, top: 200, width: 120, height: 14 } });
      },
    });
    const p = planPointer(targets[0], envFor('right', { 'prediction-bar': bar }));
    expect(seen).toEqual([{ token: ' one' }]);
    expect(p?.kind).toBe('ring');
    expect(lookTargets({ at: 'head-cell', layer: '9', head: '9' })).toEqual([{ anchor: 'head-cell', args: { layer: 9, head: 9 } }]);
  });

  it('› points at a compare row in the sidebar', () => {
    const row = el({ id: 'row', rect: { left: 920, top: 300, width: 300, height: 80 }, inside: true });
    const p = planPointer({ runner: 'lesson:step:two-lists' }, envFor('right', {}, { runnerEl: (kind, id) => (kind === 'step' && id === 'two-lists' ? row : null) }));
    expect(p).toEqual({ kind: 'in-place', target: 'step', id: 'two-lists', el: row });
    // A tool anchor that sits inside the sidebar (the embedding reader) also takes the in-place highlight.
    const view = anchor({ id: 'view', rect: { left: 920, top: 400, width: 300, height: 120 }, inside: true });
    expect(planPointer({ anchor: 'embedding-view' }, envFor('right', { 'embedding-view': view }))?.kind).toBe('in-place');
  });

  it('› lesson:spine highlights the strip without an arrow', () => {
    const strip = el({ id: 'spine', rect: { left: 910, top: 80, width: 360, height: 24 }, inside: true });
    const p = planPointer({ runner: 'lesson:spine', args: { box: 'training' } }, envFor('right', {}, { runnerEl: () => strip }));
    expect(p).toEqual({ kind: 'in-place', target: 'spine', id: 'training', el: strip });
    expect('arrow' in (p as object)).toBe(false);
    expect('tick' in (p as object)).toBe(false);
  });
});
