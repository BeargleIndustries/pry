// Compiles lessons to JSON (the shape lesson.v1.schema.json describes).
//
//   npm run lessons:compile -- <folder> [--out file.json]
//   npm run lessons:compile -- --rows [--out file.json]
//   npm run lessons:compile -- --expectations
//
// <folder> is one lesson folder or a folder of lesson folders. Exits 1 when a
// lesson doesn't parse.
//
// --rows (plan T6a, R5-6): reads src/lessons/verified-rows.yaml and writes
// src/lessons/__generated__/row-requests.json: every row's requests as
// {endpoint, body, key}, bodies built by the app's own builders in
// src/lib/sidecar.ts (C4-9), keys by registry/request-key.ts.
// sidecar/tests/test_lessons.py sends them. It also derives every row's
// `constants:` (row constants, plan:297/:299) from that row's recorded values
// in rows.json and writes them back as `rows[].constants`; nothing else in
// rows.json changes. Re-run it after `pytest ... --record`.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { pryToolSet } from '../src/lib/lessons/registry/pry-set';
import { formatIssue, hasErrors } from '../src/lib/lessons/format/errors';
import { loadLessonSource } from '../src/lib/lessons/format/normalise';
import { requestKey } from '../src/lib/lessons/registry/request-key';
import { ROW_UNITS, type RowConstant, type RowConstants, type RowUnit } from '../src/lib/lessons/row-constants';
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
export const ROWS_JSON = join(UI, 'src/lessons/__generated__/rows.json');
export const RESPONSES_DIR = join(UI, 'src/lessons/__generated__/responses');

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
  status: 'verified' | 'narrowed' | 'failed' | 'needs-brad' | 'closed-by-task';
  note?: string;
  constants?: Record<string, ConstantSpec>;
}

/**
 * One row constant: exactly one derivation over the row's recorded `values`
 * (dotted paths; list indexes are numbers), plus its unit.
 *   path: a.b.0                        the value there
 *   token_prob: top4, token: " Qu"     that token's probability in a [token, p, logit] list
 *   last_position: tokens              a token count minus one (positions count BOS as 0)
 *   request: <name>.<arg path>         an argument of the row's own request (what was sent)
 *   parse_head: pick.head              "L2H8" -> {layer: 2, head: 8}; `take: layer|head` for one
 *   first_mlp_layer: top3              n of the first "MLP.n" in a [part, push] list
 *   argmax: grid, by: share            the record with the largest `by`; `take`, `exclude_layer`
 *   count: top3                        a list's length
 *   list: [a, b]                       the values at those paths, as a list
 *   points: suggested_threshold        percentage points -> a probability (30 -> 0.3)
 *   token_position: ioi, token: " store"   that token's position in the recorded response of
 *                                      the row's request `ioi` (`occurrence`: first (default), last, n)
 *   literal: <value>, source: "..."    an authored value the plan allows (a literature value or
 *                                      an outline's own number); `source` is required, `kind` tags it
 *   alias: n                           row n's constant of the same name (an outline's own label for row n)
 * Modifiers: `negate: true` flips the sign; `round: d` rounds to d decimals;
 * `from_row: n` reads row n's recorded values instead (a row that recorded the
 * same run, named in `note`).
 */
export interface ConstantSpec {
  unit: RowUnit;
  of?: RowUnit;
  from_row?: number;
  negate?: boolean;
  round?: number;
  note?: string;
  token_position?: string;
  occurrence?: 'first' | 'last' | number;
  literal?: unknown;
  source?: string;
  kind?: string;
  alias?: number;
  points?: string;
  path?: string;
  token_prob?: string;
  token?: string;
  last_position?: string;
  request?: string;
  parse_head?: string;
  first_mlp_layer?: string;
  argmax?: string;
  by?: string;
  exclude_layer?: number;
  count?: string;
  list?: string[];
  take?: string;
}

const DERIVATIONS = ['path', 'token_prob', 'last_position', 'request', 'parse_head', 'first_mlp_layer', 'argmax', 'count', 'list', 'points', 'token_position', 'literal', 'alias'] as const;

function at(v: unknown, dotted: string, where: string): unknown {
  let x = v;
  for (const k of dotted.split('.')) {
    if (x === null || typeof x !== 'object' || !(k in x)) throw new Error(`${where}: no recorded value at \`${dotted}\``);
    x = (x as Record<string, unknown>)[k];
  }
  return x;
}

function headOf(label: unknown, where: string): { layer: number; head: number } {
  const m = typeof label === 'string' ? /^L(\d+)\.?H(\d+)$/.exec(label) : null;
  if (!m) throw new Error(`${where}: ${JSON.stringify(label)} isn't a head label like "L2H8"`);
  return { layer: Number(m[1]), head: Number(m[2]) };
}

/** Derives one constant from a row's recorded values (and its request specs). Throws naming the row and field. */
export function deriveConstant(
  spec: ConstantSpec,
  values: unknown,
  requests: RowRequestSpec[],
  where: string,
  response?: (request: string) => unknown,
): RowConstant {
  const ops = DERIVATIONS.filter((d) => spec[d] !== undefined);
  if (ops.length !== 1) throw new Error(`${where}: give exactly one of ${DERIVATIONS.join(', ')}`);
  if (!ROW_UNITS.includes(spec.unit)) throw new Error(`${where}: unit must be one of ${ROW_UNITS.join(', ')}`);
  let value: unknown;
  switch (ops[0]) {
    case 'path':
      value = at(values, spec.path!, where);
      break;
    case 'token_prob': {
      const hit = (at(values, spec.token_prob!, where) as unknown[][]).find((e) => e[0] === spec.token);
      if (!hit) throw new Error(`${where}: ${JSON.stringify(spec.token)} isn't in \`${spec.token_prob}\``);
      value = hit[1];
      break;
    }
    case 'last_position':
      value = (at(values, spec.last_position!, where) as number) - 1;
      break;
    case 'request': {
      const [name, ...rest] = spec.request!.split('.');
      const r = requests.find((q) => q.name === name);
      if (!r) throw new Error(`${where}: the row has no request named ${name}`);
      value = at(r, rest.join('.'), where);
      break;
    }
    case 'parse_head': {
      const h = headOf(at(values, spec.parse_head!, where), where);
      value = spec.take ? h[spec.take as 'layer' | 'head'] : h;
      break;
    }
    case 'first_mlp_layer': {
      const hit = (at(values, spec.first_mlp_layer!, where) as unknown[][]).find((e) => /^MLP\.\d+$/.test(String(e[0])));
      if (!hit) throw new Error(`${where}: no MLP in \`${spec.first_mlp_layer}\``);
      value = Number(String(hit[0]).slice(4));
      break;
    }
    case 'argmax': {
      const by = spec.by!;
      const xs = (at(values, spec.argmax!, where) as Record<string, number>[]).filter(
        (x) => spec.exclude_layer === undefined || x.layer !== spec.exclude_layer,
      );
      if (!xs.length) throw new Error(`${where}: \`${spec.argmax}\` is empty`);
      const best = xs.reduce((a, b) => (b[by] > a[by] ? b : a));
      value = spec.take ? best[spec.take] : best;
      break;
    }
    case 'count':
      value = (at(values, spec.count!, where) as unknown[]).length;
      break;
    case 'list':
      value = spec.list!.map((p) => at(values, p, where));
      break;
    case 'points':
      value = (at(values, spec.points!, where) as number) / 100;
      break;
    case 'token_position': {
      const resp = response?.(spec.token_position!);
      if (resp === undefined) throw new Error(`${where}: no recorded response for request ${spec.token_position}`);
      const tokens = (at(resp, 'tokens', where) as { index: number; text: string }[]).filter((t) => t.text === spec.token);
      const occ = spec.occurrence ?? 'first';
      const hit = occ === 'first' ? tokens[0] : occ === 'last' ? tokens[tokens.length - 1] : tokens[occ - 1];
      if (!hit) throw new Error(`${where}: ${JSON.stringify(spec.token)} isn't in the recorded tokens`);
      value = hit.index;
      break;
    }
    case 'literal':
      if (!spec.source) throw new Error(`${where}: a literal needs a source`);
      value = spec.literal;
      break;
    case 'alias':
      throw new Error(`${where}: alias is resolved across rows by deriveRowConstants`);
  }
  if (value === undefined) throw new Error(`${where}: derived nothing`);
  if (spec.negate) {
    if (typeof value !== 'number') throw new Error(`${where}: negate needs a number`);
    value = -value;
  }
  if (spec.round !== undefined) {
    if (typeof value !== 'number') throw new Error(`${where}: round needs a number`);
    value = Number(value.toFixed(spec.round));
  }
  return {
    value,
    unit: spec.unit,
    ...(spec.of ? { of: spec.of } : {}),
    ...(spec.kind ? { kind: spec.kind } : {}),
    ...(spec.source ? { source: spec.source } : {}),
  };
}

/** A row request's recorded response (first repeat), by row-requests.json keys, from the responses folder. */
export function recordedResponses(rowRequestsText: string, responsesDir: string): (row: number, request: string) => unknown {
  const doc = JSON.parse(rowRequestsText) as { rows: { id: number; requests: { name: string; key: string }[] }[] };
  return (row, request) => {
    const key = doc.rows.find((r) => r.id === row)?.requests.find((q) => q.name === request)?.key;
    const file = key && join(responsesDir, `${key}.json`);
    return file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { response: unknown }).response : undefined;
  };
}

/** Every row's constants, derived from rows.json's recorded values by verified-rows.yaml. */
export function deriveRowConstants(
  yamlText: string,
  rowsJsonText: string,
  response: (row: number, request: string) => unknown = () => undefined,
): Map<number, RowConstants> {
  const doc = parseYaml(yamlText) as { rows: RowSpec[] };
  const recorded = new Map((JSON.parse(rowsJsonText) as { rows: { id: number; values: unknown }[] }).rows.map((r) => [r.id, r.values]));
  const out = new Map<number, RowConstants>();
  for (const row of doc.rows) {
    if (!row.constants) continue;
    const c: RowConstants = {};
    for (const [field, spec] of Object.entries(row.constants)) {
      if (spec.alias !== undefined) continue;
      const where = `verified-rows.yaml row ${row.id} constant ${field}`;
      const src = spec.from_row ?? row.id;
      if (!recorded.has(src)) throw new Error(`${where}: rows.json has no row ${src}`);
      const requests = spec.from_row === undefined ? (row.requests ?? []) : (doc.rows.find((r) => r.id === src)?.requests ?? []);
      c[field] = deriveConstant(spec, recorded.get(src), requests, where, (name) => response(src, name));
    }
    out.set(row.id, c);
  }
  // Aliases last, so they can name any row's derived constant.
  for (const row of doc.rows) {
    for (const [field, spec] of Object.entries(row.constants ?? {})) {
      if (spec.alias === undefined) continue;
      const target = out.get(spec.alias)?.[field];
      if (!target) throw new Error(`verified-rows.yaml row ${row.id} constant ${field}: row ${spec.alias} has no constant ${field}`);
      out.get(row.id)![field] = { ...target, alias: spec.alias };
    }
  }
  return out;
}

/**
 * rows.json with each row's `constants` replaced and every other byte kept
 * (the file is pytest's json.dumps(indent=1); a JSON round trip would reorder
 * its integer keys). Constants sit between a row's `values` and `checks`.
 */
export function withRowConstants(rowsJsonText: string, constants: Map<number, RowConstants>): string {
  const eol = rowsJsonText.includes('\r\n') ? '\r\n' : '\n';
  const text = rowsJsonText.replace(/\r\n/g, '\n');
  const starts = [...text.matchAll(/\n  \{\n   "id": (\d+),/g)];
  let out = text.slice(0, starts[0]?.index ?? text.length);
  starts.forEach((m, i) => {
    let seg = text.slice(m.index, starts[i + 1]?.index ?? text.length);
    seg = seg.replace(/\n   "constants": (\{\}|\{\n[\s\S]*?\n   \}),/, '');
    const c = constants.get(Number(m[1]));
    if (c && Object.keys(c).length) {
      const anchor = seg.indexOf('\n   "checks": ');
      if (anchor < 0) throw new Error(`rows.json row ${m[1]} has no "checks" entry to place constants before`);
      const block = `\n   "constants": ${JSON.stringify(c, null, 1).replace(/\n/g, '\n   ')},`;
      seg = seg.slice(0, anchor) + block + seg.slice(anchor);
    }
    out += seg;
  });
  return out.replace(/\n/g, eol);
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
  if (argv.includes('--expectations')) {
    // Plan T6: the bundled lessons walk through the real registry (svelte runes),
    // so the walk runs under vitest: lessons-compile.test.ts writes the file.
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('npx', ['vitest', 'run', 'src/lib/lessons/lessons-compile.test.ts'], {
      cwd: UI,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, PRY_WRITE_EXPECTATIONS: '1' },
    });
    if (r.status === 0) console.log('wrote src/lessons/__generated__/expectations.json');
    process.exit(r.status ?? 1);
  }
  if (argv.includes('--rows')) {
    const text = await rowRequestsJson(readFileSync(ROWS_YAML, 'utf8'));
    writeFileSync(out ?? ROW_REQUESTS_JSON, text);
    console.log(`wrote ${relative(process.cwd(), out ?? ROW_REQUESTS_JSON)}`);
    if (existsSync(ROWS_JSON)) {
      const before = readFileSync(ROWS_JSON, 'utf8');
      const constants = deriveRowConstants(readFileSync(ROWS_YAML, 'utf8'), before, recordedResponses(text, RESPONSES_DIR));
      const after = withRowConstants(before, constants);
      if (after !== before) writeFileSync(ROWS_JSON, after);
      const n = [...constants.values()].reduce((a, c) => a + Object.keys(c).length, 0);
      console.log(`${after === before ? 'kept' : 'wrote'} ${relative(process.cwd(), ROWS_JSON)}: ${n} row constants in ${constants.size} rows`);
    }
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
