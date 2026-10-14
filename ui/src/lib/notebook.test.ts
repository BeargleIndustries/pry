import { describe, expect, it } from 'vitest';
import {
  EXPERIMENT_LESSON_IDS,
  JournalOrderError,
  NOTEBOOK_FILE,
  NOTEBOOK_SCHEMA_VERSION,
  NOTEBOOK_V1_BACKUP_FILE,
  NotebookParseError,
  addEntry,
  addJournalEntry,
  backupV1Notebook,
  buildEntry,
  buildProvenance,
  defaultTitle,
  deleteEntry,
  emptyNotebook,
  indexJournal,
  lessonIdForExperiment,
  parseNotebook,
  readCapture,
  readEarlier,
  recordAutoRun,
  serializeNotebook,
  updateEntry,
  type BuildEntryInput,
  type JournalEntry,
  type NotebookBytesIO,
} from './notebook';
import type { AblateResponse, DLAResponse, GenerateResponse, LogitLensResponse } from './types';
import { fullExtras, fullRun } from './__fixtures__/provenance';
import generateJson from './__fixtures__/readouts/generate.json';
import logitLensJson from './__fixtures__/readouts/logit-lens.json';
import dlaJson from './__fixtures__/readouts/dla.json';

const generate = generateJson as GenerateResponse;

function sampleInput(over: Partial<BuildEntryInput> = {}): BuildEntryInput {
  return {
    id: 'e1',
    now: new Date('2026-10-11T12:00:00Z'),
    modelName: 'GPT-2 small',
    display: { neuronpedia_model_id: 'gpt2-small', neuronpedia_release_suffix: 'res-jb' },
    run: {
      response: generate,
      saeLayer: 8,
      activePresetId: 'gpt2-small',
      logitLensResponse: logitLensJson as LogitLensResponse,
      dlaResponse: dlaJson as DLAResponse,
      steerResponse: null,
      headAblateResponse: null,
      featureAblateResponse: null,
      patchResponse: null,
      circuitResponse: null,
    },
    ...over,
  };
}

describe('buildEntry', () => {
  it('keeps prompt, model and results, drops raw attention, and stores readouts', () => {
    const e = buildEntry(sampleInput({ note: 'hello' }));
    expect(e.prompt).toBe(generate.prompt);
    expect(e.title).toBe(generate.prompt);
    expect(e.note).toBe('hello');
    expect(e.model).toEqual({
      presetId: 'gpt2-small',
      name: 'GPT-2 small',
      neuronpediaModelId: 'gpt2-small',
      neuronpediaReleaseSuffix: 'res-jb',
    });
    expect('attention' in e.run.response).toBe(false);
    expect(e.run.response.top_predictions).toEqual(generate.top_predictions);
    expect(e.run.dlaResponse).not.toBeNull();
    expect(e.readouts.predictions).toMatch(/top guess/);
    expect(e.readouts.attention).toMatch(/looks mostly at/);
    expect(e.readouts.logitLens).toBeTruthy();
    expect(e.readouts.dla).toBeTruthy();
    expect(e.createdAt).toBe('2026-10-11T12:00:00.000Z');
  });

  it('does not mutate the live response', () => {
    buildEntry(sampleInput());
    expect(generate.attention.length).toBeGreaterThan(0);
  });
});

describe('defaultTitle', () => {
  it('flattens whitespace and trims long prompts', () => {
    expect(defaultTitle('  a\n b  ')).toBe('a b');
    expect(defaultTitle('')).toBe('Untitled run');
    const t = defaultTitle('x'.repeat(100), 20);
    expect(t.length).toBe(20);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('notebook operations', () => {
  const a = buildEntry(sampleInput({ id: 'a' }));
  const b = buildEntry(sampleInput({ id: 'b', now: new Date('2026-10-12T00:00:00Z') }));

  it('adds newest first and replaces an entry with the same id', () => {
    let nb = addEntry(addEntry(emptyNotebook(), a), b);
    expect(nb.entries.map((e) => e.id)).toEqual(['b', 'a']);
    nb = addEntry(nb, { ...a, note: 'again' });
    expect(nb.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(nb.entries[0].note).toBe('again');
  });

  it('updates title and note without touching the original', () => {
    const nb = addEntry(emptyNotebook(), a);
    const later = new Date('2026-10-13T00:00:00Z');
    const nb2 = updateEntry(nb, 'a', { title: 'Renamed', note: 'new note' }, later);
    expect(nb2.entries[0].title).toBe('Renamed');
    expect(nb2.entries[0].note).toBe('new note');
    expect(nb2.entries[0].updatedAt).toBe(later.toISOString());
    expect(nb.entries[0].title).toBe(a.title);
    // A blank title falls back to the prompt.
    expect(updateEntry(nb, 'a', { title: '   ' }).entries[0].title).toBe(defaultTitle(a.prompt));
  });

  it('deletes by id', () => {
    const nb = addEntry(addEntry(emptyNotebook(), a), b);
    expect(deleteEntry(nb, 'a').entries.map((e) => e.id)).toEqual(['b']);
    expect(deleteEntry(nb, 'missing').entries).toHaveLength(2);
  });
});

describe('serialize / parse', () => {
  it('round-trips with a schema version', () => {
    const nb = addEntry(emptyNotebook(), buildEntry(sampleInput()));
    const text = serializeNotebook(nb);
    expect(JSON.parse(text).schemaVersion).toBe(NOTEBOOK_SCHEMA_VERSION);
    expect(parseNotebook(text)).toEqual(nb);
  });

  it('refuses broken files and newer formats instead of guessing', () => {
    expect(() => parseNotebook('{nope')).toThrow(NotebookParseError);
    expect(() => parseNotebook('[]')).toThrow(NotebookParseError);
    expect(() => parseNotebook('{"entries":[]}')).toThrow(/schema version/);
    expect(() =>
      parseNotebook(JSON.stringify({ schemaVersion: NOTEBOOK_SCHEMA_VERSION + 1, entries: [] })),
    ).toThrow(/newer version/);
  });

  it('drops entries that do not look like entries', () => {
    const good = buildEntry(sampleInput());
    const text = JSON.stringify({ schemaVersion: 1, entries: [good, { id: 3 }, null] });
    expect(parseNotebook(text).entries).toEqual([good]);
  });
});

// ---------------------------------------------------------------------------
// Notebook v2 (T5b)
// ---------------------------------------------------------------------------

/** A v1 file as 0.3.8 wrote it: no journal, entries without lessonId / autoSave / provenance. */
function v1Text(experimentIds: (string | null)[]): string {
  const entries = experimentIds.map((id, i) => {
    const { lessonId: _l, autoSave: _a, provenance: _p, ...v1 } = buildEntry(sampleInput({ id: `v1-${i}` }));
    return { ...v1, experiment: id ? { id, title: id, citations: [] } : null };
  });
  return JSON.stringify({ schemaVersion: 1, entries }, null, 2);
}

function journalEntry(over: Partial<JournalEntry> = {}): JournalEntry {
  const base = buildEntry(sampleInput());
  return {
    id: 'j1',
    at: '2026-10-11T12:00:00.000Z',
    lesson: { id: 'pry.p3-2', version: '1', source: 'bundled' },
    sectionId: 's1',
    stepId: 'step-1',
    kind: 'predict',
    question: 'Which name comes next?',
    answer: { choice: ' Mary' },
    skipped: false,
    committedAt: '2026-10-11T12:00:00.000Z',
    provenance: base.provenance!,
    ...over,
  };
}

function memoryIO(files: Record<string, Uint8Array> = {}): NotebookBytesIO & { files: Record<string, Uint8Array> } {
  return {
    files,
    async read(name) {
      return files[name] ?? null;
    },
    async write(name, data) {
      files[name] = data;
    },
  };
}

describe('notebook v2 migration', () => {
  it('v1 migrates on read: empty journal, v2 fields filled, saved back as v2', () => {
    const nb = parseNotebook(v1Text(['induction', null]));
    expect(nb.schemaVersion).toBe(2);
    expect(nb.journal).toEqual([]);
    expect(nb.entries).toHaveLength(2);
    expect(nb.entries[0].lessonId).toBe('pry.p2-2');
    expect(nb.entries[1].lessonId).toBeNull();
    expect(nb.entries[0].autoSave).toBeNull();
    expect(nb.entries[0].provenance).toBeNull();
    const again = JSON.parse(serializeNotebook(nb));
    expect(again.schemaVersion).toBe(2);
    expect(again.journal).toEqual([]);
  });

  it('every 0.3.8 experiment id maps to its lesson per the table', () => {
    const table: Record<string, string> = {
      induction: 'pry.p2-2',
      'logit-lens': 'pry.p2-3',
      'he-or-she': 'pry.p2-4',
      'ioi-knockout': 'pry.p3-2',
      'ioi-swap': 'pry.p3-3',
      'features-steering': 'pry.p3-5',
      'fact-recall': 'pry.p3-6',
      'greater-than': 'pry.p3-7',
    };
    expect(EXPERIMENT_LESSON_IDS).toEqual(table);
    for (const [exp, lesson] of Object.entries(table)) expect(lessonIdForExperiment(exp)).toBe(lesson);
    expect(lessonIdForExperiment('not-a-card')).toBeNull();
    const nb = parseNotebook(v1Text(Object.keys(table)));
    for (const e of nb.entries) expect(e.lessonId).toBe(table[e.experiment!.id]);
  });

  it('backup is byte-identical, written once, and only for a v1 file', async () => {
    const original = new TextEncoder().encode(v1Text(['ioi-swap']).replace(/\n/g, '\r\n') + '\n');
    const io = memoryIO({ [NOTEBOOK_FILE]: original });
    expect(await backupV1Notebook(io)).toBe(true);
    expect(io.files[NOTEBOOK_V1_BACKUP_FILE]).toEqual(original);
    expect(Buffer.from(io.files[NOTEBOOK_V1_BACKUP_FILE]).equals(Buffer.from(original))).toBe(true);
    // A later save never overwrites the backup.
    io.files[NOTEBOOK_FILE] = new TextEncoder().encode(serializeNotebook(emptyNotebook()));
    expect(await backupV1Notebook(io)).toBe(false);
    expect(io.files[NOTEBOOK_V1_BACKUP_FILE]).toEqual(original);
    // No file, or a v2 file: nothing to back up.
    expect(await backupV1Notebook(memoryIO())).toBe(false);
    const v2 = memoryIO({ [NOTEBOOK_FILE]: new TextEncoder().encode(serializeNotebook(emptyNotebook())) });
    expect(await backupV1Notebook(v2)).toBe(false);
    expect(v2.files[NOTEBOOK_V1_BACKUP_FILE]).toBeUndefined();
  });
});

describe('journal', () => {
  it('journal round-trips', () => {
    const j = journalEntry({
      check: { read: 'top_guess.token', op: 'eq', binding: 'answer', expected: ' Mary', actual: ' Mary', agrees: true },
      slots: { p: { live: 0.62, expect: 0.5 } },
    });
    const nb = addJournalEntry(emptyNotebook(), j);
    const back = parseNotebook(serializeNotebook(nb));
    expect(back.journal).toEqual([j]);
    expect(back).toEqual(nb);
  });

  it(':earlier reads the latest entry per remember key', () => {
    let nb = emptyNotebook();
    nb = addJournalEntry(nb, journalEntry({ id: 'a', at: '2026-10-11T12:00:00.000Z', remember: 'guess', answer: { text: 'first' } }));
    nb = addJournalEntry(nb, journalEntry({ id: 'b', at: '2026-10-11T12:05:00.000Z', remember: 'guess', answer: { text: 'second' } }));
    nb = addJournalEntry(nb, journalEntry({ id: 'c', at: '2026-10-11T12:01:00.000Z', remember: 'other', answer: { text: 'x' } }));
    const index = indexJournal(nb.journal);
    expect(readEarlier(index, 'guess')?.text).toBe('second');
    expect(readEarlier(index, 'guess')?.entry.id).toBe('b');
    expect(readEarlier(index, 'other')?.value).toBe('x');
    expect(readEarlier(index, 'missing')).toBeNull();
  });

  it('a task remember and a question remember are both readable', () => {
    let nb = emptyNotebook();
    nb = addJournalEntry(nb, journalEntry({ id: 't', kind: 'task', remember: 'heads', answer: { value: [{ layer: 9, head: 9 }] } }));
    nb = addJournalEntry(nb, journalEntry({ id: 'q', kind: 'question', remember: 'why', answer: { choice: 'b' } }));
    const index = indexJournal(nb.journal);
    expect(readEarlier(index, 'heads')?.value).toEqual([{ layer: 9, head: 9 }]);
    expect(readEarlier(index, 'why')?.value).toBe('b');
  });

  it('a capture round-trips', () => {
    const cap = { name: 'before', readouts: { 'top_guess.token': ' Mary', 'top_guess.prob': 0.62 } };
    let nb = addJournalEntry(emptyNotebook(), journalEntry({ id: 'c1', kind: 'capture', capture: { name: 'before', readouts: { old: 1 } } }));
    nb = addJournalEntry(nb, journalEntry({ id: 'c2', kind: 'capture', at: '2026-10-11T12:09:00.000Z', capture: cap }));
    nb = addJournalEntry(nb, journalEntry({ id: 'c3', kind: 'capture', lesson: { id: 'pry.p2-2', version: '1', source: 'bundled' }, capture: { name: 'before', readouts: { other: 2 } } }));
    const back = parseNotebook(serializeNotebook(nb));
    const index = indexJournal(back.journal);
    expect(readCapture(index, 'pry.p3-2', 'before')).toEqual(cap);
    expect(readCapture(index, 'pry.p2-2', 'before')?.readouts).toEqual({ other: 2 });
    expect(readCapture(index, 'pry.p3-2', 'after')).toBeNull();
  });

  it('a skipped remember entry reads "skipped"', () => {
    const nb = addJournalEntry(emptyNotebook(), journalEntry({ remember: 'guess', skipped: true, answer: {} }));
    const read = readEarlier(indexJournal(nb.journal), 'guess');
    expect(read?.skipped).toBe(true);
    expect(read?.text).toBe('skipped');
  });

  it('observe auto entry replaced per (lesson, step)', () => {
    const auto = (id: string, stepId: string, at: string) =>
      buildEntry(sampleInput({ id, now: new Date(at), autoSave: { lessonId: 'pry.p3-2', stepId } }));
    const observe = (id: string, stepId: string, at: string) =>
      journalEntry({ id, kind: 'observe', stepId, at, committedAt: at });
    let nb = addEntry(emptyNotebook(), buildEntry(sampleInput({ id: 'manual' })));
    nb = recordAutoRun(nb, auto('r1', 'see', '2026-10-11T12:01:00Z'), observe('o1', 'see', '2026-10-11T12:01:00.000Z'));
    nb = recordAutoRun(nb, auto('r2', 'other', '2026-10-11T12:02:00Z'), observe('o2', 'other', '2026-10-11T12:02:00.000Z'));
    nb = recordAutoRun(nb, auto('r3', 'see', '2026-10-11T12:03:00Z'), observe('o3', 'see', '2026-10-11T12:03:00.000Z'));
    expect(nb.entries.map((e) => e.id).sort()).toEqual(['manual', 'r2', 'r3']);
    expect(nb.journal.map((j) => j.id).sort()).toEqual(['o2', 'o3']);
    expect(nb.journal.find((j) => j.id === 'o3')?.runEntryId).toBe('r3');
  });

  it('committedAt precedes the run', () => {
    const run = buildEntry(sampleInput({ id: 'run', now: new Date('2026-10-11T12:00:10Z') }));
    const nb = addEntry(emptyNotebook(), run);
    const predict = journalEntry({ id: 'p', committedAt: '2026-10-11T12:00:05.000Z', runEntryId: 'run' });
    const ok = addJournalEntry(nb, predict);
    expect(Date.parse(ok.journal[0].committedAt)).toBeLessThan(Date.parse(run.createdAt));
    // An answer committed after its run was seen is refused.
    const late = journalEntry({ id: 'late', committedAt: '2026-10-11T12:00:20.000Z', runEntryId: 'run' });
    expect(() => addJournalEntry(nb, late)).toThrow(JournalOrderError);
  });

  it('journal entries this version cannot read are kept and written back', () => {
    const weird = { id: 'future-step', shape: 'unknown' };
    const nb = parseNotebook(JSON.stringify({ schemaVersion: 2, entries: [], journal: [weird] }));
    expect(nb.journal).toEqual([]);
    expect(JSON.parse(serializeNotebook(nb)).journal).toContainEqual(weird);
  });
});

describe('provenance', () => {
  it('provenance captures ablated heads', () => {
    const headAblate = {
      preset_id: 'gpt2-small',
      prompt: generate.prompt,
      original_predictions: [],
      ablated_predictions: [],
      prediction_delta: [],
      timing_ms: {},
      ablations: [{ layer: 9, head: 9 }, { layer: 10, head: 0 }],
    } as AblateResponse;
    const base = sampleInput();
    const e = buildEntry({ ...base, run: { ...base.run, headAblateResponse: headAblate } });
    expect(e.provenance?.knockouts.heads).toEqual([{ layer: 9, head: 9 }, { layer: 10, head: 0 }]);
    expect(e.provenance?.knockouts.features).toEqual([]);
  });

  it('fills every field from the responses, /health and the caller', () => {
    const p = buildProvenance(fullRun(), fullExtras());
    for (const [k, v] of Object.entries(p)) expect(v, k).not.toBeNull();
    expect(p.modelRevision).toBe('607a30d783dfa663caf39e06633721c8d4cfcd7e');
    expect(p.sae).toEqual({ release: 'gpt2-small-res-jb', id: 'blocks.8.hook_resid_pre', layer: 8 });
    expect(p.steering).toEqual({ featureId: 1234, strength: 8, layer: 8, control: true, persistencePrompts: ['I went to the'] });
    expect(p.dla).toEqual({ answer: ' Mary', contrast: ' John' });
    expect(p.patch?.type).toBe('head');
    expect(p.circuitThreshold).toBe(0.05);
    expect(p.snapshot).toEqual({ tab: 'dla' });
  });
});

describe('entries this version cannot read', () => {
  it('are kept and written back, never dropped', () => {
    const weird = { id: 'from-the-future', shape: 'unknown' };
    const text = JSON.stringify({ schemaVersion: 1, entries: [weird] });
    const nb = parseNotebook(text);
    expect(nb.entries).toEqual([]);
    expect(nb.unreadable).toEqual([weird]);
    const again = JSON.parse(serializeNotebook(nb));
    expect(again.entries).toContainEqual(weird);
  });
});
