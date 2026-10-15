// The card deck on the loading screen: tips, lessons to open once the model
// is ready, and glossary words. Plain TS so the shuffling and navigation can be
// tested without a DOM.

import type { TipDef } from './tips/tips-registry';
import type { GlossaryEntry } from './glossary';
// Bundled lessons, read from the lesson loader by lessons/deck-lessons.ts.
import type { DeckLesson } from './lessons/deck-lessons';

export type DeckCard =
  | { kind: 'tip'; id: string; heading: string; body: string }
  | {
      kind: 'lesson';
      id: string;
      lessonId: string;
      title: string;
      summary: string;
      model: string | null;
      /** The lesson runs on a different model than the one loading. */
      switchesModel: boolean;
    }
  | { kind: 'term'; id: string; term: string; definition: string };

export type DeckKind = DeckCard['kind'];

/**
 * Tips that still read well away from the panel they're anchored to, with a
 * heading naming the place in the app they're about.
 */
export const LOADING_TIPS: Record<string, string> = {
  'predictions-panel': 'Predictions',
  'logit-lens-heatmap': 'Logit Lens',
  'dla-waterfall': 'Why (DLA)',
  'steering-panel': 'Steering',
  'patching-panel': 'Swap test',
  'circuit-graph': 'Key parts',
  'watch-it-write': 'Watch it write',
  'concept-search': 'Find a concept',
  'compare-panel': 'Compare',
  'panel-b-layer-selector': 'Feature layers',
  'panel-a-copying-heads': 'Copying heads',
  'ablation-feature-toggle': 'Turning a feature off',
  'experiments-button': 'Experiments',
};

export interface DeckSources {
  tips: TipDef[];
  lessons: DeckLesson[];
  glossary: Record<string, GlossaryEntry>;
  /** The model being loaded, to say whether a lesson runs on another model. */
  presetId: string;
  /** 0..1 random source; pass a seeded one in tests. */
  random?: () => number;
  /** Card ids shown recently (most recent last); these go to the back. */
  recent?: string[];
  /** Cards per kind. */
  perKind?: number;
}

export function shuffle<T>(xs: readonly T[], random: () => number = Math.random): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffle, then move recently seen cards to the back (oldest-seen first). */
function freshFirst<T extends { id: string }>(xs: T[], recent: string[], random: () => number): T[] {
  const rank = new Map(recent.map((id, i) => [id, i]));
  const fresh = shuffle(
    xs.filter((x) => !rank.has(x.id)),
    random,
  );
  const stale = xs
    .filter((x) => rank.has(x.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...fresh, ...stale];
}

export function buildDeck(src: DeckSources): DeckCard[] {
  const random = src.random ?? Math.random;
  const recent = src.recent ?? [];
  const perKind = src.perKind ?? 4;

  const tips: DeckCard[] = src.tips
    .filter((t) => t.id in LOADING_TIPS)
    .map((t) => ({ kind: 'tip', id: `tip:${t.id}`, heading: LOADING_TIPS[t.id], body: t.blurb }));

  // Lessons for this model first; others only if there aren't enough.
  const lessons = src.lessons.map(
    (l): DeckCard => ({
      kind: 'lesson',
      id: `lesson:${l.id}`,
      lessonId: l.id,
      title: l.title,
      summary: l.summary,
      model: l.model,
      switchesModel: l.model !== null && l.model !== src.presetId,
    }),
  );
  const terms: DeckCard[] = Object.entries(src.glossary).map(([key, g]) => ({
    kind: 'term',
    id: `term:${key}`,
    term: g.term,
    definition: g.definition,
  }));

  const pickedLessons = freshFirst(lessons, recent, random)
    .sort((a, b) => Number(isSwitch(a)) - Number(isSwitch(b)))
    .slice(0, perKind);
  const groups: DeckCard[][] = [
    freshFirst(terms, recent, random).slice(0, perKind),
    freshFirst(tips, recent, random).slice(0, perKind),
    pickedLessons,
  ];
  return interleave(groups);
}

function isSwitch(c: DeckCard): boolean {
  return c.kind === 'lesson' && c.switchesModel;
}

/** Round-robin across groups so the same kind rarely sits twice in a row. */
export function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest; i++) {
    for (const g of groups) if (i < g.length) out.push(g[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface DeckState {
  index: number;
  size: number;
  /** When the current card was shown (for auto-advance). */
  shownAt: number;
}

export type DeckAction =
  | { type: 'next'; now: number }
  | { type: 'prev'; now: number }
  | { type: 'goto'; index: number; now: number };

export function deckReducer(s: DeckState, a: DeckAction): DeckState {
  if (s.size <= 0) return s;
  switch (a.type) {
    case 'next':
      return { ...s, index: (s.index + 1) % s.size, shownAt: a.now };
    case 'prev':
      return { ...s, index: (s.index - 1 + s.size) % s.size, shownAt: a.now };
    case 'goto': {
      const i = Math.trunc(a.index);
      if (i < 0 || i >= s.size || i === s.index) return s;
      return { ...s, index: i, shownAt: a.now };
    }
  }
}

export const AUTO_ADVANCE_MS = 9000;

/** True when the deck should turn to the next card on its own. */
export function shouldAutoAdvance(
  s: DeckState,
  now: number,
  paused: boolean,
  intervalMs = AUTO_ADVANCE_MS,
): boolean {
  return !paused && s.size > 1 && now - s.shownAt >= intervalMs;
}

// ---------------------------------------------------------------------------
// Recently seen (so the next load starts with different cards)
// ---------------------------------------------------------------------------

export const RECENT_KEY = 'pry:loading_deck_recent';
const RECENT_MAX = 24;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readRecent(storage: StorageLike | null = defaultStorage()): string[] {
  try {
    const v = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Record a card as seen: moves it to the end, keeps the list short. */
export function markSeen(
  id: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    const list = readRecent(storage).filter((x) => x !== id);
    list.push(id);
    storage?.setItem(RECENT_KEY, JSON.stringify(list.slice(-RECENT_MAX)));
  } catch {
    /* unavailable: the deck just won't remember */
  }
}
