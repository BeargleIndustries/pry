// Runes wrapper around the compare controller (T25). `+page.svelte` only wires it up.
import { CompareController, createInitialCompareState, type CompareDeps } from './compare-run';

export function createCompare(deps: CompareDeps): CompareController {
  const state = $state(createInitialCompareState());
  return new CompareController(state, deps);
}
