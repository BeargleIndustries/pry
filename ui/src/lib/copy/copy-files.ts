// Test-only helpers shared by the copy tests (copy-closure, copy-lint, caveats).
// Not imported by the app.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { visibleStrings } from './visible-strings';

/** Copy lanes from plan pry-clarity-2026-10-12 (T4). */
export type Lane = 'T2' | 'T4a' | 'T4b' | 'T4c' | 'T4d' | 'T4e' | 'T6';

/**
 * Lanes not merged into feat/clarity-0.3.8 yet. Their rows run as `test.todo`.
 * Remove a lane from this set when it merges; its rows then have to pass.
 */
export const PENDING_LANES: ReadonlySet<Lane> = new Set<Lane>();

/** `ui/src`. */
export const SRC = resolve(__dirname, '../..');

const cache = new Map<string, string>();

/** File text, path relative to `ui/src`. */
export function read(file: string): string {
  let s = cache.get(file);
  if (s === undefined) {
    s = readFileSync(resolve(SRC, file), 'utf8');
    cache.set(file, s);
  }
  return s;
}

/** Visible strings of a file, path relative to `ui/src`. */
export function visible(file: string): string[] {
  return visibleStrings(read(file), file);
}

/** Every file under `ui/src`, as paths relative to it with forward slashes. */
export function allFiles(): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return walk(SRC).map((p) => relative(SRC, p).replace(/\\/g, '/'));
}

/** Bundled lesson files, `lessons/<id>/lesson.md` (plan pry-learning-mode, T6 caveats and closure). */
export const LESSON_FILES = allFiles().filter((f) => /^lessons\/[^/]+\/lesson\.md$/.test(f));

/** The `.ts` / `.json` / lesson `.md` files that hold user-facing copy (plan T4, closure test mechanism). */
export const COPY_FILES = [
  'lib/tutorial/tour-steps.ts',
  'lib/tips/tips-registry.ts',
  'lib/experiments/experiments.json',
  'lib/experiments/experiments.ts',
  'lib/readouts.ts',
  'lib/glossary.ts',
  'lib/loading-deck.ts',
  'lib/errors.ts',
  'lib/update/update-copy.ts',
  'lib/report.ts',
  'lib/compare.ts',
  'lib/concept-search.ts',
  'lib/custom-models.ts',
  ...LESSON_FILES,
];

/** Files whose copy belongs to a lane (plan: Hotspot ownership). Anything else is checked now. */
export const FILE_OWNER: Record<string, Lane> = {
  'lib/tutorial/tour-steps.ts': 'T4a',
  'lib/experiments/experiments.json': 'T4a',
  'lib/readouts.ts': 'T4c',
  'lib/glossary.ts': 'T4c',
  'lib/errors.ts': 'T4c',
  'lib/compare.ts': 'T4c',
  'lib/concept-search.ts': 'T4c',
  'lib/components/PatchingPanel.svelte': 'T4c',
  'lib/components/SteeringPanel.svelte': 'T4c',
  'lib/components/CircuitPanel.svelte': 'T4c',
  'lib/components/DLAPanel.svelte': 'T4c',
  'lib/components/PredictionsPanel.svelte': 'T4c',
  'lib/components/LogitLensPanel.svelte': 'T4c',
  'lib/components/PanelA.svelte': 'T4c',
  'lib/components/PanelB.svelte': 'T4c',
  'lib/components/FeatureCard.svelte': 'T4c',
  'lib/components/ComparePanel.svelte': 'T4c',
  'lib/components/NoFeaturesNotice.svelte': 'T4c',
  'lib/components/ModelSwitcher.svelte': 'T4c',
};
