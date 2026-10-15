// Lessons, wired into the app (plan T3). Builds the tool-agnostic runner on
// Pry's ToolActionSet and the T5 notebook journal, loads the lesson library
// (bundled + user lessons), and backs the sidebar, the picker, Settings >
// Lessons and the install sheet. Nothing here runs until Lessons is opened:
// with Lessons off the page creates none of it (Principle 5, "off means off").

import { pryToolSet } from './lessons/registry/pry-set';
import { pryMemo } from './lessons/registry/pry-state.svelte';
import { LessonRunner } from './lessons/runner/runner.svelte';
import { SidebarModel } from './lessons/LessonSidebar.svelte';
import { createProgress, migrateExperiments, QUICK_TOUR_ID } from './lessons/progress';
import { OverlayModel } from './lessons/OverlayPresenter.svelte';
import { lessonIdForExperiment } from './notebook';
import { parse as parseYaml } from 'yaml';
import { loadLessonSource } from './lessons/format/normalise';
import {
  AUTHOR_MODE_KEY,
  bundledEntries,
  bundledSources,
  formatError,
  openLessonLibrary,
  readAuthorMode,
  realFormat,
  visibleLessons,
  type LessonEntry,
  type LessonLibrary,
  type PendingInstall,
} from './lessons/loader';
import { GRANTS_FILE, grant, grantStatus, loadGrants, revoke, saveGrants, type GrantStore, type GrantsFs, type Permissions } from './lessons/grants';
import { inTauri, type LessonLog } from './lessons/log';
import type { Effect, Presenter } from './lessons/registry/contract';
import { memoryJournal, type RunnerJournal } from './lessons/runner/types';
import type { PickerItem } from './lessons/LessonPicker.svelte';
import type { UserLessonRow } from './lessons/LessonsSettings.svelte';
import type { Lesson } from './lessons/format/schema';
import type { Provenance } from './notebook';
import type { createNotebookStore } from './notebook.svelte';
import { POPUP_AUDIT } from './popup/dev';

type NotebookStore = ReturnType<typeof createNotebookStore>;

export const AUTHORING_URL = 'https://github.com/BeargleIndustries/pry/blob/master/docs/lessons/AUTHORING.md';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A capture as the journal stores it: the run without raw attention (the notebook drops it the same way). */
function slimCapture(c: { name: string; readouts: Record<string, unknown> }) {
  const r = c.readouts.result;
  if (!isObj(r) || !isObj(r.response)) return c;
  const { attention: _a, ...response } = r.response as Record<string, unknown>;
  return { ...c, readouts: { ...c.readouts, result: { ...r, response } } };
}

function journalOver(nb: NotebookStore, provenance: () => Provenance): RunnerJournal {
  return {
    earlier: (key) => {
      const e = nb.readEarlier(key);
      return e ? { skipped: e.skipped, value: e.value, text: e.text } : null;
    },
    capture: (lessonId, name) => nb.readCapture(lessonId, name) ?? null,
    last: (lessonId, stepId) => {
      const j = nb.state.journal;
      for (let i = j.length - 1; i >= 0; i--) if (j[i].lesson.id === lessonId && j[i].stepId === stepId) return j[i];
      return null;
    },
    write: (e) => nb.addJournal({ ...e, capture: e.capture ? slimCapture(e.capture) : undefined, provenance: provenance() }),
  };
}

export interface LessonsAppDeps {
  notebook: NotebookStore;
  provenance: () => Provenance;
  modelName: (id: string) => string;
  currentModel: () => string | null;
  log?: LessonLog;
}

export function createLessonsApp(deps: LessonsAppDeps) {
  const progress = createProgress();
  let rowsData: Record<string, unknown> = {};
  const model = new SidebarModel();
  const state = $state({
    entries: [] as LessonEntry[],
    pending: [] as PendingInstall[],
    authorMode: readAuthorMode(typeof localStorage === 'undefined' ? undefined : localStorage),
    installOpen: false,
    open: false as boolean,
    grants: {} as GrantStore,
    loaded: false,
  });
  /** Lesson file -> its text (bundled, and the popup audit's fixture lessons). */
  const texts: Record<string, string> = {};
  let library: LessonLibrary | null = null;

  const runner = new LessonRunner({
    set: pryToolSet,
    memo: pryMemo,
    // The harness build keeps its journal in memory: a debug run never writes the learner's notebook.
    journal: POPUP_AUDIT ? memoryJournal() : journalOver(deps.notebook, deps.provenance),
    progress,
    // `$row.<id>.<field>`: the row's recorded values, with its authored constants (rows.json `constants`) on top.
    rows: (id) => {
      const r = rowsData[id] as { values?: Record<string, unknown>; constants?: Record<string, { value: unknown }> } | undefined;
      if (!r) return undefined;
      return { ...(r.values ?? {}), ...Object.fromEntries(Object.entries(r.constants ?? {}).map(([k, c]) => [k, c.value])) };
    },
    currentModel: deps.currentModel,
    modelName: deps.modelName,
    debug: import.meta.env.DEV,
    authorMode: () => state.authorMode,
    log: (e) => void deps.log?.log({ lessonId: e.lessonId, stepId: e.stepId, message: e.message, effect: e.effect as Effect | undefined, scope: e.scope }),
    openOther: (id, section) => void openLesson(id, section),
  });
  // The quick tour is an overlay lesson on this same runner (plan D4): the
  // overlay presenter draws it, the sidebar never does. One runner holds one
  // lesson, so the tour and a sidebar lesson can't both be open.
  const overlay = new OverlayModel();
  // Registered before the runner's own handler, so it still sees the step
  // "Done" was pressed on: the last step's Next records the finish, then closes.
  overlay.onCommand((c) => {
    const l = runner.lesson;
    if (c === 'next' && l?.meta.presentation === 'overlay' && runner.index >= l.sections.length - 1) {
      queueMicrotask(() => {
        if (runner.lesson?.meta.presentation === 'overlay') runner.close();
      });
    }
  });
  // Each presenter draws only its own kind of lesson.
  const only = (p: Presenter, overlayLesson: boolean): Presenter => ({
    show: (step, nav) => {
      if ((runner.lesson?.meta.presentation === 'overlay') === overlayLesson) p.show(step, nav);
    },
    point: (t, seq) => {
      if ((runner.lesson?.meta.presentation === 'overlay') === overlayLesson) p.point(t, seq);
    },
    clearPointer: () => p.clearPointer(),
    onCommand: (cb) => p.onCommand(cb),
  });
  runner.attach(only(model, false));
  runner.attach(only(overlay, true));

  async function load(): Promise<void> {
    // 0.3.8 experiments the learner ran mark their lessons visited (plan T7b migration).
    void deps.notebook.load().then(() =>
      migrateExperiments(
        deps.notebook.state.entries.map((e) => (e.experiment ? lessonIdForExperiment(e.experiment.id) : null)),
        progress,
      ),
    );
    if (!Object.keys(rowsData).length) {
      const rows = (await import('../lessons/__generated__/rows.json')).default as { rows: { id: number }[] };
      rowsData = Object.fromEntries(rows.rows.map((r) => [String(r.id), r]));
    }
    const src = bundledSources();
    Object.assign(texts, src.lessons);
    let extra: LessonEntry[] = [];
    if (POPUP_AUDIT) {
      // The harness build lists the 20 outline skeletons so the sidebar has lessons before T6's land.
      const skeletons = import.meta.glob('/src/lib/lessons/fixtures/outline-coverage/*.md', { query: '?raw', import: 'default' });
      const loaded: Record<string, string> = {};
      for (const [file, get] of Object.entries(skeletons)) loaded[file.replace(/\.md$/, '/lesson.md')] = (await get()) as string;
      Object.assign(texts, loaded);
      extra = bundledEntries(realFormat, loaded, {}, undefined);
    }
    // The harness build lists bundled lessons and the skeletons only: no user-lesson folder is touched.
    if (inTauri() && !POPUP_AUDIT) {
      try {
        library = library ?? (await openLessonLibrary({ lessonDir: pryToolSet.lessonDir, idPrefix: pryToolSet.idPrefix, log: deps.log }));
        await library.ensureTemplate().catch(() => {});
        await library.load();
        library.onChange(() => refreshLibrary(extra));
        state.grants = await readGrants();
      } catch (e) {
        void deps.log?.log({ message: `library failed: ${String(e)}` });
        library = null;
      }
    }
    refreshLibrary(extra);
    state.loaded = true;
  }

  let extraEntries: LessonEntry[] = [];
  function refreshLibrary(extra = extraEntries): void {
    extraEntries = extra;
    const base = library ? library.entries : bundledEntries(realFormat, bundledSources().lessons, bundledSources().images, bundledSources().index);
    const ids = new Set(base.map((e) => e.id));
    state.entries = [...base, ...extra.filter((e) => !ids.has(e.id))];
    state.pending = library ? [...library.pending] : [];
  }

  const grantsFs = (pfs: typeof import('@tauri-apps/plugin-fs')): GrantsFs => ({
    exists: (p) => pfs.exists(p),
    readTextFile: (p) => pfs.readTextFile(p),
    writeTextFile: (p, t) => pfs.writeTextFile(p, t),
  });

  async function readGrants(): Promise<GrantStore> {
    const pfs = await import('@tauri-apps/plugin-fs');
    const { appDataDir } = await import('@tauri-apps/api/path');
    const dir = await appDataDir();
    return loadGrants(grantsFs(pfs), `${dir.replace(/[\\/]+$/, '')}/${GRANTS_FILE}`);
  }

  async function writeGrants(store: GrantStore): Promise<void> {
    const pfs = await import('@tauri-apps/plugin-fs');
    const { appDataDir } = await import('@tauri-apps/api/path');
    const dir = await appDataDir();
    await saveGrants(grantsFs(pfs), `${dir.replace(/[\\/]+$/, '')}/${GRANTS_FILE}`, store);
    state.grants = store;
  }

  async function lessonText(entry: LessonEntry): Promise<string | null> {
    if (texts[entry.file]) return texts[entry.file];
    if (entry.source === 'user' && inTauri()) {
      const pfs = await import('@tauri-apps/plugin-fs');
      return pfs.readTextFile(entry.file);
    }
    return null;
  }

  async function fullLesson(entry: LessonEntry): Promise<Lesson | null> {
    const text = await lessonText(entry);
    if (!text) return null;
    return loadLessonSource(text, { mode: 'lenient', tool: pryToolSet, file: entry.file }).lesson;
  }

  async function openLesson(id: string, sectionId: string | null = null): Promise<boolean> {
    if (id === QUICK_TOUR_ID) return startTour(sectionId ?? undefined);
    const entry = state.entries.find((e) => e.id === id && e.lesson);
    if (!entry) return false;
    const lesson = await fullLesson(entry);
    if (!lesson) return false;
    const source =
      entry.source === 'bundled'
        ? ({ kind: 'bundled' } as const)
        : ({
            kind: 'user',
            manifest: { id: entry.id, sourcePath: entry.folder, permissions: entry.lesson?.permissions ?? {} },
            grants: () => state.grants,
          } as const);
    library?.select(id, sectionId);
    await runner.open(lesson, { source, sourceKind: entry.source, sectionId, images: entry.images });
    return true;
  }

  /** Closes the sidebar's lesson. The tour, when it's the one open, stays up. */
  function closeLesson(): void {
    if (!tourOpen()) runner.close();
    model.clear();
  }

  const tourOpen = () => runner.lesson?.meta.presentation === 'overlay';

  /**
   * Starts the quick tour from `sectionId` (step 1 by default) on the shared
   * runner. It reads only the bundled tour file, so it works before the
   * library has loaded and touches no user-lesson folder.
   */
  async function startTour(sectionId = 'step-1'): Promise<boolean> {
    const file = Object.keys(bundledSources().lessons).find((f) => f.includes(`/${QUICK_TOUR_ID}/`));
    const text = file ? bundledSources().lessons[file] : null;
    if (!file || !text) return false;
    const lesson = loadLessonSource(text, { mode: 'lenient', tool: pryToolSet, file }).lesson;
    if (!lesson) return false;
    model.clear();
    await runner.open(lesson, { source: { kind: 'bundled' }, sourceKind: 'bundled', sectionId });
    return true;
  }

  function endTour(): void {
    if (tourOpen()) runner.close();
  }

  /** The first bundled lesson of a stage (index.yaml), for "open the picker at Stage N". */
  function stageStart(stage: number): string | null {
    try {
      const doc = parseYaml(bundledSources().index ?? '') as { lessons?: { id: string; stage?: number }[] };
      return doc?.lessons?.find((l) => l.stage === stage)?.id ?? null;
    } catch {
      return null;
    }
  }

  function pickerItems(): PickerItem[] {
    return visibleLessons(state.entries, { authorMode: state.authorMode }).map((e) => ({
      id: e.id,
      title: e.lesson?.title ?? e.id,
      minutes: null,
      draft: e.lesson?.draft ?? false,
      source: e.source,
      error: e.error ? formatError(e.error) : null,
      visited: progress.visited(e.id),
      finished: progress.of(e.id)?.finished ?? false,
    }));
  }

  function userRows(): UserLessonRow[] {
    return state.entries
      .filter((e) => e.source === 'user')
      .map((e) => {
        const declared: Permissions = e.lesson?.permissions ?? {};
        const st = e.lesson ? grantStatus(state.grants, { id: e.id, sourcePath: e.folder, permissions: declared }) : null;
        return { id: e.id, title: e.lesson?.title ?? e.id, declared, granted: st?.granted ?? {}, error: e.error ? formatError(e.error) : null };
      });
  }

  async function answerInstall(p: PendingInstall, approved: Permissions | null): Promise<void> {
    const store = await grant(state.grants, p.manifest, approved ?? {}, new Date());
    await writeGrants(store);
    await library?.reload();
    refreshLibrary();
    if (!state.pending.length) state.installOpen = false;
  }

  async function revokeLesson(id: string): Promise<void> {
    await writeGrants(revoke(state.grants, id));
    await library?.reload();
    refreshLibrary();
  }

  async function removeLesson(id: string): Promise<void> {
    const e = state.entries.find((x) => x.id === id && x.source === 'user');
    if (!e) return;
    if (runner.lesson?.meta.id === id) closeLesson();
    const pfs = await import('@tauri-apps/plugin-fs');
    await pfs.remove(e.folder, { recursive: true });
    await revokeLesson(id);
  }

  /** "Check this lesson": the full strict structural lint plus the copy lint. */
  async function checkLesson(id: string): Promise<string[]> {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return [];
    const text = await lessonText(e);
    if (!text) return [];
    const [{ lintLesson }, { copyLint }, { formatIssue }, yaml, terms, words] = await Promise.all([
      import('./lessons/format/lint'),
      import('./lessons/format/copy-lint'),
      import('./lessons/format/errors'),
      import('yaml'),
      import('../lessons/terms.yaml?raw'),
      import('../lessons/lint-words.yaml?raw'),
    ]);
    const { lesson, issues } = loadLessonSource(text, { mode: 'strict', tool: pryToolSet, file: e.file });
    const all = [...issues];
    if (lesson) {
      const t = yaml.parse(terms.default);
      all.push(...lintLesson(lesson, { tool: pryToolSet, bundled: e.source === 'bundled' }));
      all.push(...copyLint(lesson, { terms: t, words: yaml.parse(words.default), path: [...new Set((t.terms as { introduced_in: string }[]).map((x) => x.introduced_in))] }));
    }
    return all.filter((i) => i.severity === 'error').map((i) => formatIssue(i));
  }

  async function addLesson(): Promise<string | null> {
    if (!library) return null;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== 'string') return null;
    const r = await library.addLessonFolder(picked);
    if (!r.ok) return r.message;
    await library.reload();
    refreshLibrary();
    state.installOpen = state.pending.length > 0;
    return null;
  }

  async function shellOpen(target: string): Promise<void> {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(target);
    } catch {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }

  async function lessonsFolder(): Promise<string> {
    const { appDataDir } = await import('@tauri-apps/api/path');
    return `${(await appDataDir()).replace(/[\\/]+$/, '')}/${pryToolSet.lessonDir}`;
  }

  async function linterCommand(): Promise<string> {
    let script = 'lessons-lint.mjs';
    try {
      const { resolveResource } = await import('@tauri-apps/api/path');
      script = await resolveResource('_up_/ui/build-cli/lessons-lint.mjs');
    } catch {
      /* outside Tauri */
    }
    return `node "${script}" "${await lessonsFolder().catch(() => 'your-lesson-folder')}"`;
  }

  function setAuthorMode(on: boolean): void {
    state.authorMode = on;
    try {
      localStorage.setItem(AUTHOR_MODE_KEY, String(on));
    } catch {
      /* storage unavailable */
    }
    runner.refresh();
  }

  return {
    state,
    model,
    overlay,
    runner,
    progress,
    load,
    openLesson,
    closeLesson,
    startTour,
    endTour,
    get tourOpen() {
      return tourOpen();
    },
    stageStart,
    pickerItems,
    userRows,
    answerInstall,
    revokeLesson,
    removeLesson,
    checkLesson,
    addLesson,
    openFolder: async () => shellOpen(await lessonsFolder()),
    openGuide: () => shellOpen(AUTHORING_URL),
    copyLinter: async () => navigator.clipboard?.writeText(await linterCommand()),
    reload: async () => {
      await library?.reload();
      refreshLibrary();
    },
    setAuthorMode,
    captures: () => runner.captureMap(),
    /** Starts the user-lesson folder watcher (only once Lessons is open). */
    watch: async () => {
      await library?.watch().catch(() => {});
    },
    /** Runs a tool action directly (an anchor's `reveal`: opening the tab that shows it). */
    runAction: async (name: string, args: unknown) => {
      await pryToolSet.actions[name]?.run(args, { signal: new AbortController().signal, wait: () => {} });
    },
  };
}

export type LessonsApp = ReturnType<typeof createLessonsApp>;
