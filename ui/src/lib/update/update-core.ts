// Pure helpers for the app updater: version compare, the two localStorage
// preferences, and release-note trimming. No Tauri imports, so they test in node.

export const AUTO_CHECK_KEY = 'pry:update:auto-check';
export const SKIPPED_VERSION_KEY = 'pry:update:skipped-version';

/** The slice of Storage the prefs need (localStorage, or a fake in tests). */
export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface Parsed {
  core: number[];
  pre: string[];
}

function parse(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/**
 * Semver order: -1 if a < b, 0 if equal, 1 if a > b. A pre-release sorts
 * before its release (0.4.0-alpha < 0.4.0). Unparseable input compares as
 * equal so it never triggers an update prompt.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (!pa.pre.length || !pb.pre.length) {
    if (pa.pre.length === pb.pre.length) return 0;
    return pa.pre.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

function safeGet(kv: KV | null, key: string): string | null {
  try {
    return kv?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(kv: KV | null, key: string, value: string | null): void {
  try {
    if (value === null) kv?.removeItem(key);
    else kv?.setItem(key, value);
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}

/** Startup check is on unless the user turned it off. */
export function autoCheckEnabled(kv: KV | null): boolean {
  return safeGet(kv, AUTO_CHECK_KEY) !== 'false';
}

export function setAutoCheck(kv: KV | null, on: boolean): void {
  safeSet(kv, AUTO_CHECK_KEY, on ? 'true' : 'false');
}

export function skippedVersion(kv: KV | null): string | null {
  return safeGet(kv, SKIPPED_VERSION_KEY);
}

export function skipVersion(kv: KV | null, version: string | null): void {
  safeSet(kv, SKIPPED_VERSION_KEY, version);
}

/** Offer an update only if it is newer and the user hasn't skipped it. */
export function shouldOffer(candidate: string, current: string, skipped: string | null): boolean {
  return isNewer(candidate, current) && (skipped === null || compareVersions(candidate, skipped) !== 0);
}

const NOTE_MAX_CHARS = 110;

/** One short line per note: a bold lead-in if there is one, else the first sentence, capped. */
function shortNote(line: string): string {
  const lead = /^\*\*(.+?)\*\*/.exec(line);
  let text = (lead ? lead[1] : line)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
  if (!lead) {
    const sentence = /^(.+?[.!?])(\s|$)/.exec(text);
    if (sentence) text = sentence[1];
  }
  text = text.replace(/[.:]$/, '');
  return text.length > NOTE_MAX_CHARS ? `${text.slice(0, NOTE_MAX_CHARS - 1).trimEnd()}…` : text;
}

/**
 * The first few release notes as short plain lines. Headings ("### New")
 * and blank lines are dropped; each bullet is cut to its bold lead-in or
 * first sentence. `more` says whether anything was left out.
 */
export function notesExcerpt(body: string | undefined | null, maxLines = 3): { lines: string[]; more: boolean } {
  const all = (body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^#{1,6}\s/.test(l))
    .map((l) => shortNote(l.replace(/^[-*+]\s+/, '')))
    .filter((l) => l.length > 0);
  return { lines: all.slice(0, maxLines), more: all.length > maxLines };
}

/** Bytes to a short MB string: "12.4". */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? mb.toFixed(0) : mb.toFixed(1);
}
