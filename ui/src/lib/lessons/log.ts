// Lessons observability (plan T1 "Observability"): JSON lines to
// $APPLOG/lessons.log and the console. Rotates at 512 KB by copy-truncate to
// lessons.log.1: the content is copied, then the log is emptied. No remove and
// no rename, so the only grants it needs are write on the two files (and
// fs:default's read of $APPLOG).
// Logged: load errors, lint failures, dispatcher blocks, `apply` failures and
// aborts, assert fallbacks taken.

import type { Effect } from './registry/contract';

export const LOG_FILE = 'lessons.log';
export const LOG_ROTATED_FILE = 'lessons.log.1';
export const LOG_MAX_BYTES = 512 * 1024;

export interface LogEntry {
  time: string;
  lessonId?: string;
  stepId?: string;
  effect?: Effect;
  scope?: string;
  message: string;
}

/** The file calls the log makes (plugin-fs in the app, a fake in tests). */
export interface LogFs {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, text: string, opts?: { append?: boolean }): Promise<void>;
}

export interface LessonLogOptions {
  /** Full path of lessons.log; the rotated file sits beside it. */
  path: string;
  rotatedPath: string;
  maxBytes?: number;
  now?: () => Date;
  console?: Pick<Console, 'warn'>;
}

const encoder = new TextEncoder();

export interface LessonLog {
  log(entry: Omit<LogEntry, 'time'>): Promise<void>;
}

export function createLessonLog(fs: LogFs, opts: LessonLogOptions): LessonLog {
  const maxBytes = opts.maxBytes ?? LOG_MAX_BYTES;
  const now = opts.now ?? (() => new Date());
  const out = opts.console ?? console;
  // Size of lessons.log in bytes, read once (fs:default reads $APPLOG; stat isn't granted).
  let size: number | null = null;
  // Writes run one at a time so the size count and rotation stay in order.
  let queue: Promise<void> = Promise.resolve();

  async function write(line: string): Promise<void> {
    if (size === null) {
      size = (await fs.exists(opts.path)) ? encoder.encode(await fs.readTextFile(opts.path)).length : 0;
    }
    const bytes = encoder.encode(line).length;
    if (size > 0 && size + bytes > maxBytes) {
      await fs.writeTextFile(opts.rotatedPath, await fs.readTextFile(opts.path));
      await fs.writeTextFile(opts.path, '');
      size = 0;
    }
    await fs.writeTextFile(opts.path, line, { append: true });
    size += bytes;
  }

  return {
    log(entry) {
      const full: LogEntry = { time: now().toISOString(), ...entry };
      const line = JSON.stringify(full) + '\n';
      out.warn('[lessons]', full);
      queue = queue.then(() => write(line)).catch((e) => out.warn('[lessons] log write failed', e));
      return queue;
    },
  };
}

/** Inside the Tauri webview. Inlined: nothing under lessons/ imports app code (boundary rule). */
export function inTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
}

/** The app's log: plugin-fs under $APPLOG. Outside Tauri it logs to the console only. */
export async function openLessonLog(): Promise<LessonLog> {
  if (!inTauri()) {
    return { log: async (entry) => console.warn('[lessons]', { time: new Date().toISOString(), ...entry }) };
  }
  const { appLogDir, join } = await import('@tauri-apps/api/path');
  const fs = await import('@tauri-apps/plugin-fs');
  const dir = await appLogDir();
  if (!(await fs.exists(dir))) await fs.mkdir(dir, { recursive: true });
  return createLessonLog(fs, { path: await join(dir, LOG_FILE), rotatedPath: await join(dir, LOG_ROTATED_FILE) });
}
