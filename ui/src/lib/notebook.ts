// Lab notebook (T27): saved runs plus the user's own notes.
//
// The notebook is one JSON file, `notebook.json`, in the app data folder
// (%APPDATA%\com.beargle.pry on Windows). Outside Tauri (plain `npm run dev`)
// it lives in localStorage instead. Nothing here touches the network.
//
// The pure helpers (build/add/update/delete/serialize/parse) are kept separate
// from the load/save I/O so they can be tested without Tauri.
import { isTauri } from './is-tauri';
import {
  attentionReadout,
  dlaReadout,
  featuresReadout,
  logitLensReadout,
  predictionsReadout,
} from './readouts';
import type {
  AblateResponse,
  CircuitResponse,
  DLAResponse,
  GenerateResponse,
  LogitLensResponse,
  PatchResponse,
  PresetDisplay,
  SteerResponse,
} from './types';

/** Bump when the file shape changes; `parseNotebook` refuses newer versions. */
export const NOTEBOOK_SCHEMA_VERSION = 1;
export const NOTEBOOK_FILE = 'notebook.json';
export const NOTEBOOK_STORAGE_KEY = 'pry:notebook';

/** The run as saved. The attention matrices are left out: they are large and the report doesn't need them. */
export type SavedResponse = Omit<GenerateResponse, 'attention'>;

/** What the JSON export collects (see handleExportJSON in +page.svelte), minus raw attention. */
export interface RunSnapshot {
  response: SavedResponse;
  saeLayer: number | null;
  activePresetId: string | null;
  logitLensResponse: LogitLensResponse | null;
  dlaResponse: DLAResponse | null;
  steerResponse: SteerResponse | null;
  headAblateResponse: AblateResponse | null;
  featureAblateResponse: AblateResponse | null;
  patchResponse: PatchResponse | null;
  circuitResponse: CircuitResponse | null;
}

/** Plain-language sentences computed when the entry was saved (from readouts.ts). */
export interface EntryReadouts {
  predictions: string | null;
  attention: string | null;
  logitLens: string | null;
  dla: string | null;
  features: string | null;
}

export interface EntryModel {
  presetId: string;
  name: string;
  /** Neuronpedia ids, kept so the report can link features the way the app does. */
  neuronpediaModelId: string | null;
  neuronpediaReleaseSuffix: string | null;
}

export interface EntryCitation {
  label: string;
  url: string;
}

export interface EntryExperiment {
  id: string;
  title: string;
  citations: EntryCitation[];
}

export interface NotebookEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  note: string;
  prompt: string;
  model: EntryModel;
  readouts: EntryReadouts;
  /** The experiment card this run came from, when there was one. */
  experiment: EntryExperiment | null;
  run: RunSnapshot;
}

export interface Notebook {
  schemaVersion: number;
  entries: NotebookEntry[];
}

export function emptyNotebook(): Notebook {
  return { schemaVersion: NOTEBOOK_SCHEMA_VERSION, entries: [] };
}

// ---------------------------------------------------------------------------
// Building an entry from the current run
// ---------------------------------------------------------------------------

export interface BuildEntryInput {
  id: string;
  now: Date;
  note?: string;
  title?: string;
  modelName: string;
  display: Pick<PresetDisplay, 'neuronpedia_model_id' | 'neuronpedia_release_suffix'> | null;
  experiment?: EntryExperiment | null;
  run: Omit<RunSnapshot, 'response'> & { response: GenerateResponse };
}

/** A short default title: the prompt, trimmed. */
export function defaultTitle(prompt: string, max = 60): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  if (!flat) return 'Untitled run';
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

function computeReadouts(run: BuildEntryInput['run']): EntryReadouts {
  const r = run.response;
  const lastPos = r.tokens.length - 1;
  const lastTok = r.tokens[lastPos] ?? null;
  // Attention is only captured for the first 64 tokens; past that, skip the sentence.
  const attentionCovers = r.attention.some((l) => l.heads.some((m) => m.length > lastPos));
  const lastFeatures = r.sae_features.find((f) => f.token_index === lastTok?.index) ?? null;
  return {
    predictions: predictionsReadout(r.top_predictions),
    attention: lastPos >= 0 && attentionCovers ? attentionReadout(r, lastPos) : null,
    logitLens: logitLensReadout(run.logitLensResponse),
    dla: dlaReadout(run.dlaResponse),
    features: featuresReadout(lastFeatures, lastTok?.text ?? null),
  };
}

export function buildEntry(input: BuildEntryInput): NotebookEntry {
  const { attention: _attention, ...response } = input.run.response;
  const at = input.now.toISOString();
  const prompt = response.prompt;
  return {
    id: input.id,
    createdAt: at,
    updatedAt: at,
    title: input.title?.trim() || defaultTitle(prompt),
    note: input.note ?? '',
    prompt,
    model: {
      presetId: response.preset_id,
      name: input.modelName,
      neuronpediaModelId: input.display?.neuronpedia_model_id ?? null,
      neuronpediaReleaseSuffix: input.display?.neuronpedia_release_suffix ?? null,
    },
    readouts: computeReadouts(input.run),
    experiment: input.experiment ?? null,
    run: { ...input.run, response },
  };
}

// ---------------------------------------------------------------------------
// Pure notebook operations (return a new notebook; never mutate)
// ---------------------------------------------------------------------------

/** Newest first. */
export function addEntry(nb: Notebook, entry: NotebookEntry): Notebook {
  return { ...nb, entries: [entry, ...nb.entries.filter((e) => e.id !== entry.id)] };
}

export function updateEntry(
  nb: Notebook,
  id: string,
  patch: { title?: string; note?: string },
  now: Date = new Date(),
): Notebook {
  return {
    ...nb,
    entries: nb.entries.map((e) => {
      if (e.id !== id) return e;
      const title = patch.title !== undefined ? patch.title.trim() || defaultTitle(e.prompt) : e.title;
      const note = patch.note !== undefined ? patch.note : e.note;
      return { ...e, title, note, updatedAt: now.toISOString() };
    }),
  };
}

export function deleteEntry(nb: Notebook, id: string): Notebook {
  return { ...nb, entries: nb.entries.filter((e) => e.id !== id) };
}

export function serializeNotebook(nb: Notebook): string {
  return JSON.stringify({ schemaVersion: NOTEBOOK_SCHEMA_VERSION, entries: nb.entries }, null, 2);
}

export class NotebookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotebookParseError';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function looksLikeEntry(v: unknown): v is NotebookEntry {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.note === 'string' &&
    isObj(v.model) &&
    isObj(v.readouts) &&
    isObj(v.run)
  );
}

/**
 * Parse a saved notebook. Throws NotebookParseError on unreadable files or a
 * newer schema, so the caller never overwrites data it doesn't understand.
 * Entries that don't look like entries are dropped.
 */
export function parseNotebook(text: string): Notebook {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new NotebookParseError('The notebook file is not valid JSON.');
  }
  if (!isObj(raw)) throw new NotebookParseError('The notebook file has an unexpected shape.');
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new NotebookParseError('The notebook file has no schema version.');
  }
  if (version > NOTEBOOK_SCHEMA_VERSION) {
    throw new NotebookParseError(
      `The notebook was saved by a newer version of Pry (format ${version}). Update Pry to open it.`,
    );
  }
  const entries = Array.isArray(raw.entries) ? raw.entries.filter(looksLikeEntry) : [];
  return { schemaVersion: NOTEBOOK_SCHEMA_VERSION, entries };
}

export function newEntryId(now: Date = new Date()): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${now.getTime().toString(36)}-${rand}`;
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

async function notebookPath(): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  return join(await appDataDir(), NOTEBOOK_FILE);
}

/** Read the notebook. A missing file is an empty notebook; a broken one throws. */
export async function loadNotebook(): Promise<Notebook> {
  if (isTauri()) {
    const { exists, readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await notebookPath();
    if (!(await exists(path))) return emptyNotebook();
    return parseNotebook(await readTextFile(path));
  }
  let text: string | null = null;
  try {
    text = localStorage.getItem(NOTEBOOK_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  return text ? parseNotebook(text) : emptyNotebook();
}

export async function saveNotebook(nb: Notebook): Promise<void> {
  const text = serializeNotebook(nb);
  if (isTauri()) {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const { exists, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const dir = await appDataDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    await writeTextFile(await notebookPath(), text);
    return;
  }
  localStorage.setItem(NOTEBOOK_STORAGE_KEY, text);
}
