// Honest, smooth progress for loading a model (the /load SSE stream).
//
// The engine reports coarse stages ("Starting the math libraries…", "Reading
// the model's weights…") and the slow ones last tens of seconds, so a bar
// that only moves on stage changes looks frozen. This module turns the stage
// stream into a bar that:
//
//   - gives each stage a share of the bar sized by how long it is expected to
//     take: last load's measured time for this model when we have it, a
//     default guess otherwise;
//   - fills smoothly inside the current stage, but never past that stage's
//     share, so it never claims to be done early;
//   - with no history, eases toward the end of the share without reaching it,
//     so it keeps moving however long the stage takes;
//   - never moves backwards, even when a stage is skipped or a download shows
//     up that wasn't planned;
//   - only offers an "about N s left" estimate when it has a measurement to
//     base it on.
//
// Everything here is pure (state in, state out; `now` passed in) so it can be
// tested with fixed clocks. Storage helpers take a Storage-like object.

import type { LoadProgress } from './sidecar';

/** Canonical order. `unload` is client-side (switching away from a model). */
export const STAGE_ORDER = [
  'unload',
  'warmup',
  'check_files',
  'download_model',
  'load_model',
  'to_device',
  'download_sae',
  'load_sae',
] as const;

/** Guesses in seconds, used only when this model has no measured history. */
export const DEFAULT_SECONDS: Record<string, number> = {
  unload: 2,
  warmup: 20,
  check_files: 1,
  download_model: 60,
  load_model: 12,
  to_device: 3,
  download_sae: 20,
  load_sae: 3,
};
const UNKNOWN_STAGE_SECONDS = 3;
const MIN_STAGE_SECONDS = 0.25;

/** Stages that only appear sometimes; not planned until the engine sends them. */
const OPTIONAL_STAGES = new Set(['unload', 'download_model', 'download_sae']);
/** Stages every load goes through. */
const CORE_STAGES = new Set(['check_files', 'load_model', 'load_sae']);
const DOWNLOAD_STAGES = new Set(['download_model', 'download_sae']);
/** Not worth remembering: downloads happen once, unload depends on the previous model. */
const UNREMEMBERED_STAGES = new Set(['unload', 'download_model', 'download_sae']);

/** Within a stage with history, the bar reaches this share at the expected time… */
const ON_TIME_SHARE = 0.9;
/** …and creeps toward (never reaching) this share if the stage runs long. */
const OVERRUN_CEILING = 0.99;
/** Within a stage without history, the bar eases toward this share. */
const NO_HISTORY_CEILING = 0.95;
/** The whole bar never shows more than this until `ready` arrives. */
const MAX_BEFORE_DONE = 0.99;

/** Plain-words names for each stage, for the stage list. */
export const STAGE_LABELS: Record<string, string> = {
  unload: 'Putting the last model away',
  warmup: 'Starting the math libraries',
  check_files: "Checking the model's files",
  download_model: 'Downloading the model',
  load_model: 'Loading the model into memory',
  to_device: 'Moving it to your GPU',
  download_sae: 'Downloading the feature dictionary',
  load_sae: 'Loading the feature dictionary',
  ready: 'Ready',
  already_loaded: 'Ready',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// History (last completed load per preset)
// ---------------------------------------------------------------------------

export interface TimingHistory {
  v: 1;
  /** Seconds each stage took on the last completed load. */
  stages: Record<string, number>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function historyKey(presetId: string): string {
  return `pry:load_timing:${presetId}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function parseHistory(raw: string | null): TimingHistory | null {
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Partial<TimingHistory>;
    if (h?.v !== 1 || !h.stages || typeof h.stages !== 'object') return null;
    const stages: Record<string, number> = {};
    for (const [k, v] of Object.entries(h.stages)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) stages[k] = v;
    }
    return Object.keys(stages).length ? { v: 1, stages } : null;
  } catch {
    return null;
  }
}

export function readHistory(
  presetId: string,
  storage: StorageLike | null = defaultStorage(),
): TimingHistory | null {
  try {
    return parseHistory(storage?.getItem(historyKey(presetId)) ?? null);
  } catch {
    return null;
  }
}

export function writeHistory(
  presetId: string,
  history: TimingHistory | null,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!history) return;
  try {
    storage?.setItem(historyKey(presetId), JSON.stringify(history));
  } catch {
    /* storage full or unavailable: next load just has no estimate */
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface LoadTrack {
  presetId: string;
  startedAt: number;
  history: TimingHistory | null;
  /** Stages expected this load, in order (completed ones included). */
  plan: string[];
  /** Stages actually seen, in order. */
  seen: string[];
  current: string | null;
  stageStartedAt: number;
  /** Measured seconds for stages completed this load. */
  durations: Record<string, number>;
  message: string | null;
  bytes: { done: number; total: number | null } | null;
  /** Continuity anchor: mapped = d + (raw - c) * (1 - d) / (1 - c). */
  anchor: { d: number; c: number };
  done: boolean;
  failed: boolean;
}

export type LoadAction =
  | { type: 'start'; presetId: string; now: number; history: TimingHistory | null }
  | { type: 'event'; ev: LoadProgress; now: number };

export function startLoad(
  presetId: string,
  now: number,
  history: TimingHistory | null,
): LoadTrack {
  const plan = initialPlan(history);
  return {
    presetId,
    startedAt: now,
    history,
    plan,
    seen: [],
    current: null,
    stageStartedAt: now,
    durations: {},
    message: null,
    bytes: null,
    anchor: { d: 0, c: 0 },
    done: false,
    failed: false,
  };
}

export function initialPlan(history: TimingHistory | null): string[] {
  // With history, expect what happened last time (plus the stages every load
  // has). Without it, expect everything that isn't occasional.
  if (history) {
    return STAGE_ORDER.filter((s) => s in history.stages || CORE_STAGES.has(s));
  }
  return STAGE_ORDER.filter((s) => !OPTIONAL_STAGES.has(s));
}

function orderIndex(stage: string): number {
  return (STAGE_ORDER as readonly string[]).indexOf(stage);
}

/** Expected seconds for a stage: history first, then defaults. */
export function expectedSeconds(track: Pick<LoadTrack, 'history'>, stage: string): number {
  const h = track.history?.stages[stage];
  const s = h ?? DEFAULT_SECONDS[stage] ?? UNKNOWN_STAGE_SECONDS;
  return Math.max(MIN_STAGE_SECONDS, s);
}

function hasStageHistory(track: LoadTrack, stage: string): boolean {
  return typeof track.history?.stages[stage] === 'number';
}

function bytesOf(ev: LoadProgress): { done: number; total: number | null } | null {
  const done = ev.bytes_done ?? ev.bytes_downloaded;
  if (typeof done !== 'number' || !Number.isFinite(done)) return null;
  const total = typeof ev.bytes_total === 'number' && ev.bytes_total > 0 ? ev.bytes_total : null;
  return { done, total };
}

/** Plan after `stage` starts: what we've seen, then still-expected later stages. */
function replan(track: LoadTrack, seen: string[]): string[] {
  let lastKnown = -1;
  for (const s of seen) lastKnown = Math.max(lastKnown, orderIndex(s));
  const rest = track.plan.filter((s) => !seen.includes(s) && orderIndex(s) > lastKnown);
  return [...seen, ...rest];
}

function samePlan(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

export function applyEvent(track: LoadTrack, ev: LoadProgress, now: number): LoadTrack {
  if (track.done || track.failed) return track;
  const stage = String(ev.stage ?? '');
  const message = ev.message?.trim() || track.message;

  if (stage === 'error') {
    return { ...track, failed: true, message };
  }
  if (stage === 'ready' || stage === 'already_loaded') {
    const durations = { ...track.durations };
    if (track.current) durations[track.current] = (now - track.stageStartedAt) / 1000;
    return { ...track, durations, current: null, done: true, message, bytes: null };
  }
  if (!stage) return track;

  const elapsedMs =
    typeof ev.elapsed_s === 'number' && Number.isFinite(ev.elapsed_s) && ev.elapsed_s >= 0
      ? ev.elapsed_s * 1000
      : null;

  if (stage === track.current) {
    // Heartbeat: keep the stage clock honest if the engine says it has been longer.
    const stageStartedAt =
      elapsedMs !== null ? Math.min(track.stageStartedAt, now - elapsedMs) : track.stageStartedAt;
    return { ...track, message, stageStartedAt, bytes: bytesOf(ev) ?? track.bytes };
  }

  // A new stage: close the old one, re-plan, keep the bar continuous.
  const before = mappedFraction(track, now);
  const durations = { ...track.durations };
  if (track.current) durations[track.current] = (now - track.stageStartedAt) / 1000;
  const seen = track.seen.includes(stage) ? track.seen : [...track.seen, stage];
  const plan = replan(track, seen);
  let next: LoadTrack = {
    ...track,
    plan,
    seen,
    durations,
    current: stage,
    stageStartedAt: now - (elapsedMs ?? 0),
    message,
    bytes: bytesOf(ev),
  };
  if (!samePlan(plan, track.plan)) {
    next = { ...next, anchor: { d: before, c: rawFraction(next, now) } };
  }
  return next;
}

export function reduceLoad(track: LoadTrack | null, action: LoadAction): LoadTrack | null {
  switch (action.type) {
    case 'start':
      return startLoad(action.presetId, action.now, action.history);
    case 'event':
      return track ? applyEvent(track, action.ev, action.now) : track;
  }
}

// ---------------------------------------------------------------------------
// Reading the state
// ---------------------------------------------------------------------------

/** 0..1 progress through the current stage, never reaching 1. */
export function withinStage(track: LoadTrack, now: number): number {
  const stage = track.current;
  if (!stage) return 0;
  const t = Math.max(0, (now - track.stageStartedAt) / 1000);
  if (DOWNLOAD_STAGES.has(stage) && track.bytes?.total) {
    return Math.min(MAX_BEFORE_DONE, Math.max(0, track.bytes.done / track.bytes.total));
  }
  const e = expectedSeconds(track, stage);
  if (hasStageHistory(track, stage)) {
    if (t <= e) return (ON_TIME_SHARE * t) / e;
    return ON_TIME_SHARE + (OVERRUN_CEILING - ON_TIME_SHARE) * (1 - Math.exp(-(t - e) / e));
  }
  return NO_HISTORY_CEILING * (1 - Math.exp(-t / e));
}

/** Progress by the current plan's weights, ignoring continuity. */
export function rawFraction(track: LoadTrack, now: number): number {
  if (track.done) return 1;
  const weights = track.plan.map((s) => expectedSeconds(track, s));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const idx = track.current ? track.plan.indexOf(track.current) : -1;
  if (idx < 0) return 0;
  let done = 0;
  for (let i = 0; i < idx; i++) done += weights[i];
  done += weights[idx] * withinStage(track, now);
  return Math.min(1, done / total);
}

/** Raw progress mapped through the continuity anchor. Monotonic in `now`. */
export function mappedFraction(track: LoadTrack, now: number): number {
  if (track.done) return 1;
  const raw = rawFraction(track, now);
  const { d, c } = track.anchor;
  let v: number;
  if (c >= 1) v = Math.max(d, raw);
  else if (raw <= c) v = d;
  else v = d + ((raw - c) * (1 - d)) / (1 - c);
  return Math.min(MAX_BEFORE_DONE, Math.max(0, v));
}

export interface LoadView {
  /** 0..1, monotonic for a given track (callers should still max() across ticks). */
  fraction: number;
  /** Seconds left, or null when there's nothing honest to base it on. */
  etaSeconds: number | null;
  /** The current stage has run past last time's measurement. */
  overEstimate: boolean;
  /** There's a measured history for this model. */
  hasHistory: boolean;
  stage: string | null;
  stageElapsed: number;
  totalElapsed: number;
}

export function viewAt(track: LoadTrack, now: number): LoadView {
  const stage = track.current;
  const stageElapsed = Math.max(0, (now - track.stageStartedAt) / 1000);
  const totalElapsed = Math.max(0, (now - track.startedAt) / 1000);
  const base = {
    fraction: mappedFraction(track, now),
    hasHistory: !!track.history,
    stage,
    stageElapsed,
    totalElapsed,
  };
  if (track.done) return { ...base, etaSeconds: 0, overEstimate: false };
  if (!stage || !track.history) return { ...base, etaSeconds: null, overEstimate: false };

  // Current stage's remaining time.
  let current: number | null = null;
  let overEstimate = false;
  if (DOWNLOAD_STAGES.has(stage)) {
    const b = track.bytes;
    if (b?.total && b.done > 0 && stageElapsed > 0.5) {
      const rate = b.done / stageElapsed;
      current = Math.max(0, (b.total - b.done) / rate);
    }
  } else if (hasStageHistory(track, stage)) {
    const e = expectedSeconds(track, stage);
    if (stageElapsed < e) current = e - stageElapsed;
    else overEstimate = true;
  }
  if (current === null) return { ...base, etaSeconds: null, overEstimate };

  const idx = track.plan.indexOf(stage);
  let later = 0;
  for (const s of track.plan.slice(idx + 1)) {
    // A later download we can't size makes any estimate a guess; say nothing.
    if (DOWNLOAD_STAGES.has(s)) return { ...base, etaSeconds: null, overEstimate };
    later += expectedSeconds(track, s);
  }
  return { ...base, etaSeconds: current + later, overEstimate };
}

/** What to remember from a completed load for next time, or null. */
export function historyFromTrack(track: LoadTrack): TimingHistory | null {
  if (!track.done) return null;
  const stages: Record<string, number> = {};
  for (const [s, secs] of Object.entries(track.durations)) {
    if (UNREMEMBERED_STAGES.has(s)) continue;
    if (!Number.isFinite(secs) || secs < 0) continue;
    stages[s] = Math.round(secs * 10) / 10;
  }
  return Object.keys(stages).length ? { v: 1, stages } : null;
}

/**
 * applyEvent, plus: when the load finishes for real (`ready`, not
 * `already_loaded`), remember this load's stage times for next time.
 */
export function recordEvent(
  track: LoadTrack,
  ev: LoadProgress,
  now: number,
  storage: StorageLike | null = defaultStorage(),
): LoadTrack {
  const next = applyEvent(track, ev, now);
  if (ev.stage === 'ready' && next.done && !track.done) {
    writeHistory(next.presetId, historyFromTrack(next), storage);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "about 15 s left" / "about 2 min left" / "a few seconds left". */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 5) return 'a few seconds left';
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s left`;
  const min = Math.round(seconds / 60);
  return `about ${min} min left`;
}

/** 0:07, 1:32, 12:05 */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Steps for the stage list: what's done, what's happening, what's next. */
export interface StageStep {
  stage: string;
  label: string;
  status: 'done' | 'current' | 'next';
  /** Measured seconds for done stages. */
  seconds: number | null;
}

export function stageSteps(track: LoadTrack): StageStep[] {
  return track.plan.map((stage) => {
    const status: StageStep['status'] =
      stage === track.current
        ? 'current'
        : track.done || stage in track.durations
          ? 'done'
          : 'next';
    return {
      stage,
      label: stageLabel(stage),
      status,
      seconds: status === 'done' ? (track.durations[stage] ?? null) : null,
    };
  });
}

/** A one-line, honest note for the current moment, or null. */
export function stageNote(track: LoadTrack, view: LoadView): string | null {
  const stage = track.current;
  if (!stage) return null;
  if (view.overEstimate) {
    return 'If your computer is busy with something else, loading slows down.';
  }
  switch (stage) {
    case 'warmup':
      return 'The first load after you restart your computer is the slowest, because Windows has to pull a lot of files off the disk the first time.';
    case 'download_model':
    case 'download_sae':
      return 'You only download this once. After that, Pry loads it from your computer.';
    case 'load_model':
      return "Weights are the numbers a model learned in training. This step pulls every one of them off your disk, so bigger models take longer.";
    case 'to_device':
      return "Pry copies the model's numbers into your graphics card's memory, because that's where the math runs fastest.";
    case 'load_sae':
      return 'Pry uses the feature dictionary (an SAE) to turn the model’s internal numbers into ideas you can read.';
    default:
      return null;
  }
}
