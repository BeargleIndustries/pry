import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import {
  buildAblateFeaturesRequest,
  buildAblateHeadsRequest,
  buildCircuitRequest,
  buildDLARequest,
  buildEmbeddingRequest,
  buildGenerateRequest,
  buildHeadScoresRequest,
  buildLogitLensRequest,
  buildPatchRequest,
  buildSaeFeaturesRequest,
  buildSteerRequest,
  fetchDLA,
  fetchEmbedding,
  generateStepwise,
  runPatching,
  steerGenerate,
} from './sidecar';
import { requestKey } from './lessons/registry/request-key';

// Field names of each request model, read from the sidecar's own schemas.py so
// a rename on either side fails here.
const SCHEMAS = readFileSync(
  fileURLToPath(new URL('../../../sidecar/pry_sidecar/schemas.py', import.meta.url)),
  'utf-8',
).replace(/\r\n/g, '\n');

function schemaFields(model: string): string[] {
  const m = new RegExp(`^class ${model}\\(BaseModel\\):\\n((?:(?:    .*)?\\n)+)`, 'm').exec(SCHEMAS);
  if (!m) throw new Error(`no ${model} in schemas.py`);
  return [...m[1].matchAll(/^ {4}(\w+): /gm)].map((f) => f[1]);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('sidecar request bodies', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The path and parsed JSON body of the last request the app's client sent. */
  function sent(): { path: string; body: Record<string, unknown> } {
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    return { path: new URL(String(url)).pathname, body: JSON.parse(String((init as RequestInit).body)) };
  }

  it('/embedding and DLA contrast requests serialise as the sidecar\'s schemas expect', async () => {
    await fetchEmbedding('gpt2-small', 'The cat sat', [0, 2]);
    const emb = sent();
    expect(emb.path).toBe('/embedding');
    expect(emb.body).toEqual({ preset_id: 'gpt2-small', prompt: 'The cat sat', positions: [0, 2] });
    expect(schemaFields('EmbeddingRequest')).toEqual(expect.arrayContaining(Object.keys(emb.body)));

    await fetchDLA('gpt2-small', 'When Mary and John went to the store, John gave a drink to', 13, {
      answerToken: ' Mary',
      contrastToken: ' John',
    });
    const dla = sent();
    expect(dla.path).toBe('/dla');
    expect(dla.body).toEqual({
      preset_id: 'gpt2-small',
      prompt: 'When Mary and John went to the store, John gave a drink to',
      target_token_index: 13,
      answer_token: ' Mary',
      contrast_token: ' John',
    });
    const dlaFields = schemaFields('DLARequest');
    expect(dlaFields).toEqual(expect.arrayContaining(['answer_token', 'contrast_token']));
    expect(dlaFields).toEqual(expect.arrayContaining(Object.keys(dla.body)));

    // Without a contrast the body is 0.3.8's: no new keys.
    await fetchDLA('gpt2-small', 'Hello there');
    expect(sent().body).toEqual({ preset_id: 'gpt2-small', prompt: 'Hello there' });

    await steerGenerate('gpt2-small', 'Hi', 7, 6, 4, 50, true);
    const steer = sent();
    expect(steer.body.control).toBe(true);
    expect(schemaFields('SteerRequest')).toEqual(expect.arrayContaining(Object.keys(steer.body)));
  });

  it('every body builder uses only its request model\'s field names', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['GenerateRequest', buildGenerateRequest({ presetId: 'p', prompt: 'x', maxNewTokens: 3, topKFeatures: 2, saeLayer: 1, temperature: 0.7, seed: 1 })],
      ['SAEFeaturesRequest', buildSaeFeaturesRequest({ presetId: 'p', prompt: 'x', saeLayer: 2 })],
      ['LogitLensRequest', buildLogitLensRequest({ presetId: 'p', prompt: 'x' })],
      ['DLARequest', buildDLARequest({ presetId: 'p', prompt: 'x', targetTokenIndex: 1, answerToken: 'a', contrastToken: 'b' })],
      ['EmbeddingRequest', buildEmbeddingRequest({ presetId: 'p', prompt: 'x', positions: [1] })],
      ['SteerRequest', buildSteerRequest({ presetId: 'p', prompt: 'x', featureId: 1, saeLayer: 2, alpha: 3, control: true })],
      ['AblateHeadRequest', buildAblateHeadsRequest({ presetId: 'p', prompt: 'x', ablations: [{ layer: 1, head: 2 }] })],
      ['AblateFeatureRequest', buildAblateFeaturesRequest({ presetId: 'p', prompt: 'x', featureAblations: [{ feature_index: 1, layer: 2 }] })],
      ['PatchRequest', buildPatchRequest({ presetId: 'p', cleanPrompt: 'a', corruptedPrompt: 'b', patchType: 'resid', targetTokenIndex: 1 })],
      ['CircuitRequest', buildCircuitRequest({ presetId: 'p', prompt: 'x', source: 'patching', threshold: 0.1, targetTokenIndex: 1 })],
      ['HeadScoresRequest', buildHeadScoresRequest({ presetId: 'p' })],
    ];
    for (const [model, body] of cases) {
      expect(schemaFields(model), model).toEqual(expect.arrayContaining(Object.keys(body)));
    }
  });

  it('a row request and the app\'s request for the same action produce the same request key', async () => {
    // A row request spells every default out and lists args in another order;
    // the app's call leans on the defaults. Same action, same key.
    const keyOf = (endpoint: string, body: Record<string, unknown>) =>
      requestKey({ endpoint, model: String(body.preset_id), body });

    await steerGenerate('gpt2-small', 'I think that', 1234, 6, 8);
    const appSteer = sent();
    const rowSteer = buildSteerRequest({ control: false, maxNewTokens: 50, alpha: 8, saeLayer: 6, featureId: 1234, prompt: 'I think that', presetId: 'gpt2-small' });
    expect(await keyOf('/steer', rowSteer)).toBe(await keyOf(appSteer.path, appSteer.body));

    await fetchDLA('gpt2-small', 'The Eiffel Tower is in', undefined, { answerToken: ' Paris', contrastToken: ' Rome' });
    const appDla = sent();
    const rowDla = buildDLARequest({ contrastToken: ' Rome', answerToken: ' Paris', prompt: 'The Eiffel Tower is in', presetId: 'gpt2-small' });
    expect(await keyOf('/dla', rowDla)).toBe(await keyOf(appDla.path, appDla.body));

    await runPatching('gpt2-small', 'Mary gave it to', 'John gave it to');
    const appPatch = sent();
    const rowPatch = buildPatchRequest({ patchType: 'head', corruptedPrompt: 'John gave it to', cleanPrompt: 'Mary gave it to', presetId: 'gpt2-small' });
    expect(await keyOf('/patch', rowPatch)).toBe(await keyOf(appPatch.path, appPatch.body));

    await generateStepwise('gpt2-small', 'Once upon a time', { maxNewTokens: 20, temperature: 0.8, seed: 42 });
    const appGen = sent();
    const rowGen = buildGenerateRequest({ seed: 42, temperature: 0.8, topKFeatures: 1, maxNewTokens: 20, prompt: 'Once upon a time', presetId: 'gpt2-small' });
    expect(await keyOf('/generate', rowGen)).toBe(await keyOf(appGen.path, appGen.body));

    // The Run button's body (analysis-core) is the builder's defaults.
    expect(buildGenerateRequest({ presetId: 'gpt2-small', prompt: 'Hi' })).toEqual({
      preset_id: 'gpt2-small',
      prompt: 'Hi',
      max_new_tokens: 0,
      top_k_features: 5,
    });

    // A different action gets a different key.
    expect(await keyOf('/dla', buildDLARequest({ presetId: 'gpt2-small', prompt: 'The Eiffel Tower is in', answerToken: ' Paris' }))).not.toBe(
      await keyOf(appDla.path, appDla.body),
    );
  });
});
