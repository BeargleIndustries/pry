// Lesson loader (plan T1 "Loader", "Install moment and grants").
// Bundled lessons come from `ui/src/lessons/*/lesson.md` (excluding
// `_template`), in `ui/src/lessons/index.yaml` order. User lessons come from
// `$APPDATA/<lessonDir>/*/lesson.md`, watched (recursive, 500 ms debounce)
// plus "Reload lessons". User images become blob URLs, revoked on reload and
// unload. A lesson that doesn't parse stays in the list, greyed, with
// `file:line` and its first error. First run writes `_template/` if absent.
// Tool-neutral: the tool's `idPrefix` and `lessonDir` come in as options.

import {
  GRANTS_FILE,
  grantStatus,
  loadGrants,
  reconcile,
  saveGrants,
  type GrantStore,
  type LessonManifest,
  type Permissions,
} from './grants';
import { parseIndex } from './format/parse';
import { parseLessonForLoader } from './format/normalise';
import type { LessonLog } from './log';

// ---------------------------------------------------------------------------
// The format, through a narrow interface
// ---------------------------------------------------------------------------

/** What the loader needs from a parsed lesson. */
export interface LoadedLesson {
  id: string;
  title: string;
  draft: boolean;
  permissions: Permissions;
  sections: { id: string }[];
  /** Image paths relative to the lesson folder. */
  images: string[];
}

export type ParseResult =
  | { ok: true; lesson: LoadedLesson }
  | { ok: false; error: { line: number; message: string } };

/** The format's parser and lint, as the loader calls them. */
export interface LessonFormat {
  parseLesson(text: string, path: string): ParseResult;
  /** `index.yaml` → bundled lesson ids in order. */
  parseIndex(text: string): string[];
}

/** The real format: lenient parse and lint errors from `format/parse.ts`. */
export const realFormat: LessonFormat = { parseLesson: parseLessonForLoader, parseIndex };

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface LessonError {
  file: string;
  line: number;
  message: string;
}

export interface LessonEntry {
  /** The lesson id, or the folder name when the lesson didn't load. */
  id: string;
  source: 'bundled' | 'user';
  folder: string;
  file: string;
  lesson: LoadedLesson | null;
  /** Set on a lesson listed greyed: `file:line` and its first error. */
  error: LessonError | null;
  /** Lesson-relative image path → URL (`?url` for bundled, a blob URL for user). */
  images: Record<string, string>;
}

export const LESSON_FILE = 'lesson.md';
export const TEMPLATE_DIR = '_template';
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_FOLDER_BYTES = 20 * 1024 * 1024;
export const WATCH_DELAY_MS = 500;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Settings > Lessons "Show draft lessons (author mode)". */
export const AUTHOR_MODE_KEY = 'pry:lessons:author-mode';

export function readAuthorMode(kv: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return kv?.getItem(AUTHOR_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Drafts are listed only with author mode on. Greyed (broken) lessons always list. */
export function visibleLessons(entries: LessonEntry[], opts: { authorMode: boolean }): LessonEntry[] {
  return entries.filter((e) => opts.authorMode || !e.lesson?.draft);
}

export function formatError(e: LessonError): string {
  return `${e.file}:${e.line}: ${e.message}`;
}

/** Bundled lessons from the glob results, in `index.yaml` order (unlisted ones last, by id). */
export function bundledEntries(
  format: LessonFormat,
  sources: Record<string, string>,
  imageUrls: Record<string, string>,
  indexText: string | undefined,
): LessonEntry[] {
  const entries: LessonEntry[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const folder = file.slice(0, file.lastIndexOf('/'));
    const dir = folder.slice(folder.lastIndexOf('/') + 1);
    if (dir === TEMPLATE_DIR) continue;
    const images: Record<string, string> = {};
    for (const [path, url] of Object.entries(imageUrls)) {
      if (path.startsWith(folder + '/')) images[path.slice(folder.length + 1)] = url;
    }
    const r = format.parseLesson(text, file);
    entries.push(
      r.ok
        ? { id: r.lesson.id, source: 'bundled', folder, file, lesson: r.lesson, error: null, images }
        : { id: dir, source: 'bundled', folder, file, lesson: null, error: { file, ...r.error }, images },
    );
  }
  const order = indexText ? format.parseIndex(indexText) : [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return entries.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// The library: bundled + user lessons, reload, watch, install, copy
// ---------------------------------------------------------------------------

export interface DirEntryLike {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

/** The plugin-fs calls the loader makes (a fake in tests). */
export interface LoaderFs {
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): Promise<DirEntryLike[]>;
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, text: string): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
  copyFile(from: string, to: string): Promise<void>;
  watch(
    path: string,
    cb: (event: unknown) => void,
    opts: { recursive: boolean; delayMs: number },
  ): Promise<() => void>;
}

export interface PendingInstall {
  entry: LessonEntry;
  manifest: LessonManifest;
  /** Only the entries still to OK; already-granted ones aren't asked again. */
  ask: Permissions;
}

export interface LibraryOptions {
  format: LessonFormat;
  fs: LoaderFs;
  /** e.g. `$APPDATA` resolved. */
  appDataDir: string;
  /** The tool's `lessonDir` (Pry: 'lessons'). */
  lessonDir: string;
  /** The tool's `idPrefix` (Pry: 'pry.'): reserved for shipped lessons. */
  idPrefix: string;
  bundled: LessonEntry[];
  /** `_template/` file name → text, written on first run. */
  template: Record<string, string>;
  log?: LessonLog;
  now?: () => Date;
  urls?: { create(blob: Blob): string; revoke(url: string): void };
}

export interface Selection {
  lessonId: string;
  sectionId: string | null;
}

export type CopyResult = { ok: true; id: string } | { ok: false; message: string };

export function joinPath(...parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join('/');
}

/** A lesson-relative image path that stays inside the folder. */
function isLocalPath(p: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith('/') && !p.startsWith('\\') && !p.split(/[\\/]/).includes('..');
}

export function createLessonLibrary(opts: LibraryOptions) {
  const { format, fs } = opts;
  const now = opts.now ?? (() => new Date());
  const urls = opts.urls ?? { create: (b: Blob) => URL.createObjectURL(b), revoke: (u: string) => URL.revokeObjectURL(u) };
  const lessonsDir = joinPath(opts.appDataDir, opts.lessonDir);
  const grantsPath = joinPath(opts.appDataDir, GRANTS_FILE);

  let entries: LessonEntry[] = [];
  let pending: PendingInstall[] = [];
  let blobUrls: string[] = [];
  let selection: Selection | null = null;
  let unwatch: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function fail(entry: Omit<LessonEntry, 'error' | 'lesson'>, line: number, message: string): LessonEntry {
    const error = { file: entry.file, line, message };
    void opts.log?.log({ lessonId: entry.id, message: `load error: ${formatError(error)}` });
    return { ...entry, lesson: null, error };
  }

  async function loadUser(bundledIds: Set<string>): Promise<LessonEntry[]> {
    if (!(await fs.exists(lessonsDir))) return [];
    const out: LessonEntry[] = [];
    const dirs = (await fs.readDir(lessonsDir))
      .filter((d) => d.isDirectory && !d.isSymlink && !d.name.startsWith('_'))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      const folder = joinPath(lessonsDir, d.name);
      const file = joinPath(folder, LESSON_FILE);
      const base = { id: d.name, source: 'user' as const, folder, file, images: {} };
      if (!(await fs.exists(file))) continue;
      let text: string;
      try {
        text = await fs.readTextFile(file);
      } catch (e) {
        out.push(fail(base, 1, `Pry couldn't read this file (${String(e)}).`));
        continue;
      }
      const r = format.parseLesson(text, file);
      if (!r.ok) {
        out.push(fail(base, r.error.line, r.error.message));
        continue;
      }
      const { lesson } = r;
      if (lesson.id.startsWith(opts.idPrefix) || bundledIds.has(lesson.id)) {
        out.push(fail(base, 1, `The id "${lesson.id}" is reserved for lessons that ship with the app. Pick an id that doesn't start with "${opts.idPrefix}".`));
        continue;
      }
      if (lesson.id !== d.name) {
        out.push(fail(base, 1, `The id "${lesson.id}" must match the folder name "${d.name}".`));
        continue;
      }
      const images: Record<string, string> = {};
      for (const rel of lesson.images) {
        if (!isLocalPath(rel) || images[rel]) continue;
        try {
          const bytes = await fs.readFile(joinPath(folder, rel));
          const url = urls.create(new Blob([bytes as BlobPart]));
          blobUrls.push(url);
          images[rel] = url;
        } catch {
          /* a missing image is the lint's to report; the step shows its alt text */
        }
      }
      out.push({ ...base, id: lesson.id, lesson, error: null, images });
    }
    return out;
  }

  /** Queue lessons that are new or whose permissions changed; silent ones install now. */
  async function queueInstalls(user: LessonEntry[]): Promise<PendingInstall[]> {
    const before = await loadGrants(fs, grantsPath);
    let store: GrantStore = before;
    const queue: PendingInstall[] = [];
    for (const entry of user) {
      if (!entry.lesson) continue;
      const manifest: LessonManifest = { id: entry.id, sourcePath: entry.folder, permissions: entry.lesson.permissions };
      store = await reconcile(store, manifest, now());
      const st = grantStatus(store, manifest);
      if (st.status === 'ask') queue.push({ entry, manifest, ask: st.ask });
    }
    if (store !== before) await saveGrants(fs, grantsPath, store);
    return queue;
  }

  function revokeImages() {
    for (const u of blobUrls) urls.revoke(u);
    blobUrls = [];
  }

  function keepSelection() {
    if (!selection) return;
    const entry = entries.find((e) => e.id === selection!.lessonId && e.lesson);
    if (!entry) {
      selection = null;
      return;
    }
    const sections = entry.lesson!.sections;
    if (!sections.some((s) => s.id === selection!.sectionId)) {
      selection = { lessonId: entry.id, sectionId: sections[0]?.id ?? null };
    }
  }

  async function load(): Promise<LessonEntry[]> {
    revokeImages();
    const bundledIds = new Set(opts.bundled.filter((e) => e.lesson).map((e) => e.id));
    const user = await loadUser(bundledIds);
    entries = [...opts.bundled, ...user];
    pending = await queueInstalls(user);
    keepSelection();
    for (const l of listeners) l();
    return entries;
  }

  async function walk(dir: string, rel: string, files: { rel: string; size: number }[]): Promise<void> {
    for (const d of await fs.readDir(dir)) {
      if (d.isSymlink) continue; // symlinks and junctions are never copied
      const path = joinPath(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory) await walk(path, r, files);
      else if (d.isFile) files.push({ rel: r, size: (await fs.stat(path)).size });
    }
  }

  return {
    get entries() {
      return entries;
    },
    /** Lessons waiting for the install sheet ("1 new lesson needs your OK"). */
    get pending() {
      return pending;
    },
    get selection() {
      return selection;
    },
    select(lessonId: string, sectionId: string | null) {
      selection = { lessonId, sectionId };
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    load,
    /** "Reload lessons" and the watcher: same as load; the selected lesson and section stay. */
    reload: load,
    list(o: { authorMode: boolean }) {
      return visibleLessons(entries, o);
    },
    /** First run: write `_template/` beside the user lessons if it's missing. */
    async ensureTemplate(): Promise<void> {
      const dir = joinPath(lessonsDir, TEMPLATE_DIR);
      if (await fs.exists(dir)) return;
      await fs.mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(opts.template)) await fs.writeTextFile(joinPath(dir, name), text);
    },
    async watch(): Promise<void> {
      if (unwatch) return;
      if (!(await fs.exists(lessonsDir))) await fs.mkdir(lessonsDir, { recursive: true });
      unwatch = await fs.watch(lessonsDir, () => void load(), { recursive: true, delayMs: WATCH_DELAY_MS });
    },
    unload() {
      unwatch?.();
      unwatch = null;
      revokeImages();
    },
    /**
     * "Add a lesson...": copy a picked folder into `$APPDATA/<lessonDir>/<id>/`
     * with copyFile. Skips symlinks and junctions; refuses images over 1 MB and
     * folders over 20 MB before copying anything. The next load queues the install.
     */
    async addLessonFolder(src: string): Promise<CopyResult> {
      const files: { rel: string; size: number }[] = [];
      await walk(src, '', files);
      if (!files.some((f) => f.rel === LESSON_FILE)) return { ok: false, message: `That folder has no ${LESSON_FILE}.` };
      const big = files.find((f) => IMAGE_EXT.test(f.rel) && f.size > MAX_IMAGE_BYTES);
      if (big) return { ok: false, message: `${big.rel} is over 1 MB. Make the image smaller and try again.` };
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > MAX_FOLDER_BYTES) return { ok: false, message: 'That folder is over 20 MB. A lesson folder holds the lesson and its images only.' };
      const r = format.parseLesson(await fs.readTextFile(joinPath(src, LESSON_FILE)), joinPath(src, LESSON_FILE));
      if (!r.ok) return { ok: false, message: `${LESSON_FILE}:${r.error.line}: ${r.error.message}` };
      const id = r.lesson.id;
      if (id.startsWith(opts.idPrefix) || id.startsWith('_') || /[\\/]|\.\./.test(id)) {
        return { ok: false, message: `The id "${id}" can't be used for a lesson you add.` };
      }
      const dest = joinPath(lessonsDir, id);
      for (const f of files) {
        const to = joinPath(dest, f.rel);
        await fs.mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true });
        await fs.copyFile(joinPath(src, f.rel), to);
      }
      return { ok: true, id };
    },
  };
}

export type LessonLibrary = ReturnType<typeof createLessonLibrary>;

// ---------------------------------------------------------------------------
// The app's wiring
// ---------------------------------------------------------------------------

/** Bundled lesson files, images, index and template, from Vite's glob. */
export function bundledSources() {
  const lessons = import.meta.glob(['/src/lessons/*/lesson.md', '!/src/lessons/_template/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const images = import.meta.glob(
    ['/src/lessons/*/**/*.{png,jpg,jpeg,gif,webp,svg}', '!/src/lessons/_template/**'],
    { query: '?url', import: 'default', eager: true },
  ) as Record<string, string>;
  const index = import.meta.glob('/src/lessons/index.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const template = import.meta.glob('/src/lessons/_template/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  return {
    lessons,
    images,
    index: Object.values(index)[0] as string | undefined,
    template: Object.fromEntries(Object.entries(template).map(([p, t]) => [p.slice(p.lastIndexOf('/') + 1), t])),
  };
}

/** Builds the library on plugin-fs under `$APPDATA`. Call only inside Tauri. */
export async function openLessonLibrary(o: {
  lessonDir: string;
  idPrefix: string;
  format?: LessonFormat;
  log?: LessonLog;
}): Promise<LessonLibrary> {
  const { appDataDir } = await import('@tauri-apps/api/path');
  const pfs = await import('@tauri-apps/plugin-fs');
  const format = o.format ?? realFormat;
  const src = bundledSources();
  const fs: LoaderFs = {
    exists: (p) => pfs.exists(p),
    mkdir: (p, opt) => pfs.mkdir(p, opt),
    readDir: (p) => pfs.readDir(p),
    readTextFile: (p) => pfs.readTextFile(p),
    readFile: (p) => pfs.readFile(p),
    writeTextFile: (p, t) => pfs.writeTextFile(p, t),
    stat: (p) => pfs.stat(p),
    copyFile: (a, b) => pfs.copyFile(a, b),
    watch: (p, cb, opt) => pfs.watch(p, cb, opt),
  };
  return createLessonLibrary({
    format,
    fs,
    appDataDir: await appDataDir(),
    lessonDir: o.lessonDir,
    idPrefix: o.idPrefix,
    bundled: bundledEntries(format, src.lessons, src.images, src.index),
    template: src.template,
    log: o.log,
  });
}
