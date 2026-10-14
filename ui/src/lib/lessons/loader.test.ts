import { describe, expect, it, vi } from 'vitest';
import {
  bundledEntries,
  createLessonLibrary,
  formatError,
  realFormat,
  type DirEntryLike,
  type LoaderFs,
} from './loader';

/** In-memory plugin-fs: files by path, symlinks (junctions) by path. */
function fakeFs(files: Record<string, string | Uint8Array> = {}, links: string[] = []) {
  const data = new Map<string, string | Uint8Array>(Object.entries(files));
  const dirs = new Set<string>();
  const sizes = new Map<string, number>();
  const parents = (p: string) => {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  };
  for (const p of data.keys()) parents(p);
  for (const l of links) parents(l + '/x');
  const watchers: (() => void)[] = [];
  const fs: LoaderFs & { data: typeof data; sizes: typeof sizes; fire(): void; watchOpts?: unknown } = {
    data,
    sizes,
    fire: () => watchers.forEach((w) => w()),
    async exists(p) {
      return data.has(p) || dirs.has(p);
    },
    async mkdir(p) {
      parents(p + '/x');
    },
    async readDir(p) {
      const out = new Map<string, DirEntryLike>();
      const prefix = p + '/';
      for (const path of [...data.keys(), ...dirs]) {
        if (!path.startsWith(prefix)) continue;
        const name = path.slice(prefix.length).split('/')[0];
        const full = prefix + name;
        const isLink = links.includes(full);
        out.set(name, { name, isDirectory: !isLink && dirs.has(full), isFile: !isLink && data.has(full), isSymlink: isLink });
      }
      return [...out.values()];
    },
    async readTextFile(p) {
      const v = data.get(p);
      if (v === undefined) throw new Error('missing ' + p);
      return typeof v === 'string' ? v : new TextDecoder().decode(v);
    },
    async readFile(p) {
      const v = data.get(p);
      if (v === undefined) throw new Error('missing ' + p);
      return typeof v === 'string' ? new TextEncoder().encode(v) : v;
    },
    async writeTextFile(p, t) {
      data.set(p, t);
      parents(p);
    },
    async stat(p) {
      const v = data.get(p);
      return { size: sizes.get(p) ?? (typeof v === 'string' ? v.length : (v?.length ?? 0)) };
    },
    async copyFile(a, b) {
      data.set(b, data.get(a)!);
      if (sizes.has(a)) sizes.set(b, sizes.get(a)!);
      parents(b);
    },
    async watch(_p, cb, opts) {
      fs.watchOpts = opts;
      const w = () => cb({});
      watchers.push(w);
      return () => watchers.splice(watchers.indexOf(w), 1);
    },
  };
  return fs;
}

const lesson = (id: string, extra = '', body = '## First part\n\nText.\n\n## Second part {id=second}\n\nMore.\n') =>
  `---\nformat: 1\nid: ${id}\ntitle: "A lesson"\ntool: pry\nsummary: "One line."\nminutes: 5\n${extra}---\n\n${body}`;

const APP = 'C:/app';
const DIR = `${APP}/lessons`;

function library(fs: ReturnType<typeof fakeFs>, extra: Partial<Parameters<typeof createLessonLibrary>[0]> = {}) {
  return createLessonLibrary({
    format: realFormat,
    fs,
    appDataDir: APP,
    lessonDir: 'lessons',
    idPrefix: 'pry.',
    bundled: bundledEntries(realFormat, { '/src/lessons/p1-1/lesson.md': lesson('pry.p1-1') }, {}, undefined),
    template: { 'lesson.md': lesson('my.template'), 'README.md': '# Template' },
    now: () => new Date('2026-10-13T00:00:00Z'),
    urls: { create: () => 'blob:x', revoke: () => {} },
    ...extra,
  });
}

describe('lesson loader', () => {
  it('› pry. id cannot be shadowed', async () => {
    const fs = fakeFs({
      [`${DIR}/pry.p1-1/lesson.md`]: lesson('pry.p1-1'),
      [`${DIR}/pry.mine/lesson.md`]: lesson('pry.mine'),
    });
    const lib = library(fs);
    await lib.load();
    const bundled = lib.entries.filter((e) => e.id === 'pry.p1-1');
    expect(bundled[0].source).toBe('bundled');
    expect(bundled[0].lesson).not.toBeNull();
    const user = lib.entries.filter((e) => e.source === 'user');
    expect(user).toHaveLength(2);
    for (const u of user) {
      expect(u.lesson).toBeNull();
      expect(u.error?.message).toMatch(/reserved/);
    }
  });

  it('› bad lesson listed with file:line', async () => {
    const fs = fakeFs({ [`${DIR}/my.broken/lesson.md`]: '# no front matter\n' });
    const lib = library(fs);
    await lib.load();
    const listed = lib.list({ authorMode: false });
    const bad = listed.find((e) => e.id === 'my.broken')!;
    expect(bad.lesson).toBeNull();
    expect(formatError(bad.error!)).toBe(`${DIR}/my.broken/lesson.md:1: The lesson needs front matter between \`---\` lines at the very top.`);
  });

  it('› reload keeps the section id', async () => {
    const fs = fakeFs({ [`${DIR}/my.lesson/lesson.md`]: lesson('my.lesson') });
    const lib = library(fs);
    await lib.load();
    lib.select('my.lesson', 'second');
    fs.data.set(`${DIR}/my.lesson/lesson.md`, lesson('my.lesson', '', '## First part\n\nEdited.\n\n## Second part {id=second}\n\nEdited too.\n'));
    await lib.reload();
    expect(lib.selection).toEqual({ lessonId: 'my.lesson', sectionId: 'second' });
  });

  it('› user image becomes a revoked blob URL', async () => {
    const fs = fakeFs({
      [`${DIR}/my.pics/lesson.md`]: lesson('my.pics', '', '## Part\n\n:::explain\n```yaml\nimage: images/a.png\nalt: "A chart"\n```\n:::\n'),
      [`${DIR}/my.pics/images/a.png`]: new Uint8Array([137, 80, 78, 71]),
    });
    const created: Blob[] = [];
    const revoked: string[] = [];
    const lib = library(fs, {
      urls: {
        create: (b) => {
          created.push(b);
          return `blob:${created.length}`;
        },
        revoke: (u) => revoked.push(u),
      },
    });
    await lib.load();
    expect(lib.entries.find((e) => e.id === 'my.pics')!.images).toEqual({ 'images/a.png': 'blob:1' });
    expect(created[0].size).toBe(4);
    await lib.reload();
    expect(revoked).toEqual(['blob:1']);
    lib.unload();
    expect(revoked).toEqual(['blob:1', 'blob:2']);
  });

  it('› draft listed only with author mode on', async () => {
    const fs = fakeFs({ [`${DIR}/my.draft/lesson.md`]: lesson('my.draft', 'draft: true\n') });
    const lib = library(fs);
    await lib.load();
    expect(lib.list({ authorMode: false }).map((e) => e.id)).not.toContain('my.draft');
    expect(lib.list({ authorMode: true }).map((e) => e.id)).toContain('my.draft');
  });

  it('› copy skips a junction', async () => {
    const fs = fakeFs(
      { 'D:/pick/lesson.md': lesson('my.copied'), 'D:/pick/images/a.png': 'png' },
      ['D:/pick/linked'],
    );
    fs.data.set('D:/pick/linked/secret.txt', 'outside');
    const lib = library(fs);
    const r = await lib.addLessonFolder('D:/pick');
    expect(r).toEqual({ ok: true, id: 'my.copied' });
    expect(fs.data.has(`${DIR}/my.copied/lesson.md`)).toBe(true);
    expect(fs.data.has(`${DIR}/my.copied/images/a.png`)).toBe(true);
    expect([...fs.data.keys()].some((k) => k.startsWith(`${DIR}/my.copied/linked`))).toBe(false);
  });

  it('› copy refuses a folder over 20 MB', async () => {
    const fs = fakeFs({ 'D:/pick/lesson.md': lesson('my.big'), 'D:/pick/notes.bin': 'x' });
    fs.sizes.set('D:/pick/notes.bin', 21 * 1024 * 1024);
    const lib = library(fs);
    const r = await lib.addLessonFolder('D:/pick');
    expect(r.ok).toBe(false);
    expect(fs.data.has(`${DIR}/my.big/lesson.md`)).toBe(false);
    fs.sizes.set('D:/pick/notes.bin', 10);
    fs.data.set('D:/pick/big.png', 'x');
    fs.sizes.set('D:/pick/big.png', 2 * 1024 * 1024);
    expect((await lib.addLessonFolder('D:/pick')).ok).toBe(false);
  });

  it('› new folder queues the install', async () => {
    const fs = fakeFs({ [`${DIR}/my.quiet/lesson.md`]: lesson('my.quiet') });
    const lib = library(fs);
    await lib.load();
    expect(lib.pending).toHaveLength(0); // no gated permissions: silent
    await fs.writeTextFile(`${DIR}/my.net/lesson.md`, lesson('my.net', 'permissions: { network: [neuronpedia] }\n'));
    await lib.watch();
    expect(fs.watchOpts).toEqual({ recursive: true, delayMs: 500 });
    const changed = vi.fn();
    lib.onChange(changed);
    fs.fire();
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(lib.pending.map((p) => [p.entry.id, p.ask])).toEqual([['my.net', { network: ['neuronpedia'] }]]);
    const grants = JSON.parse(fs.data.get(`${APP}/lesson-grants.json`) as string);
    expect(grants['my.quiet']).toMatchObject({ sourcePath: `${DIR}/my.quiet`, granted: {} });
    expect(grants['my.net']).toBeUndefined();
  });

  it('› bundled order follows index.yaml', () => {
    const entries = bundledEntries(
      realFormat,
      {
        '/src/lessons/a/lesson.md': lesson('pry.a'),
        '/src/lessons/b/lesson.md': lesson('pry.b'),
        '/src/lessons/c/lesson.md': lesson('pry.c'),
        '/src/lessons/_template/lesson.md': lesson('my.template'),
      },
      {},
      'lessons:\n  - pry.c\n  - pry.a\n  - pry.b\n',
    );
    expect(entries.map((e) => e.id)).toEqual(['pry.c', 'pry.a', 'pry.b']);
  });

  it('› first run writes _template/ only when absent', async () => {
    const fs = fakeFs();
    const lib = library(fs);
    await lib.ensureTemplate();
    expect(fs.data.get(`${DIR}/_template/README.md`)).toBe('# Template');
    fs.data.set(`${DIR}/_template/README.md`, 'edited');
    await lib.ensureTemplate();
    expect(fs.data.get(`${DIR}/_template/README.md`)).toBe('edited');
    await lib.load();
    expect(lib.entries.some((e) => e.folder.endsWith('_template'))).toBe(false);
  });
});
