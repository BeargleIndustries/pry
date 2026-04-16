// Tutorial <-> tips coordination.
//
// The driven tutorial owns a subset of screen real estate that would otherwise
// show first-mount tips. When the tutorial advances (or closes), we flip the
// `pry:tip_seen:*` flag for any tip whose `tutorialStepId` matches the
// advancing step id, OR whose `data-tip` selector string-equals the advancing
// step's `target` attribute. Coupling is one-way: tutorial -> tips. Tips never
// mutate tutorial state.

import { tipsRegistry } from './tips-registry';

const STORAGE_PREFIX = 'pry:tip_seen:';

export function markTipsSeenForStep(
  stepId: string,
  stepTarget: string | null,
): void {
  if (typeof localStorage === 'undefined') return;
  for (const tip of tipsRegistry) {
    const matchesStep = tip.tutorialStepId === stepId;
    const matchesTarget =
      stepTarget !== null && tip.target === `[data-tip="${stepTarget}"]`;
    if (matchesStep || matchesTarget) {
      localStorage.setItem(`${STORAGE_PREFIX}${tip.id}`, 'true');
    }
  }
}

export function resetAllTips(): void {
  if (typeof localStorage === 'undefined') return;
  for (const tip of tipsRegistry) {
    localStorage.removeItem(`${STORAGE_PREFIX}${tip.id}`);
  }
}

export function isTipSeen(id: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(`${STORAGE_PREFIX}${id}`) === 'true';
}

export function markTipSeen(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`${STORAGE_PREFIX}${id}`, 'true');
}
