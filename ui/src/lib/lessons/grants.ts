// User-lesson permission grants (plan T1 "Install moment and grants", D6,
// Settled 8). Asked once at install from the lesson's declared `permissions`,
// stored in $APPDATA/lesson-grants.json, revocable per lesson. Keyed by lesson
// id + source path + permissions hash:
// - a changed manifest re-asks only the new entries;
// - entries the lesson no longer declares drop silently;
// - a different folder with the same id gets nothing.
// Shipped lessons are trusted and never reach this file.

import { FREE_EFFECTS, type Effect } from './registry/contract';

export const GRANTS_FILE = 'lesson-grants.json';

/** Effects a user lesson must declare and the learner must OK. */
export type GatedEffect = Exclude<Effect, 'view' | 'compute'>;
export const GATED_EFFECTS: readonly GatedEffect[] = ['download', 'network', 'external', 'cost'];

/** A lesson's front matter `permissions`, e.g. `{ download: [gpt2-medium], network: [neuronpedia] }`. */
export type Permissions = Partial<Record<GatedEffect, string[]>>;

export interface GrantRecord {
  sourcePath: string;
  permissionsHash: string;
  granted: Permissions;
  grantedAt: string;
}

export type GrantStore = Record<string, GrantRecord>;

export interface LessonManifest {
  id: string;
  /** The folder the lesson loads from. */
  sourcePath: string;
  permissions: Permissions;
}

export type GrantStatus =
  /** Everything declared is granted (or nothing gated is declared). */
  | { status: 'granted'; granted: Permissions }
  /** The install sheet asks for `ask` only; `granted` already holds. */
  | { status: 'ask'; ask: Permissions; granted: Permissions }
  /** Another folder holds a grant under this id: this folder gets nothing. */
  | { status: 'other-folder'; granted: Permissions };

function normalise(p: Permissions | undefined): Permissions {
  const out: Permissions = {};
  for (const effect of GATED_EFFECTS) {
    const list = [...new Set(p?.[effect] ?? [])].sort();
    if (list.length) out[effect] = list;
  }
  return out;
}

function intersect(a: Permissions, b: Permissions): Permissions {
  const out: Permissions = {};
  for (const effect of GATED_EFFECTS) {
    const list = (a[effect] ?? []).filter((s) => b[effect]?.includes(s));
    if (list.length) out[effect] = list;
  }
  return out;
}

function minus(a: Permissions, b: Permissions): Permissions {
  const out: Permissions = {};
  for (const effect of GATED_EFFECTS) {
    const list = (a[effect] ?? []).filter((s) => !b[effect]?.includes(s));
    if (list.length) out[effect] = list;
  }
  return out;
}

function union(a: Permissions, b: Permissions): Permissions {
  const out: Permissions = {};
  for (const effect of GATED_EFFECTS) {
    const list = [...new Set([...(a[effect] ?? []), ...(b[effect] ?? [])])].sort();
    if (list.length) out[effect] = list;
  }
  return out;
}

export function isEmpty(p: Permissions): boolean {
  return GATED_EFFECTS.every((e) => !p[e]?.length);
}

/** SHA-256 of the normalised permissions block, hex. */
export async function hashPermissions(p: Permissions | undefined): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(normalise(p)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the lesson may do now, and what the install sheet still has to ask. */
export function grantStatus(store: GrantStore, m: LessonManifest): GrantStatus {
  const declared = normalise(m.permissions);
  const rec = store[m.id];
  if (rec && rec.sourcePath !== m.sourcePath) return { status: 'other-folder', granted: {} };
  const granted = rec ? intersect(rec.granted, declared) : {};
  const ask = minus(declared, granted);
  return isEmpty(ask) ? { status: 'granted', granted } : { status: 'ask', ask, granted };
}

/**
 * The store after the loader sees this manifest, before any answer: entries
 * no longer declared drop silently and the hash follows the manifest when
 * nothing new needs asking. A lesson with no gated permissions installs
 * silently with an empty grant. Returns the same object when nothing changed.
 */
export async function reconcile(store: GrantStore, m: LessonManifest, now: Date): Promise<GrantStore> {
  const st = grantStatus(store, m);
  if (st.status !== 'granted') return store;
  const rec = store[m.id];
  const permissionsHash = await hashPermissions(m.permissions);
  if (rec && rec.permissionsHash === permissionsHash && JSON.stringify(rec.granted) === JSON.stringify(st.granted)) {
    return store;
  }
  return {
    ...store,
    [m.id]: {
      sourcePath: m.sourcePath,
      permissionsHash,
      granted: st.granted,
      grantedAt: rec?.grantedAt ?? now.toISOString(),
    },
  };
}

/** The learner OK'd `approved` on the install sheet. Only declared entries are stored. */
export async function grant(store: GrantStore, m: LessonManifest, approved: Permissions, now: Date): Promise<GrantStore> {
  const st = grantStatus(store, m);
  if (st.status === 'other-folder') return store;
  const declared = normalise(m.permissions);
  return {
    ...store,
    [m.id]: {
      sourcePath: m.sourcePath,
      permissionsHash: await hashPermissions(m.permissions),
      granted: union(st.granted, intersect(normalise(approved), declared)),
      grantedAt: now.toISOString(),
    },
  };
}

/** Settings > Lessons: revoke one lesson's grants. */
export function revoke(store: GrantStore, id: string): GrantStore {
  const { [id]: _gone, ...rest } = store;
  return rest;
}

/** Dispatcher check for a gated action in a user lesson. */
export function isAllowed(store: GrantStore, m: LessonManifest, effect: Effect, scope: string): boolean {
  if (FREE_EFFECTS.includes(effect)) return true;
  const st = grantStatus(store, m);
  return st.granted[effect as GatedEffect]?.includes(scope) ?? false;
}

// ---------------------------------------------------------------------------
// $APPDATA/lesson-grants.json
// ---------------------------------------------------------------------------

export interface GrantsFs {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, text: string): Promise<void>;
}

/** A missing or unreadable file is an empty store: nothing is granted. */
export async function loadGrants(fs: GrantsFs, path: string): Promise<GrantStore> {
  try {
    if (!(await fs.exists(path))) return {};
    const parsed: unknown = JSON.parse(await fs.readTextFile(path));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as GrantStore) : {};
  } catch {
    return {};
  }
}

export async function saveGrants(fs: GrantsFs, path: string, store: GrantStore): Promise<void> {
  await fs.writeTextFile(path, JSON.stringify(store, null, 2) + '\n');
}
