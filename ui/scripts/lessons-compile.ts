// Compiles lessons to JSON (the shape lesson.v1.schema.json describes).
//
//   npm run lessons:compile -- <folder> [--out file.json]
//   npm run lessons:compile -- --rows [--out file.json]
//
// <folder> is one lesson folder or a folder of lesson folders. Exits 1 when a
// lesson doesn't parse.
//
// --rows (plan T6a, R5-6): reads src/lessons/verified-rows.yaml and writes
// src/lessons/__generated__/row-requests.json: every row's requests as
// {endpoint, body, key}, bodies built by the app's own builders in
// src/lib/sidecar.ts (C4-9), keys by registry/request-key.ts.
// sidecar/tests/test_lessons.py sends them.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { pryToolSet } from '../src/lib/lessons/registry/pry-set';
import { formatIssue, hasErrors } from '../src/lib/lessons/format/errors';
import { loadLessonSource } from '../src/lib/lessons/format/normalise';
import { requestKey } from '../src/lib/lessons/registry/request-key';
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
  buildSteerRequest,
} from '../src/lib/sidecar';

const UI = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROWS_YAML = join(UI, 'src/lessons/verified-rows.yaml');
export const ROW_REQUESTS_JSON = join(UI, 'src/lessons/__generated__/row-requests.json');

/** Watch it write's default length (watch-it-write.ts DEFAULT_NEW_TOKENS). */
const WRITE_IT_TOKENS = 20;
/** Compare mode's feature count (compare-run.ts COMPARE_TOP_K_FEATURES). */
const COMPARE_TOP_K = 20;
/** GPT-2 small's layers x heads, for `heads: all-single`. */
const GRID = 12;

type Head = [number, number];
export interface RowRequestSpec {
  name: string;
  action: string;
  repeat?: number;
  network?: boolean;
  offline?: boolean;
  [arg: string]: unknown;
}
export interface RowSpec {
  id: number;
  label?: string;
  outline: string[];
  lessons: string[];
  requests: RowRequestSpec[];
  record: string;
  claim: string;
  status: 'verified' | 'narrowed' | 'failed' | 'needs-brad';
  note?: string;
}
export interface RowRequest {
  name: string;
  endpoint: string;
  body: unknown;
  key: string;
  repeat: number;
  network: boolean;
  offline: boolean;
}

function one(model: string, r: RowRequestSpec): { endpoint: string; body: unknown } {
  const presetId = model;
  const s = (k: string) => r[k] as string;
  const n = (k: string) => r[k] as number | undefined;
  switch (r.action) {
    case 'run':
      return { endpoint: '/generate', body: buildGenerateRequest({ presetId, prompt: s('prompt'), topKFeatures: n('topKFeatures') }) };
    case 'compare':
      return { endpoint: '/generate', body: buildGenerateRequest({ presetId, prompt: s('prompt'), topKFeatures: COMPARE_TOP_K }) };
    case 'writeIt':
      // The same body generateStepwise sends for Watch it write.
      return {
        endpoint: '/generate',
        body: buildGenerateRequest({
          presetId,
          prompt: s('prompt'),
          maxNewTokens: n('maxNewTokens') ?? WRITE_IT_TOKENS,
          temperature: n('temperature') ?? 0,
          seed: (r.seed as number | undefined) ?? null,
          topKFeatures: 1,
        }),
      };
    case 'logitLens':
      return { endpoint: '/logit-lens', body: buildLogitLensRequest({ presetId, prompt: s('prompt'), trackTokens: r.trackTokens as string[] | undefined }) };
    case 'dla':
      return {
        endpoint: '/dla',
        body: buildDLARequest({
          presetId,
          prompt: s('prompt'),
          targetTokenIndex: n('targetTokenIndex'),
          answerToken: (r.answerToken as string | undefined) ?? null,
          contrastToken: (r.contrastToken as string | undefined) ?? null,
        }),
      };
    case 'patch':
      return {
        endpoint: '/patch',
        body: buildPatchRequest({
          presetId,
          cleanPrompt: s('cleanPrompt'),
          corruptedPrompt: s('corruptedPrompt'),
          patchType: r.patchType as 'head' | 'mlp' | 'resid',
        }),
      };
    case 'ablateHeads':
      return {
        endpoint: '/ablate-head',
        body: buildAblateHeadsRequest({
          presetId,
          prompt: s('prompt'),
          ablations: (r.heads as Head[]).map(([layer, head]) => ({ layer, head })),
        }),
      };
    case 'ablateFeatures':
      return {
        endpoint: '/ablate-feature',
        body: buildAblateFeaturesRequest({
          presetId,
          prompt: s('prompt'),
          featureAblations: (r.features as number[]).map((feature_index) => ({ feature_index, layer: r.layer as number })),
        }),
      };
    case 'steer':
      // MF-4: every lesson steer runs with the norm-matched control.
      return {
        endpoint: '/steer',
        body: buildSteerRequest({
          presetId,
          prompt: s('prompt'),
          featureId: r.featureId as number,
          saeLayer: r.saeLayer as number,
          alpha: r.alpha as number,
          maxNewTokens: n('maxNewTokens'),
          control: true,
        }),
      };
    case 'circuit':
      return {
        endpoint: '/circuit',
        body: buildCircuitRequest({ presetId, prompt: s('prompt'), source: 'dla', targetTokenIndex: n('targetTokenIndex') }),
      };
    case 'headScores':
      return { endpoint: '/head-scores', body: buildHeadScoresRequest({ presetId }) };
    case 'embedding':
      return { endpoint: '/embedding', body: buildEmbeddingRequest({ presetId, prompt: s('prompt'), positions: r.positions as number[] }) };
    default:
      throw new Error(`verified-rows.yaml: unknown action ${JSON.stringify(r.action)} in request ${r.name}`);
  }
}

/** One spec, with `singles` / `heads: all-single` expanded to one request per head. */
function expand(r: RowRequestSpec): RowRequestSpec[] {
  let singles: Head[] | undefined = r.singles as Head[] | undefined;
  if (r.heads === 'all-single') {
    singles = [];
    for (let l = 0; l < GRID; l++) for (let h = 0; h < GRID; h++) singles.push([l, h]);
  }
  if (!singles) return [r];
  return singles.map(([l, h]) => ({ ...r, singles: undefined, name: `${r.name}:L${l}H${h}`, heads: [[l, h]] }));
}

export async function buildRowRequests(yamlText: string): Promise<{ model: string; rows: (RowSpec & { built: RowRequest[] })[] }> {
  const doc = parseYaml(yamlText) as { model: string; rows: RowSpec[] };
  const rows = [];
  for (const row of doc.rows) {
    const built: RowRequest[] = [];
    for (const spec of row.requests ?? []) {
      for (const r of expand(spec)) {
        const { endpoint, body } = one(doc.model, r);
        built.push({
          name: r.name,
          endpoint,
          body,
          key: await requestKey({ endpoint, model: doc.model, body }),
          repeat: r.repeat ?? 1,
          network: r.network ?? false,
          offline: r.offline ?? false,
        });
      }
    }
    rows.push({ ...row, built });
  }
  return { model: doc.model, rows };
}

export async function rowRequestsJson(yamlText: string): Promise<string> {
  const { model, rows } = await buildRowRequests(yamlText);
  const out = {
    _about:
      'Generated by `npm run lessons:compile -- --rows` from verified-rows.yaml (plan T6a). Bodies come from the app builders in ui/src/lib/sidecar.ts; keys from registry/request-key.ts. Do not edit.',
    model,
    rows: rows.map((r) => ({
      id: r.id,
      ...(r.label ? { label: r.label } : {}),
      status: r.status,
      lessons: r.lessons,
      outline: r.outline,
      claim: r.claim,
      requests: r.built,
    })),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function compile(root: string): { lessons: unknown[]; errors: string[] } {
  const files = existsSync(join(root, 'lesson.md'))
    ? [join(root, 'lesson.md')]
    : readdirSync(root)
        .filter((d) => !d.startsWith('_') && existsSync(join(root, d, 'lesson.md')))
        .sort()
        .map((d) => join(root, d, 'lesson.md'));
  const lessons: unknown[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const rel = relative(process.cwd(), file) || file;
    const { lesson, issues } = loadLessonSource(readFileSync(file, 'utf8'), { mode: 'strict', tool: pryToolSet, file: rel });
    if (hasErrors(issues) || !lesson) errors.push(...issues.filter((i) => i.severity === 'error').map(formatIssue));
    else lessons.push(lesson);
  }
  return { lessons, errors };
}

if (!process.env.VITEST) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? argv[outAt + 1] : undefined;
  if (argv.includes('--rows')) {
    const text = await rowRequestsJson(readFileSync(ROWS_YAML, 'utf8'));
    writeFileSync(out ?? ROW_REQUESTS_JSON, text);
    console.log(`wrote ${relative(process.cwd(), out ?? ROW_REQUESTS_JSON)}`);
    process.exit(0);
  }
  const target = argv.find((a, i) => !a.startsWith('--') && i !== outAt + 1);
  if (!target) {
    console.error('Usage: npm run lessons:compile -- <folder> [--out file.json]');
    process.exit(2);
  }
  const { lessons, errors } = compile(resolve(target));
  for (const e of errors) console.error(e);
  const text = `${JSON.stringify({ lessons }, null, 2)}\n`;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
  process.exit(errors.length ? 1 : 0);
}
