import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { HIDEABLE_ANCHORS, pryAnchors } from './pry-anchors';
import { isHidden, pryUi } from './pry-state.svelte';
import { pryActions } from './pry-actions';
import { ctx, makeHost, recordingFetch } from './pry-test-host';

// A tiny DOM stand-in: elements carry attributes; querySelectorAll matches the
// `[data-tour="x"], [data-tip="x"]` selector anchorSelector builds.
interface FakeEl {
  attrs: Record<string, string>;
  visible: boolean;
  getAttribute(n: string): string | null;
  getClientRects(): { length: number };
}

function el(attrs: Record<string, string>, visible = true): FakeEl {
  return {
    attrs,
    visible,
    getAttribute: (n) => attrs[n] ?? null,
    getClientRects: () => ({ length: visible ? 1 : 0 }),
  };
}

let dom: FakeEl[] = [];

beforeEach(() => {
  dom = [];
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  vi.stubGlobal('document', {
    querySelectorAll: (sel: string) => {
      const names = [...sel.matchAll(/data-(?:tour|tip)="([^"]+)"/g)].map((m) => m[1]);
      return dom.filter((e) => names.includes(e.attrs['data-tour']) || names.includes(e.attrs['data-tip']));
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Pry anchors', () => {
  it('› prediction-bar locates one bar by token', () => {
    const the = el({ 'data-tour': 'prediction-bar', 'data-token': ' the' });
    const a = el({ 'data-tour': 'prediction-bar', 'data-token': ' a' });
    dom.push(the, a);
    expect(pryAnchors['prediction-bar'].locate({ token: ' a' })).toBe(a);
    expect(pryAnchors['prediction-bar'].locate({ token: ' the' })).toBe(the);
    expect(pryAnchors['prediction-bar'].locate({ token: ' zebra' })).toBeNull();
  });

  it('a hidden duplicate is skipped (the other layout\'s copy)', () => {
    const hiddenCopy = el({ 'data-tour': 'prompt-input' }, false);
    const shown = el({ 'data-tour': 'prompt-input' });
    dom.push(hiddenCopy, shown);
    expect(pryAnchors['prompt-input'].locate()).toBe(shown);
  });

  it('token-chip locates by text and occurrence through the run\'s tokens', async () => {
    recordingFetch();
    const h = makeHost('When Mary and John went to the store, John gave a drink to');
    await pryActions.run.run({}, ctx());
    dom.push(el({ 'data-tour': 'token-chip', 'data-token-index': '6' }), el({ 'data-tour': 'token-chip', 'data-token-index': '13' }));
    expect(pryAnchors['token-chip'].locate({ text: ' to', occurrence: 'last' })?.getAttribute('data-token-index')).toBe('13');
    expect(h.analysis.state.response).not.toBeNull();
  });

  it('feature-row and dla-bar match their attribute', () => {
    const row = el({ 'data-tour': 'feature-row', 'data-feature-id': '7' });
    const bar = el({ 'data-tour': 'dla-bar', 'data-part': 'L9H9' });
    dom.push(row, bar);
    expect(pryAnchors['feature-row'].locate({ id: 7 })).toBe(row);
    expect(pryAnchors['dla-bar'].locate({ part: 'L9H9' })).toBe(bar);
  });

  it('› every hideable region hides and reveals', () => {
    for (const name of HIDEABLE_ANCHORS) {
      pryAnchors[name].hide!(true);
      expect(isHidden(name), name).toBe(true);
      pryAnchors[name].hide!(false);
      expect(isHidden(name), name).toBe(false);
    }
    expect(pryUi.hidden).toEqual(Object.fromEntries(HIDEABLE_ANCHORS.map((n) => [n, false])));
  });

  it('labels, large flags, focus and reveal come over from the tour', () => {
    expect(pryAnchors['predictions-panel']).toMatchObject({
      label: 'the Predictions tab, right side',
      large: true,
      focus: [0.5, 0.2],
      reveal: { action: 'open_panel', args: { panel: 'predictions' } },
    });
    expect(pryAnchors['token-strip'].focus).toEqual([0.2, 0.5]);
    expect(pryAnchors['run-button'].large).toBeUndefined();
    expect(pryAnchors['tab-features'].label).toBeTruthy();
  });
});
