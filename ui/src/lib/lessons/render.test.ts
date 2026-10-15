import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
// Pointer.svelte imports through `$lib`, which vitest doesn't resolve; nothing is pointed at in SSR.
vi.mock('../components/Pointer.svelte', () => ({ default: () => {} }));

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import { lessonLink, plainText, renderProse, type RNode } from './render';
import { makeKit, send } from './runner/test-kit';
import { loadLessonSource } from './format/normalise';
import type { Lesson } from './format/schema';
import LessonSidebar, { SidebarModel } from './LessonSidebar.svelte';
import { pryToolSet } from './registry/pry-set';

afterEach(() => vi.unstubAllGlobals());

const ctx = (notes: string[] = []) => ({ slot: () => null, earlier: () => ({ text: '', state: 'missing' as const }), note: (m: string) => notes.push(m) });

const LINKS = `---
format: 1
id: pry.fixture-links
title: "Links"
tool: pry
summary: "s"
minutes: 1
---

## One {id=one}

:::explain
Read [the paper](https://arxiv.org/abs/2211.00593) or go to [section two](lesson:pry.fixture-links#two).

<script>alert(1)</script>

Some <b>bold</b> words.
:::

## Two {id=two}

:::explain
Here.
:::
`;

/** The lesson as normalised, its raw-HTML lint errors ignored (the renderer must drop HTML on its own). */
function loose(text: string): Lesson {
  return loadLessonSource(text, { mode: 'lenient', tool: pryToolSet }).lesson!;
}

describe('render', () => {
  it('› a link opens through open_link', async () => {
    const kit = makeKit();
    await kit.runner.open(loose(LINKS), { source: { kind: 'bundled' } });
    const nodes = kit.runner.render().blocks[0].body;
    const links: Extract<RNode, { t: 'link' }>[] = [];
    const walk = (ns: RNode[]) => ns.forEach((n) => (n.t === 'link' ? links.push(n) : 'children' in n && walk(n.children)));
    walk(nodes);
    expect(links.map((l) => l.href)).toEqual(['https://arxiv.org/abs/2211.00593', 'lesson:pry.fixture-links#two']);
    await send(kit, { type: 'link', href: links[0].href });
    expect(kit.host.openLink).toHaveBeenCalledWith('https://arxiv.org/abs/2211.00593');
    // `lesson:` links navigate inside Lessons.
    expect(lessonLink(links[1].href)).toEqual({ lesson: 'pry.fixture-links', section: 'two' });
    await send(kit, { type: 'link', href: links[1].href });
    expect(kit.runner.section?.id).toBe('two');
    // A user lesson's link to a host it didn't declare is blocked by the dispatcher.
    const user = makeKit();
    await user.runner.open(loose(LINKS.replace('pry.fixture-links', 'someone.links').replace('lesson:pry.fixture-links', 'lesson:someone.links')), {
      source: { kind: 'user', manifest: { id: 'someone.links', sourcePath: 'x', permissions: {} }, grants: () => ({}) },
    });
    await send(user, { type: 'link', href: 'https://arxiv.org/abs/2211.00593' });
    expect(user.host.openLink).not.toHaveBeenCalled();
  });

  it('› HTML is dropped', () => {
    const notes: string[] = [];
    const nodes = [...renderProse('<script>alert(1)</script>', ctx(notes)), ...renderProse('Some <b>bold</b> words.', ctx(notes))];
    expect(plainText(nodes)).toBe('Some bold words.');
    expect(JSON.stringify(nodes)).not.toContain('<');
    expect(notes.length).toBeGreaterThan(0);
    // Nothing but the allow-list survives: a level 2 heading inside a step is dropped with a note.
    const n2: string[] = [];
    expect(renderProse('## Not here', ctx(n2))).toEqual([]);
    expect(n2[0]).toContain('heading');
  });

  it('› the sidebar renders the step as plain markup', async () => {
    const kit = makeKit();
    const model = new SidebarModel();
    kit.runner.attach(model);
    await kit.runner.open(loose(LINKS), { source: { kind: 'bundled' } });
    const html = render(LessonSidebar, {
      props: {
        model,
        anchors: pryToolSet.anchors,
        views: pryToolSet.views,
        spine: pryToolSet.spine,
        captures: () => ({}),
        runAction: async () => {},
        side: 'right',
        width: 380,
        railed: false,
        picker: null,
        onPick: () => {},
        onAllLessons: () => {},
        onResize: () => {},
        onCollapse: () => {},
        onExpand: () => {},
        onClose: () => {},
      },
    }).body;
    expect(html).toContain('role="complementary"');
    expect(html).toContain('aria-label="Lessons"');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('bold');
  });

  it('› nothing under ui/src/lib/lessons uses the raw html tag', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const needle = '@' + 'html';
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|svelte|js)$/.test(name) && readFileSync(p, 'utf-8').includes(needle)) hits.push(p);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
