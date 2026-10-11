// Lab notebook state (T27): wraps the pure helpers in notebook.ts with load/save
// and the HTML report export. +page.svelte only wires buttons to this.
import {
  addEntry,
  buildEntry,
  deleteEntry,
  emptyNotebook,
  loadNotebook,
  newEntryId,
  saveNotebook,
  updateEntry,
  type BuildEntryInput,
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
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  const state = {
    get entries() { return entries; },
    set entries(v: NotebookEntry[]) { entries = v; },
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

  async function ensureLoaded(): Promise<boolean> {
    if (state.loaded) return true;
    try {
      nb = await loadNotebook();
      state.entries = nb.entries;
      state.loaded = true;
      state.error = null;
      return true;
    } catch (e) {
      // Don't save over a file we couldn't read.
      state.error = `Couldn't open the notebook: ${message(e)}`;
      return false;
    }
  }

  function commit(next: Notebook): Promise<boolean> {
    const run = chain.then(async () => {
      state.busy = true;
      try {
        await saveNotebook(next);
        nb = next;
        state.entries = next.entries;
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

  return {
    state,
    load: ensureLoaded,
    async add(input: NewEntryInput): Promise<NotebookEntry | null> {
      if (!(await ensureLoaded())) return null;
      const now = new Date();
      // Snapshot so later changes to the live analysis state can't reach the saved entry.
      const plain = $state.snapshot(input) as NewEntryInput;
      const entry = buildEntry({ ...plain, id: newEntryId(now), now });
      return (await commit(addEntry(nb, entry))) ? entry : null;
    },
    async update(id: string, patch: { title?: string; note?: string }): Promise<boolean> {
      if (!(await ensureLoaded())) return false;
      return commit(updateEntry(nb, id, patch));
    },
    async remove(id: string): Promise<boolean> {
      if (!(await ensureLoaded())) return false;
      return commit(deleteEntry(nb, id));
    },
    /** Save a report for the given entries (all when omitted). False when cancelled or failed. */
    async exportReport(ids?: string[]): Promise<boolean> {
      const chosen = ids ? state.entries.filter((e) => ids.includes(e.id)) : state.entries;
      try {
        return await saveTextFile(buildReport(chosen), reportFileName(), HTML_FILE);
      } catch (e) {
        state.error = `Couldn't save the report: ${message(e)}`;
        return false;
      }
    },
  };
}

export type NotebookStore = ReturnType<typeof createNotebookStore>;
