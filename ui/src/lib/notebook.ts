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
export const NOTEBOOK_SCHEMA_VERSION = 2;
export const NOTEBOOK_FILE = 'notebook.json';
export const NOTEBOOK_STORAGE_KEY = 'pry:notebook';
/** A byte-for-byte copy of the v1 file, written before the first v2 save so 0.3.8 can be restored. */
export const NOTEBOOK_V1_BACKUP_FILE = 'notebook.v1.json';
export const NOTEBOOK_V1_BACKUP_STORAGE_KEY = 'pry:notebook.v1';

/** 0.3.8 experiment card ids and the lesson each one became (plan T5b). */
export const EXPERIMENT_LESSON_IDS: Readonly<Record<string, string>> = {
  induction: 'pry.p2-2',
  'logit-lens': 'pry.p2-3',
  'he-or-she': 'pry.p2-4',
  'ioi-knockout': 'pry.p3-2',
  'ioi-swap': 'pry.p3-3',
  'features-steering': 'pry.p3-5',
  'fact-recall': 'pry.p3-6',
  'greater-than': 'pry.p3-7',
};

export function lessonIdForExperiment(experimentId: string | null | undefined): string | null {
  return experimentId ? (EXPERIMENT_LESSON_IDS[experimentId] ?? null) : null;
}

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
  /** The lesson this run belongs to (v2). v1 entries get it from their experiment id. */
  lessonId: string | null;
  /** Set on runs the Lessons runner saved by itself; a newer one replaces it per (lesson, step). */
  autoSave: { lessonId: string; stepId: string } | null;
  run: RunSnapshot;
  /** How the run was produced (v2). Null only on entries migrated from v1. */
  provenance: Provenance | null;
}

/**
 * How a lesson result was produced (plan T5). Types only (T5a); notebook v2
 * (T5b) fills and stores it with each journal entry.
 */
export interface Provenance {
  appVersion: string | null;
  sidecarVersion: string | null;
  torchVersion: string | null;
  cudaVersion: string | null;
  device: string | null;
  transformerLensVersion: string | null;
  saeLensVersion: string | null;
  transformersVersion: string | null;
  modelPreset: string | null;
  modelRevision: string | null;
  sae: { release: string; id: string; layer: number } | null;
  prompt: string | null;
  temperature: number | null;
  seed: number | null;
  knockouts: { heads: { layer: number; head: number }[]; features: number[] };
  steering: {
    featureId: number;
    strength: number;
    layer: number;
    control: boolean;
    persistencePrompts: string[];
  } | null;
  dla: { answer: string; contrast: string | null } | null;
  patch: { clean: string; corrupted: string; type: 'head' | 'mlp' | 'resid' } | null;
  circuitThreshold: number | null;
  compare: { a: string; b: string } | null;
  /** The tool's `snapshot()` view state when the entry was written. */
  snapshot: unknown;
}

export type JournalKind =
  | 'recall'
  | 'question'
  | 'predict'
  | 'observe'
  | 'transfer'
  | 'compare'
  | 'task'
  | 'explain-chain'
  | 'capture';

/**
 * One learner step recorded by the Lessons runner (plan T5). Types only (T5a).
 * `remember` keys are indexed so `:earlier` and `$earlier` read the latest
 * entry per key; captures are indexed per (lesson, name).
 */
export interface JournalEntry {
  id: string;
  /** ISO time the entry was written. */
  at: string;
  lesson: { id: string; version: string; source: string };
  sectionId: string;
  stepId: string;
  kind: JournalKind;
  question: string;
  answer: { choice?: string; text?: string; pick?: unknown; value?: unknown };
  remember?: string;
  capture?: { name: string; readouts: Record<string, unknown> };
  skipped: boolean;
  /** ISO time the learner committed the answer; precedes the run it predicts. */
  committedAt: string;
  check?: { read: string; op: string; binding: string; expected: unknown; actual: unknown; agrees: boolean };
  slots?: Record<string, { live: unknown; expect: unknown }>;
  runEntryId?: string;
  provenance: Provenance;
}

export interface Notebook {
  schemaVersion: number;
  entries: NotebookEntry[];
  /** Lesson steps, oldest first (v2). */
  journal: JournalEntry[];
  /** Entries this version couldn't read. Kept as-is and written back, never dropped. */
  unreadable?: unknown[];
  /** Journal entries this version couldn't read. Kept and written back the same way. */
  unreadableJournal?: unknown[];
}

export function emptyNotebook(): Notebook {
  return { schemaVersion: NOTEBOOK_SCHEMA_VERSION, entries: [], journal: [] };
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
  /** Defaults to the experiment's lesson, when it has one. */
  lessonId?: string | null;
  autoSave?: { lessonId: string; stepId: string } | null;
  run: Omit<RunSnapshot, 'response'> & { response: GenerateResponse };
  /** Everything about the run the responses themselves don't carry. */
  provenance?: ProvenanceExtras;
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
    predictions: predictionsReadout(r.top_predictions, lastTok?.text ?? null),
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
    lessonId: input.lessonId ?? lessonIdForExperiment(input.experiment?.id),
    autoSave: input.autoSave ?? null,
    run: { ...input.run, response },
    provenance: buildProvenance({ ...input.run, response }, input.provenance),
  };
}

// ---------------------------------------------------------------------------
// Provenance (plan T5b)
// ---------------------------------------------------------------------------

/** The `/health` fields provenance reads (T4-py added the library versions). */
export interface ProvenanceHealth {
  version?: string | null;
  device?: string | null;
  torch?: string | null;
  cuda?: string | null;
  transformer_lens?: string | null;
  sae_lens?: string | null;
  transformers?: string | null;
}

/** What the caller knows about a run beyond the sidecar responses. */
export interface ProvenanceExtras {
  appVersion?: string | null;
  health?: ProvenanceHealth | null;
  /** Prompts the steering persistence check ran on. */
  persistencePrompts?: string[];
  /** Used when there is no circuit response to read the threshold from. */
  circuitThreshold?: number | null;
  compare?: { a: string; b: string } | null;
  /** The tool's `snapshot()` view state, stored as given (T3 supplies it). */
  snapshot?: unknown;
}

// Provenance echoes the sidecar returns since T4-py (MF-5). types.ts gains them
// in T4-ts; they are read structurally here so this file doesn't wait on that.
interface ResponseEchoes {
  model_revision?: string | null;
  sae?: { release: string; id: string } | null;
}
interface SteerEchoes {
  sae_layer?: number | null;
  control?: unknown;
}
interface AblateEchoes {
  ablations?: { layer: number; head: number }[] | null;
  feature_ablations?: { feature_index: number; layer: number }[] | null;
}
interface DLAEchoes {
  answer_token?: string;
  contrast_token?: string | null;
}

function patchType(t: string): 'head' | 'mlp' | 'resid' {
  if (t.startsWith('head')) return 'head';
  if (t.startsWith('mlp')) return 'mlp';
  return 'resid';
}

/** Provenance for one run: what its responses echo back, plus the caller's extras. */
export function buildProvenance(
  run: Omit<RunSnapshot, 'response'> & { response: SavedResponse | null },
  extras: ProvenanceExtras = {},
): Provenance {
  const r = run.response as (SavedResponse & ResponseEchoes) | null;
  const health = extras.health ?? null;
  const saeLayer = run.saeLayer ?? r?.sae_layer_used ?? null;
  const heads = (run.headAblateResponse as (AblateResponse & AblateEchoes) | null)?.ablations ?? [];
  const feats = (run.featureAblateResponse as (AblateResponse & AblateEchoes) | null)?.feature_ablations ?? [];
  const steer = run.steerResponse as (SteerResponse & SteerEchoes) | null;
  const dla = run.dlaResponse as (DLAResponse & DLAEchoes) | null;
  const patch = run.patchResponse;
  return {
    appVersion: extras.appVersion ?? null,
    sidecarVersion: health?.version ?? null,
    torchVersion: health?.torch ?? null,
    cudaVersion: health?.cuda ?? null,
    device: health?.device ?? null,
    transformerLensVersion: health?.transformer_lens ?? null,
    saeLensVersion: health?.sae_lens ?? null,
    transformersVersion: health?.transformers ?? null,
    modelPreset: r?.preset_id ?? run.activePresetId ?? null,
    modelRevision: r?.model_revision ?? null,
    sae: r?.sae && saeLayer !== null ? { release: r.sae.release, id: r.sae.id, layer: saeLayer } : null,
    prompt: r?.prompt ?? null,
    temperature: r?.temperature_used ?? null,
    // The sidecar reports a seed only for sampled runs (temperature above 0).
    seed: r?.seed_used ?? null,
    knockouts: {
      heads: heads.map((h) => ({ layer: h.layer, head: h.head })),
      features: feats.map((f) => f.feature_index),
    },
    steering: steer
      ? {
          featureId: steer.feature_id,
          strength: steer.alpha,
          layer: steer.sae_layer ?? saeLayer ?? -1,
          control: steer.control != null,
          persistencePrompts: extras.persistencePrompts ?? [],
        }
      : null,
    dla: dla ? { answer: dla.answer_token || dla.target_token, contrast: dla.contrast_token ?? null } : null,
    patch: patch
      ? { clean: patch.clean_prompt, corrupted: patch.corrupted_prompt, type: patchType(patch.patch_type) }
      : null,
    circuitThreshold: run.circuitResponse?.threshold ?? extras.circuitThreshold ?? null,
    compare: extras.compare ?? null,
    snapshot: extras.snapshot,
  };
}

// ---------------------------------------------------------------------------
// Journal (plan T5b)
// ---------------------------------------------------------------------------

export class JournalOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalOrderError';
  }
}

/**
 * Append a journal entry (an entry with the same id is replaced in place).
 * A prediction must be committed before the run it predicts: an entry whose
 * linked run was saved earlier than its committedAt is refused.
 */
export function addJournalEntry(nb: Notebook, entry: JournalEntry): Notebook {
  if (entry.runEntryId) {
    const run = nb.entries.find((e) => e.id === entry.runEntryId);
    if (run && Date.parse(run.createdAt) < Date.parse(entry.committedAt)) {
      throw new JournalOrderError(`Journal entry ${entry.id} was committed after the run it points to.`);
    }
  }
  const i = nb.journal.findIndex((j) => j.id === entry.id);
  const journal = i < 0 ? [...nb.journal, entry] : nb.journal.map((j, k) => (k === i ? entry : j));
  return { ...nb, journal };
}

/**
 * Save a run the Lessons runner made by itself at an observe step, with its
 * journal entry. The previous auto-saved run for the same (lesson, step) and
 * its observe entry are replaced, so re-running a step doesn't pile up runs.
 */
export function recordAutoRun(nb: Notebook, run: NotebookEntry, observe: JournalEntry): Notebook {
  const key = run.autoSave;
  if (!key) throw new Error('recordAutoRun needs an entry with autoSave set.');
  const replaced = new Set(
    nb.entries
      .filter((e) => e.autoSave?.lessonId === key.lessonId && e.autoSave.stepId === key.stepId)
      .map((e) => e.id),
  );
  const entries = [run, ...nb.entries.filter((e) => !replaced.has(e.id))];
  const journal = nb.journal.filter(
    (j) => !(j.kind === 'observe' && j.runEntryId !== undefined && replaced.has(j.runEntryId)),
  );
  return addJournalEntry({ ...nb, entries, journal }, { ...observe, runEntryId: run.id });
}

const captureKey = (lessonId: string, name: string) => `${lessonId}\u0000${name}`;

export interface JournalIndex {
  /** Latest entry per `remember` key, whatever the step kind. */
  byRemember: Map<string, JournalEntry>;
  /** Latest capture per (lesson, capture name). */
  byCapture: Map<string, JournalEntry>;
}

/** Later `at` wins; on a tie, the entry written later wins. */
export function indexJournal(journal: JournalEntry[]): JournalIndex {
  const byRemember = new Map<string, JournalEntry>();
  const byCapture = new Map<string, JournalEntry>();
  const newer = (a: JournalEntry, b: JournalEntry | undefined) => !b || Date.parse(a.at) >= Date.parse(b.at);
  for (const j of journal) {
    if (j.remember && newer(j, byRemember.get(j.remember))) byRemember.set(j.remember, j);
    if (j.capture) {
      const k = captureKey(j.lesson.id, j.capture.name);
      if (newer(j, byCapture.get(k))) byCapture.set(k, j);
    }
  }
  return { byRemember, byCapture };
}

/** What `:earlier` / `$earlier` read for a remember key. `text` is "skipped" for a skipped step. */
export interface EarlierRead {
  entry: JournalEntry;
  skipped: boolean;
  value: unknown;
  text: string;
}

function answerValue(a: JournalEntry['answer']): unknown {
  return a.choice ?? a.text ?? a.pick ?? a.value ?? null;
}

export function readEarlier(index: JournalIndex, key: string): EarlierRead | null {
  const entry = index.byRemember.get(key);
  if (!entry) return null;
  if (entry.skipped) return { entry, skipped: true, value: null, text: 'skipped' };
  const value = answerValue(entry.answer);
  return { entry, skipped: false, value, text: typeof value === 'string' ? value : JSON.stringify(value) };
}

export function readCapture(index: JournalIndex, lessonId: string, name: string): JournalEntry['capture'] | null {
  return index.byCapture.get(captureKey(lessonId, name))?.capture ?? null;
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
  // Unreadable entries go back at the end so a later Pry can still read them.
  const entries: unknown[] = [...nb.entries, ...(nb.unreadable ?? [])];
  const journal: unknown[] = [...nb.journal, ...(nb.unreadableJournal ?? [])];
  return JSON.stringify({ schemaVersion: NOTEBOOK_SCHEMA_VERSION, entries, journal }, null, 2);
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

function looksLikeJournalEntry(v: unknown): v is JournalEntry {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.at === 'string' &&
    isObj(v.lesson) &&
    typeof v.lesson.id === 'string' &&
    typeof v.stepId === 'string' &&
    typeof v.kind === 'string' &&
    isObj(v.answer) &&
    typeof v.skipped === 'boolean' &&
    typeof v.committedAt === 'string'
  );
}

/** Fill the v2 fields on an entry; v1 entries get their lesson from the experiment card. */
function migrateEntry(e: NotebookEntry): NotebookEntry {
  const v = e as Partial<NotebookEntry> & NotebookEntry;
  return {
    ...e,
    lessonId: v.lessonId ?? lessonIdForExperiment(e.experiment?.id),
    autoSave: v.autoSave ?? null,
    provenance: v.provenance ?? null,
  };
}

/**
 * Parse a saved notebook. Throws NotebookParseError on unreadable files or a
 * newer schema, so the caller never overwrites data it doesn't understand.
 * A v1 file migrates on read: an empty journal, and each run gets the lesson
 * its experiment card became. Entries this version can't read are kept aside
 * and written back.
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
  const all: unknown[] = Array.isArray(raw.entries) ? raw.entries : [];
  const entries = all.filter(looksLikeEntry).map(migrateEntry);
  const unreadable = all.filter((e) => !looksLikeEntry(e));
  const allJournal: unknown[] = Array.isArray(raw.journal) ? raw.journal : [];
  const journal = allJournal.filter(looksLikeJournalEntry);
  const unreadableJournal = allJournal.filter((j) => !looksLikeJournalEntry(j));
  return {
    schemaVersion: NOTEBOOK_SCHEMA_VERSION,
    entries,
    journal,
    ...(unreadable.length ? { unreadable } : {}),
    ...(unreadableJournal.length ? { unreadableJournal } : {}),
  };
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

/** Raw byte access to the notebook file and its backup, so the backup is an exact copy. */
export interface NotebookBytesIO {
  /** Null when the file doesn't exist. */
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: Uint8Array): Promise<void>;
}

/**
 * Before the first v2 write: copy a v1 `notebook.json` to `notebook.v1.json`
 * byte for byte, so going back to 0.3.8 only takes a rename. Does nothing when
 * a backup already exists or the current file isn't v1. True when it copied.
 */
export async function backupV1Notebook(
  io: NotebookBytesIO,
  file = NOTEBOOK_FILE,
  backup = NOTEBOOK_V1_BACKUP_FILE,
): Promise<boolean> {
  if ((await io.read(backup)) !== null) return false;
  const bytes = await io.read(file);
  if (bytes === null) return false;
  let version: unknown;
  try {
    version = (JSON.parse(new TextDecoder().decode(bytes)) as { schemaVersion?: unknown }).schemaVersion;
  } catch {
    return false;
  }
  if (typeof version !== 'number' || version >= 2) return false;
  await io.write(backup, bytes);
  return true;
}

async function tauriBytesIO(): Promise<NotebookBytesIO> {
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const { exists, readFile, writeFile } = await import('@tauri-apps/plugin-fs');
  const dir = await appDataDir();
  return {
    async read(name) {
      const path = await join(dir, name);
      return (await exists(path)) ? readFile(path) : null;
    },
    async write(name, data) {
      await writeFile(await join(dir, name), data);
    },
  };
}

// Plain `npm run dev`: localStorage holds strings, so "bytes" are the stored text.
const storageKeys: Record<string, string> = {
  [NOTEBOOK_FILE]: NOTEBOOK_STORAGE_KEY,
  [NOTEBOOK_V1_BACKUP_FILE]: NOTEBOOK_V1_BACKUP_STORAGE_KEY,
};
const storageBytesIO: NotebookBytesIO = {
  async read(name) {
    const text = localStorage.getItem(storageKeys[name]);
    return text === null ? null : new TextEncoder().encode(text);
  },
  async write(name, data) {
    localStorage.setItem(storageKeys[name], new TextDecoder().decode(data));
  },
};

// Checked once per session: after the first save the file on disk is v2.
let backupChecked = false;

export async function saveNotebook(nb: Notebook): Promise<void> {
  const text = serializeNotebook(nb);
  if (isTauri()) {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const { exists, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const dir = await appDataDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    if (!backupChecked) {
      await backupV1Notebook(await tauriBytesIO());
      backupChecked = true;
    }
    await writeTextFile(await notebookPath(), text);
    return;
  }
  if (!backupChecked) {
    await backupV1Notebook(storageBytesIO);
    backupChecked = true;
  }
  localStorage.setItem(NOTEBOOK_STORAGE_KEY, text);
}
