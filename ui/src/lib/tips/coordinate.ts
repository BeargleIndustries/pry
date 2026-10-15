// Quick tour <-> tips coordination.
//
// The quick tour (the overlay lesson `pry.quick-tour`, on the Lessons runner)
// points at places a first-time tip would otherwise explain. When the runner
// shows a tour step, we flip the `pry:tip_seen:*` flag for any tip whose
// `tutorialStepId` names that step (`pry.quick-tour#<stepId>`), OR whose
// `data-tip` selector names an anchor the step points at. Coupling is one-way:
// tour -> tips. Tips never change the tour.

import { tipsRegistry } from './tips-registry';

const STORAGE_PREFIX = 'pry:tip_seen:';

/** `stepRef` is the runner's current step as `<lesson id>#<step id>`; `anchors` are the anchors it points at. */
export function markTipsSeenForStep(stepRef: string, anchors: readonly string[] = []): void {
  if (typeof localStorage === 'undefined') return;
  for (const tip of tipsRegistry) {
    const matchesStep = tip.tutorialStepId === stepRef;
    const matchesTarget = anchors.some((a) => tip.target === `[data-tip="${a}"]`);
    if (matchesStep || matchesTarget) {
      localStorage.setItem(`${STORAGE_PREFIX}${tip.id}`, 'true');
    }
  }
}

/** Forget every "tip seen" flag, including ones for tips no longer in the registry. */
export function resetAllTips(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const tip of tipsRegistry) keys.push(`${STORAGE_PREFIX}${tip.id}`);
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
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
