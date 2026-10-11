import { describe, expect, it } from 'vitest';
import {
  NOTEBOOK_SCHEMA_VERSION,
  NotebookParseError,
  addEntry,
  buildEntry,
  defaultTitle,
  deleteEntry,
  emptyNotebook,
  parseNotebook,
  serializeNotebook,
  updateEntry,
  type BuildEntryInput,
} from './notebook';
import type { DLAResponse, GenerateResponse, LogitLensResponse } from './types';
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
