// T26 "Watch it write": replay a continuation one token at a time.
//
// Pure state + wording so it can be tested without Svelte. The component owns
// the timer and calls `tick` on each beat.
//
// Honesty rules:
// - The chances shown are the ones the model actually drew from (at the chosen
//   temperature). At temperature 0 it always takes the top word, and the
//   chances are the model's own, unadjusted ones.
// - When sampling picks a less likely word, say so; never imply the model
//   "preferred" a word it was less sure of.
import type { GenerationStep } from './types';
import { pct, quoteToken } from './readouts';

export interface ReplayState {
  /** Number of steps in the continuation. */
  total: number;
  /** How many steps are on screen (0 = only the prompt). */
  shown: number;
  playing: boolean;
}

export function initReplay(total: number): ReplayState {
  return { total: Math.max(0, total), shown: 0, playing: false };
}

/** Start (or resume) playback; from the end it starts over. */
export function play(s: ReplayState): ReplayState {
  if (s.total === 0) return { ...s, playing: false };
  return { ...s, shown: s.shown >= s.total ? 0 : s.shown, playing: true };
}

export function pause(s: ReplayState): ReplayState {
  return { ...s, playing: false };
}

/** One timer beat: show the next step; stop at the end. */
export function tick(s: ReplayState): ReplayState {
  if (!s.playing) return s;
  const shown = Math.min(s.total, s.shown + 1);
  return { ...s, shown, playing: shown < s.total };
}

/** Manual step forward/back; pauses playback. */
export function stepBy(s: ReplayState, delta: number): ReplayState {
  const shown = Math.min(s.total, Math.max(0, s.shown + delta));
  return { ...s, shown, playing: false };
}

export function showAll(s: ReplayState): ReplayState {
  return { ...s, shown: s.total, playing: false };
}

/** Replay speeds, slowest first: milliseconds per written word. */
export const SPEEDS = [
  { label: 'Slow', ms: 1500 },
  { label: 'Normal', ms: 700 },
  { label: 'Fast', ms: 250 },
] as const;

export const DEFAULT_SPEED_INDEX = 1;

/** Generation length bounds; the sidecar rejects anything outside 1–256 with a 400. */
export const MIN_NEW_TOKENS = 1;
export const MAX_NEW_TOKENS = 64;
export const DEFAULT_NEW_TOKENS = 20;
export const MAX_TEMPERATURE = 2;

export function clampNewTokens(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_NEW_TOKENS;
  return Math.min(MAX_NEW_TOKENS, Math.max(MIN_NEW_TOKENS, Math.round(n)));
}

export function clampTemperature(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(MAX_TEMPERATURE, Math.max(0, t));
}

/** One sentence for the current step: what it picked, and over what. */
export function stepSentence(step: GenerationStep): string {
  const chosen = `${quoteToken(step.token)} (${pct(step.probability)})`;
  if (step.runner_up === null || step.runner_up_probability === null) {
    return `It picked ${chosen}.`;
  }
  const other = `${quoteToken(step.runner_up)} (${pct(step.runner_up_probability)})`;
  if (step.runner_up_probability > step.probability) {
    return `It picked ${chosen} over the more likely ${other}. With some randomness turned on, a less likely word sometimes wins the draw.`;
  }
  return `It picked ${chosen} over ${other}.`;
}

/** Plain-words explanation of a temperature setting. */
export function temperatureExplanation(temp: number): string {
  const t = Math.round(clampTemperature(temp) * 10) / 10;
  if (t === 0) {
    return 'Temperature 0: no randomness. At every step it takes the single most likely next word, so the same prompt always gives the same text. The chances shown are the model\'s own.';
  }
  const base = `Temperature ${t.toFixed(1)}: each next word is drawn at random, weighted by its chance.`;
  if (t < 1) {
    return `${base} Below 1 the odds are sharpened toward the likely words, so the text stays fairly safe. The chances shown are after that adjustment.`;
  }
  if (t === 1) {
    return `${base} At 1 the odds are the model's own, unchanged.`;
  }
  return `${base} Above 1 the odds are flattened, so unlikely words win more often and the text gets stranger. The chances shown are after that adjustment.`;
}

/** Text written so far (prompt excluded). */
export function writtenSoFar(steps: GenerationStep[], shown: number): string {
  return steps.slice(0, Math.max(0, shown)).map((s) => s.token).join('');
}
