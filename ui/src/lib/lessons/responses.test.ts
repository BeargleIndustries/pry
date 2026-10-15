// Verified rows (plan T6a): every row has its recorded responses, every outline
// "to verify" item maps to a row, and rows.json was stamped against the current
// sidecar. The recordings come from `pytest sidecar/tests/test_lessons.py --record`.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { ROW_REQUESTS_JSON, ROWS_YAML, rowRequestsJson, type RowSpec } from '../../../scripts/lessons-compile';
import { findOutlines, scanOutlines } from '../../../scripts/outline-rows';

const UI = fileURLToPath(new URL('../../..', import.meta.url));
const REPO = resolve(UI, '..');
const GEN = join(UI, 'src/lessons/__generated__');
const RESPONSES = join(GEN, 'responses');
const ROWS_JSON = join(GEN, 'rows.json');

// Same list and rule as sidecar/tests/test_lessons.py sidecar_hash().
const HASH_PATHSPECS = [
  'sidecar/pry_sidecar',
  'sidecar/pyproject.toml',
  'src-tauri/resources/requirements-runtime.txt',
  'src-tauri/resources/constraints-runtime-*.txt',
];

function sidecarHash(): string | null {
  let out: string;
  try {
    out = execFileSync('git', ['ls-files', '--', ...HASH_PATHSPECS], { cwd: REPO, encoding: 'utf8' });
  } catch {
    return null;
  }
  const paths = out
    .split(/\r?\n/)
    .filter((p) => p.trim())
    .sort();
  const h = createHash('sha256');
  for (const p of paths) {
    const text = readFileSync(join(REPO, p)).toString('latin1').replace(/\r\n/g, '\n');
    const fileHash = createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex');
    h.update(Buffer.concat([Buffer.from(p, 'utf8'), Buffer.from([0]), Buffer.from(`${fileHash}\n`, 'ascii')]));
  }
  return h.digest('hex');
}

const yamlText = readFileSync(ROWS_YAML, 'utf8');
const rows = (parseYaml(yamlText) as { rows: RowSpec[] }).rows;
const generated = JSON.parse(readFileSync(ROW_REQUESTS_JSON, 'utf8')) as {
  rows: { id: number; requests: { name: string; key: string; repeat: number; offline: boolean }[] }[];
};
const rowsJson = existsSync(ROWS_JSON)
  ? (JSON.parse(readFileSync(ROWS_JSON, 'utf8')) as { sidecar_hash: string | null; rows: { id: number; status: string }[] })
  : null;
const outlines = findOutlines(UI);

describe('verified rows', () => {
  it('› row-requests.json is up to date with verified-rows.yaml', async () => {
    expect(readFileSync(ROW_REQUESTS_JSON, 'utf8').replace(/\r\n/g, '\n')).toBe(await rowRequestsJson(yamlText));
  });

  it('› rows 1-39 are all present, then 40+ in order', () => {
    const ids = rows.map((r) => r.id);
    expect(ids.slice(0, 39)).toEqual(Array.from({ length: 39 }, (_, i) => i + 1));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('› every row in verified-rows.yaml has its recorded responses', () => {
    const missing: string[] = [];
    for (const row of generated.rows) {
      const spec = rows.find((r) => r.id === row.id)!;
      if (row.requests.length === 0) {
        // Only an item that isn't a sidecar measurement may have no request: it waits on Brad or another task closes it.
        expect(['needs-brad', 'closed-by-task'], `row ${row.id} has no requests`).toContain(spec.status);
        continue;
      }
      for (const q of row.requests) {
        const files = q.offline
          ? [`${q.key}.offline.json`]
          : [`${q.key}.json`, ...Array.from({ length: q.repeat - 1 }, (_, i) => `${q.key}.r${i + 2}.json`)];
        for (const f of files) if (!existsSync(join(RESPONSES, f))) missing.push(`row ${row.id} ${q.name}: ${f}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('› rows.json holds every row with its status, none "to verify"', () => {
    expect(rowsJson, 'no rows.json: run pytest sidecar/tests/test_lessons.py --record').not.toBeNull();
    expect(rowsJson!.rows.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    for (const r of rowsJson!.rows) {
      expect(['verified', 'narrowed', 'failed', 'needs-brad', 'closed-by-task']).toContain(r.status);
      expect(r.status, `row ${r.id}`).toBe(rows.find((x) => x.id === r.id)!.status);
    }
  });

  it('› every narrowed row cites the outline line whose fallback it applied', () => {
    for (const r of rows.filter((x) => x.status === 'narrowed')) expect(r.note ?? '', `row ${r.id}`).toMatch(/P\d\.\d\.md:\d+ "/);
  });

  it.skipIf(!outlines)('› every outline-rows item maps to a row id in verified-rows.yaml', () => {
    const { unique } = scanOutlines(outlines!);
    const covered = new Set(rows.flatMap((r) => r.outline));
    const nth = new Map<string, number>();
    const unmapped: string[] = [];
    for (const it of unique) {
      const at = `${it.file}:${it.line}`;
      const n = (nth.get(at) ?? 0) + 1;
      nth.set(at, n);
      if (!covered.has(at) && !covered.has(`${at}.${n}`)) unmapped.push(`${at}.${n} ${it.text.slice(0, 60)}`);
    }
    expect(unmapped).toEqual([]);
    // And every reference in the yaml points at a real item.
    const real = new Set<string>();
    const count = new Map<string, number>();
    for (const it of unique) {
      const at = `${it.file}:${it.line}`;
      const n = (count.get(at) ?? 0) + 1;
      count.set(at, n);
      real.add(at);
      real.add(`${at}.${n}`);
    }
    expect([...covered].filter((c) => !real.has(c))).toEqual([]);
  });

  it('› rows.json sidecar hash matches the current sidecar', () => {
    const now = sidecarHash();
    if (now === null) return; // no git here
    expect(
      rowsJson?.sidecar_hash,
      'The sidecar or its requirements changed since the rows were recorded. Run `pytest sidecar/tests/test_lessons.py` with GPT-2 small cached and re-stamp.',
    ).toBe(now);
  });
});
