import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import OverlayPresenter, { hasLook, OverlayModel, overlayUi, TOUR_SEEN_KEY } from './OverlayPresenter.svelte';
import { loadLessonSource } from './format/normalise';
import type { Section } from './format/schema';
import type { Presenter, PresenterCommand } from './registry/contract';

// Plan T7a: the overlay presenter against a stub runner fed RenderedSteps
// built from the quick tour's outline-coverage skeleton. Rendered on the
// server, so there is no app, no run and no anchor on the page.

// Pointer.svelte imports through `$lib`, which vitest doesn't resolve; nothing is
// located on the server, so no ring would render anyway.
vi.mock('../components/Pointer.svelte', () => ({ default: () => {} }));

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'fixtures', 'outline-coverage', 'quick-tour.md'), 'utf-8');
const { lesson } = loadLessonSource(source);
const sections = lesson!.sections;

/** The runner's side: show a section, then point at its `:look` targets in order. */
function stubRunner(presenter: Presenter) {
  let index = 0;
  const commands: PresenterCommand[] = [];
  const go = (i: number) => {
    index = i;
    presenter.show(sections[i], { index: i, total: sections.length, canBack: i > 0 });
    const looks = sections[i].steps.flatMap((s) => s.prose.flatMap((p) => p.inline.filter((n) => n.type === 'look')));
    for (const look of looks) {
      const at = look.attrs?.at ?? [];
      const list = Array.isArray(at) ? at : [at];
      if (list.length === 1) presenter.point({ anchor: list[0] });
      else list.forEach((anchor, seq) => presenter.point({ anchor }, seq));
    }
  };
  presenter.onCommand((c) => {
    commands.push(c);
    if (c === 'next' && index < sections.length - 1) go(index + 1);
    if (c === 'back' && index > 0) go(index - 1);
  });
  return { go, commands, get index() { return index; } };
}

const html = (model: OverlayModel) => render(OverlayPresenter, { props: { model } }).body;

describe('overlay presenter', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the tour skeleton has one card per H2 section, 12 of them', () => {
    expect(sections).toHaveLength(12);
  });

  it('› step 1 renders centred', () => {
    const model = new OverlayModel();
    stubRunner(model).go(0);
    expect(hasLook(sections[0])).toBe(false);
    const out = html(model);
    expect(out).toContain('data-placement="centred"');
    expect(out).toContain('data-step-id="step-1"');
    expect(out).toContain('Pry runs GPT-2 small');
    expect(out).toContain(overlayUi.stepOf(1, 12));
    expect(out).toContain(overlayUi.skip);
  });

  it('a step with a :look is not centred', () => {
    const model = new OverlayModel();
    stubRunner(model).go(2);
    expect(html(model)).not.toContain('data-placement="centred"');
  });

  it('› skip on step 5 sets tutorial_seen', () => {
    const model = new OverlayModel();
    const runner = stubRunner(model);
    runner.go(4);
    const out = html(model);
    expect(out).toContain('data-step-id="step-5"');
    expect(out).toContain(overlayUi.skip);
    expect(store.get(TOUR_SEEN_KEY)).toBeUndefined();
    model.leave('skip');
    expect(store.get(TOUR_SEEN_KEY)).toBe('true');
    expect(runner.commands).toEqual(['skip']);
  });

  it('skip still reports to the runner when storage throws', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const model = new OverlayModel();
    const runner = stubRunner(model);
    runner.go(4);
    model.leave('skip');
    expect(runner.commands).toEqual(['skip']);
  });

  it('› steps 3-8 render with no run', () => {
    const model = new OverlayModel();
    const runner = stubRunner(model);
    for (let i = 2; i <= 7; i++) {
      runner.go(i);
      const out = html(model);
      const sec: Section = sections[i];
      expect(out).toContain(`data-step-id="${sec.id}"`);
      expect(out).toContain(sec.title);
      // The section's own prose, the empty-state line included, with each :look shown as its label.
      expect(out).toContain('After you press Run, this fills in.');
      for (const look of sec.steps.flatMap((s) => s.prose.flatMap((p) => p.inline.filter((n) => n.type === 'look')))) {
        expect(out).toContain(look.label!);
      }
      expect(out).not.toContain(':look{');
    }
  });

  it('sequence pointers for steps 2, 9 and 12 arrive in order', () => {
    const model = new OverlayModel();
    const runner = stubRunner(model);
    const expected: Record<number, string[]> = {
      1: ['prompt-input', 'run-button'],
      8: ['compare-button', 'notebook-button', 'export-button'],
      11: ['lessons-toggle', 'header-help', 'settings-button'],
    };
    for (const [i, anchors] of Object.entries(expected)) {
      runner.go(Number(i));
      expect(model.pointers).toEqual(anchors.map((anchor) => ({ anchor })));
    }
    runner.go(2);
    expect(model.pointers).toEqual([{ anchor: 'token-strip' }]);
  });

  it('Back, Next and Done go through onCommand; Done also marks the tour seen', () => {
    const model = new OverlayModel();
    const runner = stubRunner(model);
    runner.go(0);
    model.command('next');
    expect(runner.index).toBe(1);
    model.command('back');
    expect(runner.index).toBe(0);
    runner.go(11);
    expect(html(model)).toContain(overlayUi.done);
    model.leave('next');
    expect(store.get(TOUR_SEEN_KEY)).toBe('true');
    expect(runner.commands).toEqual(['next', 'back', 'next']);
  });
});
