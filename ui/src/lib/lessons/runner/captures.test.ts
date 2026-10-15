import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { render } from 'svelte/server';
import { lessonFile, makeKit, send } from './test-kit';
import TextDiff from '../registry/pry-views/text-diff.svelte';
import Top5Pair from '../registry/pry-views/top5-pair.svelte';
import { lessonsCopy } from '../copy';

afterEach(() => vi.unstubAllGlobals());

describe('captures', () => {
  it('› P1.5 skeleton: A = B, C = E and C ≠ D read from captures', async () => {
    const kit = makeKit();
    const lesson = lessonFile('fixtures/outline-coverage/P1.5.md');
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-5' });
    await send(kit, { type: 'answer', step: 'which-match', choice: 2 });
    for (const s of ['run-a', 'run-b', 'run-c', 'run-d', 'run-e']) await send(kit, { type: 'do', step: s });
    for (const name of ['a', 'b', 'c', 'd', 'e']) expect(kit.runner.captures.has(name)).toBe(true);
    const env = kit.runner.env();
    const text = (cap: string) => env.read('write_it.text', undefined, cap);
    expect(text('a')).toBe(text('b'));
    expect(text('c')).toBe(text('e'));
    expect(text('c')).not.toBe(text('d'));
    // The observe judges all three from the captures.
    await send(kit, { type: 'show', step: 'match-obs' });
    const obs = kit.runner.render().blocks.find((b) => b.key === 'match-obs')!.observe!;
    expect(obs.result?.agrees).toBe(true);
    // Each capture went to the journal, so a later visit reads the learner's own runs.
    expect(kit.journal.entries.filter((e) => e.capture).map((e) => e.capture!.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // The four-row compare reads its columns from the captures.
    const rows = kit.runner.render().blocks.find((b) => b.key === 'four-rows')!.columns!;
    expect(rows.every((c) => c.kind === 'read' && c.value !== 'nothing yet')).toBe(true);
  });

  it('› top5-pair shows target and control captures after a reset', async () => {
    const kit = makeKit();
    const lesson = lessonFile('fixtures/outline-coverage/P3.2.md');
    await kit.runner.open(lesson, { source: { kind: 'bundled' }, sectionId: 's3-7' });
    await send(kit, { type: 'do', step: 'movers-knockout' });
    await send(kit, { type: 'do', step: 'control-knockout' }); // starts with `reset: {}`
    const caps = kit.runner.captureMap();
    // `heavy` is section 3.4's run, replayed on this direct entry: readable here, never journaled.
    expect(Object.keys(caps).sort()).toEqual(['control', 'heavy', 'movers']);
    expect(kit.journal.entries.filter((e) => e.capture).map((e) => e.capture!.name).sort()).toEqual(['control', 'movers']);
    const html = render(Top5Pair, { props: { args: { a: 'movers', b: 'control' }, captures: caps as never } }).body;
    expect(html).toContain('movers');
    expect(html).toContain('control');
    expect(html.match(/<ol/g)?.length).toBe(2);
    expect(html).not.toContain('Shows here once its step has run.');
    // The two-lists compare: both columns read their capture.
    const cols = kit.runner.render().blocks.find((b) => b.key === 'two-lists')!.columns!;
    expect(cols.map((c) => (c.kind === 'read' ? c.label : ''))).toEqual(['movers', 'control']);
    expect(cols.every((c) => c.kind === 'read' && c.value !== 'nothing yet')).toBe(true);
    // A slot bound to a capture reads it.
    expect(JSON.stringify(kit.runner.render().blocks)).not.toContain(lessonsCopy.missingReadout);
  });
  it('text-diff marks changed tokens against a literal reference', () => {
    const caps = { decl: { writeIt: { generation: ' that they are endowed by their Creator' } } };
    const html = render(TextDiff, { props: { args: { a: 'decl', text: ' that every man is endowed by his Creator' }, captures: caps as never } }).body;
    expect(html).toContain('real text');
    expect(html).toContain('bg-amber-900/50');
    const same = render(TextDiff, { props: { args: { a: 'decl', text: ' that they are endowed by their Creator' }, captures: caps as never } }).body;
    expect(same).not.toContain('bg-amber-900/50');
  });
});
