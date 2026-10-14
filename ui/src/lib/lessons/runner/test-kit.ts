// Runner test kit (tests only). Each test file mocks '@tauri-apps/api/core'
// and '@tauri-apps/api/event' first, as the registry tests do.
//
// The fake sidecar answers from ui/src/lessons/__generated__/responses/ (the
// requests T6a recorded through Pry's own sidecar, looked up by request key);
// any request not recorded there gets a stub built to the response schemas
// (pry-test-host's canned sidecar), with sampled text that depends on the
// seed so seeded runs repeat and different seeds differ.

import { vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, makeHost, type Recorded, type TestHost } from '../registry/pry-test-host';
import { canonicalRequest } from '../registry/request-key';
import { pryToolSet } from '../registry/pry-set';
import { pryMemo } from '../registry/pry-state.svelte';
import { loadLessonSource } from '../format/normalise';
import type { Lesson } from '../format/schema';
import type { Presenter, PresenterCommand, PointerTarget, RenderedStep } from '../registry/contract';
import { createProgress } from '../progress';
import { createRunner, type LessonRunner, type RunnerCommand } from './runner.svelte';
import { memoryJournal } from './types';
import type { PryViewState } from '../registry/pry-state.svelte';
import { createHash } from 'node:crypto';
import { loadRows } from '../lesson-walk';

const LESSONS = fileURLToPath(new URL('..', import.meta.url));
const RESPONSES = fileURLToPath(new URL('../../../lessons/__generated__/responses/', import.meta.url));
const ROWS = fileURLToPath(new URL('../../../lessons/__generated__/rows.json', import.meta.url));

let recorded: Map<string, unknown[]> | null = null;

/** Request key -> recorded responses, in variant order. */
export function recordedResponses(): Map<string, unknown[]> {
  if (recorded) return recorded;
  const m = new Map<string, { variant: string; response: unknown }[]>();
  for (const f of readdirSync(RESPONSES)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(join(RESPONSES, f), 'utf-8')) as { key: string; variant: string; response: unknown };
    const list = m.get(j.key) ?? [];
    list.push({ variant: j.variant, response: j.response });
    m.set(j.key, list);
  }
  recorded = new Map([...m].map(([k, v]) => [k, v.sort((a, b) => a.variant.localeCompare(b.variant)).map((x) => x.response)]));
  return recorded;
}

/** rows.json values for a row id, with its constants on top (as lesson-walk.ts loadRows). */
const rowsMap = loadRows(ROWS);
export function rowValues(id: string): unknown {
  return rowsMap.get(String(id));
}

function keyOf(endpoint: string, body: any): string {
  const model = body?.preset_id ?? 'gpt2-small';
  return createHash('sha256').update(canonicalRequest({ endpoint, model, body })).digest('hex');
}

/** The canned answer, with sampled text that follows the seed. */
function stub(endpoint: string, body: any): any {
  const r = answer(endpoint, body) as any;
  if (endpoint === '/generate' && body?.max_new_tokens > 0 && (body.temperature ?? 0) > 0) {
    const seed = body.seed ?? Math.floor(Math.random() * 1e9);
    r.generation_steps = r.generation_steps.map((s: any, i: number) => ({ ...s, token: ` s${seed}w${i}`, text: ` s${seed}w${i}` }));
    r.generation = r.generation_steps.map((s: any) => s.text).join('');
    r.seed_used = seed;
  }
  return r;
}

export interface FakeSidecar {
  calls: Recorded[];
  /** How many answers came from the recordings. */
  hits: () => number;
}

/** Stubs fetch with the fake sidecar. `latency(endpoint)` ms delays answers (fake timers welcome). */
export function fakeSidecar(opts: { latency?: (endpoint: string, body: any) => number; useRecorded?: boolean } = {}): FakeSidecar {
  const calls: Recorded[] = [];
  const served = new Map<string, number>();
  let hits = 0;
  const rec = opts.useRecorded === false ? new Map<string, unknown[]>() : recordedResponses();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const endpoint = new URL(url).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ endpoint, body });
      const ms = opts.latency?.(endpoint, body) ?? 0;
      if (ms > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, ms);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      const key = keyOf(endpoint, body);
      const list = rec.get(key);
      let out: unknown;
      if (list?.length) {
        const n = served.get(key) ?? 0;
        served.set(key, n + 1);
        out = list[Math.min(n, list.length - 1)];
        hits++;
      } else {
        out = stub(endpoint, body);
      }
      return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return { calls, hits: () => hits };
}

/** A presenter that keeps what it was shown. */
export class RecordingPresenter implements Presenter {
  step: RenderedStep | null = null;
  nav: { index: number; total: number; canBack: boolean } | null = null;
  pointers: PointerTarget[] = [];
  shows = 0;
  #cbs: ((c: PresenterCommand) => void)[] = [];
  show(step: RenderedStep, nav: { index: number; total: number; canBack: boolean }) {
    this.step = step;
    this.nav = nav;
    this.shows++;
  }
  point(t: PointerTarget, seq?: number) {
    this.pointers = seq === undefined ? [t] : [...this.pointers.slice(0, seq), t];
  }
  clearPointer() {
    this.pointers = [];
  }
  onCommand(cb: (c: PresenterCommand) => void) {
    this.#cbs.push(cb);
  }
  send(c: PresenterCommand | RunnerCommand) {
    const cmd: PresenterCommand = typeof c === 'string' ? c : 'type' in (c as object) ? { commit: c } : (c as PresenterCommand);
    for (const cb of this.#cbs) cb(cmd);
  }
}

/** Reads a lesson file (path relative to ui/src/lib/lessons). */
export function lessonFile(rel: string): Lesson {
  const text = readFileSync(join(LESSONS, rel), 'utf-8');
  const { lesson, issues } = loadLessonSource(text, { mode: 'lenient', tool: pryToolSet });
  const errors = issues.filter((i) => i.severity === 'error');
  if (!lesson || errors.length) throw new Error(`${rel}: ${errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`);
  return lesson;
}

export function lessonSource(text: string): Lesson {
  const { lesson, issues } = loadLessonSource(text, { mode: 'lenient', tool: pryToolSet });
  const errors = issues.filter((i) => i.severity === 'error');
  if (!lesson || errors.length) throw new Error(errors.map((e) => `${e.line}: ${e.message}`).join('; '));
  return lesson;
}

export const SKELETONS = readdirSync(join(LESSONS, 'fixtures', 'outline-coverage'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => `fixtures/outline-coverage/${f}`);

function memoryKv(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

export interface Kit {
  host: TestHost;
  sidecar: FakeSidecar;
  runner: LessonRunner<PryViewState>;
  presenter: RecordingPresenter;
  journal: ReturnType<typeof memoryJournal>;
  progress: ReturnType<typeof createProgress>;
}

export function makeKit(
  opts: { latency?: (endpoint: string, body: any) => number; prompt?: string; useRecorded?: boolean; rows?: (id: string) => unknown } = {},
): Kit {
  const host = makeHost(opts.prompt);
  const sidecar = fakeSidecar({ latency: opts.latency, useRecorded: opts.useRecorded });
  const journal = memoryJournal();
  const progress = createProgress(memoryKv(), () => new Date('2026-10-14T12:00:00Z'));
  let t = Date.parse('2026-10-14T12:00:00Z');
  const runner = createRunner<PryViewState>({
    set: pryToolSet,
    memo: pryMemo,
    journal,
    progress,
    rows: opts.rows ?? rowValues,
    currentModel: () => host.activePresetId(),
    modelName: (id) => (id === 'gpt2-small' ? 'GPT-2 small' : id),
    now: () => new Date((t += 1000)),
    setupDelayMs: 300,
  });
  const presenter = new RecordingPresenter();
  runner.attach(presenter);
  return { host, sidecar, runner, presenter, journal, progress };
}

/** Commits a runner command and waits for it. */
export async function send(kit: Kit, c: RunnerCommand | PresenterCommand): Promise<void> {
  await kit.runner.command(typeof c === 'string' ? c : 'type' in (c as object) ? { commit: c } : (c as PresenterCommand));
}

/** The readout strings a learner sees in a rendered step (slots and check lines). */
export function visibleText(step: RenderedStep): unknown {
  return JSON.parse(JSON.stringify(step.blocks));
}
