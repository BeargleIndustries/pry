// Lab notebook state (T27): wraps the pure helpers in notebook.ts with load/save
// and the HTML report export. +page.svelte only wires buttons to this.
// Notebook v2 (T5b) adds the Lessons journal: the runner writes steps here and
// reads `:earlier` values and captures back.
import {
  addEntry,
  addJournalEntry,
  buildEntry,
  deleteEntry,
  emptyNotebook,
  indexJournal,
  loadNotebook,
  newEntryId,
  readCapture,
  readEarlier,
  recordAutoRun,
  saveNotebook,
  updateEntry,
  type BuildEntryInput,
  type EarlierRead,
  type JournalEntry,
  type Notebook,
  type NotebookEntry,
} from './notebook';
import { buildReport, reportFileName } from './report';
import { HTML_FILE, saveTextFile } from './tauri';

export type NewEntryInput = Omit<BuildEntryInput, 'id' | 'now'>;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createNotebookStore() {
  // Entries hold whole runs; raw state skips deep proxying, and every change replaces the array anyway.
  let entries = $state.raw<NotebookEntry[]>([]);
  let journal = $state.raw<JournalEntry[]>([]);
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  const index = $derived(indexJournal(journal));
  const state = {
    get entries() { return entries; },
    set entries(v: NotebookEntry[]) { entries = v; },
    get journal() { return journal; },
    set journal(v: JournalEntry[]) { journal = v; },
    get loaded() { return loaded; },
    set loaded(v: boolean) { loaded = v; },
    get busy() { return busy; },
    set busy(v: boolean) { busy = v; },
    get error() { return error; },
    set error(v: string | null) { error = v; },
  };
  let nb: Notebook = emptyNotebook();
  // Writes run one at a time so a quick edit can't land before an earlier save.
  let chain: Promise<unknown> = Promise.resolve();

  function show(next: Notebook) {
    nb = next;
    state.entries = next.entries;
    state.journal = next.journal;
  }

  async function ensureLoaded(): Promise<boolean> {
    if (state.loaded) return true;
    try {
      show(await loadNotebook());
      state.loaded = true;
      state.error = null;
      return true;
    } catch (e) {
      // Don't save over a file we couldn't read.
      state.error = `Couldn't open the notebook: ${message(e)}`;
      return false;
    }
  }

  // The updater runs inside the queue, on the notebook as left by every earlier
  // write, so two quick saves can't both start from the same old state.
  function commit(update: (current: Notebook) => Notebook): Promise<boolean> {
    const run = chain.then(async () => {
      state.busy = true;
      try {
        const next = update(nb);
        await saveNotebook(next);
        show(next);
        state.error = null;
        return true;
      } catch (e) {
        state.error = `Couldn't save the notebook: ${message(e)}`;
        return false;
      } finally {
        state.busy = false;
      }
    });
    chain = run;
    return run;
  }

  function build(input: NewEntryInput): NotebookEntry {
    const now = new Date();
    // Snapshot so later changes to the live analysis state can't reach the saved entry.
    const plain = $state.snapshot(input) as NewEntryInput;
    return buildEntry({ ...plain, id: newEntryId(now), now });
  }

  return {
    state,
    load: ensureLoaded,
    async add(input: NewEntryInput): Promise<NotebookEntry | null> {
      if (!(await ensureLoaded())) return null;
      const entry = build(input);
      return (await commit((cur) => addEntry(cur, entry))) ? entry : null;
    },
    async update(id: string, patch: { title?: string; note?: string }): Promise<boolean> {
      if (!(await ensureLoaded())) return false;
      return commit((cur) => updateEntry(cur, id, patch));
    },
    async remove(id: string): Promise<boolean> {
      if (!(await ensureLoaded())) return false;
      return commit((cur) => deleteEntry(cur, id));
    },
    /** Record one lesson step. */
    async addJournal(entry: JournalEntry): Promise<boolean> {
      if (!(await ensureLoaded())) return false;
      const plain = $state.snapshot(entry) as JournalEntry;
      return commit((cur) => addJournalEntry(cur, plain));
    },
    /** Save an observe step's run; it replaces the earlier auto-saved run for the same (lesson, step). */
    async addAutoRun(
      input: NewEntryInput & { autoSave: { lessonId: string; stepId: string } },
      observe: JournalEntry,
    ): Promise<NotebookEntry | null> {
      if (!(await ensureLoaded())) return null;
      const entry = build(input);
      const plain = $state.snapshot(observe) as JournalEntry;
      return (await commit((cur) => recordAutoRun(cur, entry, plain))) ? entry : null;
    },
    /** The latest answer for a `remember` key (`:earlier` / `$earlier`). */
    readEarlier(key: string): EarlierRead | null {
      return readEarlier(index, key);
    },
    readCapture(lessonId: string, name: string) {
      return readCapture(index, lessonId, name);
    },
    /** Save a report for the given entries (all when omitted). False when cancelled or failed. */
    async exportReport(ids?: string[]): Promise<boolean> {
      const chosen = ids ? state.entries.filter((e) => ids.includes(e.id)) : state.entries;
      // A report of chosen runs carries only the lesson steps tied to those runs.
      const steps = ids ? state.journal.filter((j) => j.runEntryId && ids.includes(j.runEntryId)) : state.journal;
      try {
        return await saveTextFile(buildReport(chosen, { journal: steps }), reportFileName(), HTML_FILE);
      } catch (e) {
        state.error = `Couldn't save the report: ${message(e)}`;
        return false;
      }
    },
  };
}

export type NotebookStore = ReturnType<typeof createNotebookStore>;
