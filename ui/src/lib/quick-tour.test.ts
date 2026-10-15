// The quick tour on the real Lessons runner (plan T7b acceptance): the overlay
// presenter draws `pry.quick-tour` through the same runner and progress store
// the sidebar uses, it never resets the prompt, the run or knockouts (R4-8),
// and the tour and a sidebar lesson are never open together.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
// Pointer.svelte imports through `$lib`, which vitest doesn't resolve; no component renders here.
vi.mock('./components/Pointer.svelte', () => ({ default: () => {} }));

import { createLessonsApp } from './lessons-app.svelte';
import { makeHost, type TestHost } from './lessons/registry/pry-test-host';
import { fakeSidecar } from './lessons/runner/test-kit';

afterEach(() => vi.unstubAllGlobals());

const IOI = 'When Mary and John went to the store, John gave a drink to';

function makeApp(host: TestHost) {
  const notebook = {
    load: async () => true,
    state: { entries: [], journal: [] },
    readEarlier: () => null,
    readCapture: () => null,
    addJournal: async () => true,
  };
  return createLessonsApp({
    notebook: notebook as unknown as Parameters<typeof createLessonsApp>[0]['notebook'],
    provenance: () => ({}) as never,
    modelName: (id) => id,
    currentModel: () => host.activePresetId(),
  });
}

type App = ReturnType<typeof makeApp>;

/** Presses Next on the tour card and waits for the runner to settle on `want`. */
async function next(app: App, want: string | null) {
  app.overlay.command('next');
  await vi.waitFor(() => {
    if (want === null) expect(app.tourOpen).toBe(false);
    else expect(app.overlay.section?.id).toBe(want);
    expect(app.runner.entering).toBe(false);
  });
}

/** Walks the whole tour, step 1 to Done. */
async function walk(app: App) {
  for (let i = 2; i <= 12; i++) await next(app, `step-${i}`);
  await next(app, null);
}

describe('quick tour', () => {
  it('› runs through the same runner and progress store', async () => {
    const host = makeHost();
    fakeSidecar();
    const app = makeApp(host);
    expect(await app.startTour()).toBe(true);
    await vi.waitFor(() => expect(app.runner.entering).toBe(false));
    expect(app.tourOpen).toBe(true);
    expect(app.runner.lesson?.meta.id).toBe('pry.quick-tour');
    expect(app.overlay.section?.id).toBe('step-1');
    expect(app.overlay.nav).toMatchObject({ index: 0, total: 12 });
    // The sidebar presenter never draws the tour.
    expect(app.model.step).toBeNull();
    await walk(app);
    const p = app.progress.of('pry.quick-tour');
    expect(p?.finished).toBe(true);
    expect(p?.sections).toHaveLength(12);
    // A sidebar lesson runs on the very same runner and writes the same store.
    await app.load();
    expect(await app.openLesson('pry.p1-1')).toBe(true);
    expect(app.runner.lesson?.meta.id).toBe('pry.p1-1');
    expect(app.progress.visited('pry.p1-1')).toBe(true);
    expect(app.progress.of('pry.quick-tour')?.finished).toBe(true);
  });

  it('› taking the tour mid-analysis keeps the prompt and results', async () => {
    const host = makeHost(IOI);
    fakeSidecar();
    await host.analysis.generate(host.page.prompt);
    const response = host.analysis.state.response;
    expect(response?.prompt).toBe(IOI);
    host.analysis.state.headAblations = [{ layer: 9, head: 9 }];
    host.analysis.state.headAblationMode = true;
    const app = makeApp(host);
    await app.startTour();
    await vi.waitFor(() => expect(app.runner.entering).toBe(false));
    await walk(app);
    expect(host.page.prompt).toBe(IOI);
    expect(host.analysis.state.response).toBe(response);
    expect(host.analysis.state.headAblations).toEqual([{ layer: 9, head: 9 }]);
    expect(host.analysis.state.headAblationMode).toBe(true);
    // The tour only opens panels (its `enter` is open_panel): step 8 left the Features tab up.
    expect(host.page.rightTab).toBe('features');
  });

  it('› tour and Lessons are exclusive', async () => {
    const host = makeHost();
    fakeSidecar();
    const app = makeApp(host);
    await app.load();
    // A sidebar lesson, then the tour: the lesson closes and the sidebar clears.
    await app.openLesson('pry.p1-1');
    await vi.waitFor(() => expect(app.model.step?.lesson.id).toBe('pry.p1-1'));
    await app.startTour();
    await vi.waitFor(() => expect(app.tourOpen).toBe(true));
    expect(app.runner.lesson?.meta.id).toBe('pry.quick-tour');
    expect(app.model.step).toBeNull();
    // Closing the sidebar's lesson leaves the tour up; opening a lesson ends it.
    app.closeLesson();
    expect(app.tourOpen).toBe(true);
    await app.openLesson('pry.p1-1');
    expect(app.tourOpen).toBe(false);
    expect(app.runner.lesson?.meta.id).toBe('pry.p1-1');
    // A `lesson:pry.quick-tour` link (or the picker's entry) starts the tour instead of a sidebar lesson.
    await app.openLesson('pry.quick-tour');
    expect(app.tourOpen).toBe(true);
    app.endTour();
    expect(app.tourOpen).toBe(false);
    expect(app.runner.lesson).toBeNull();
  });
});
