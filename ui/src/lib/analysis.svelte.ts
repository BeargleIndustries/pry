// Runes wrapper around the analysis controller. Owns the reactive analysis
// state (generate response, every analysis response/loading flag, ablation
// lists, SAE layer) and every dispatcher. `+page.svelte` only wires it up.
//
// All dispatch logic lives in `analysis-core.ts` (plain TS, unit-tested);
// this file just makes its state object deeply reactive.
import {
  AnalysisController,
  createInitialAnalysisState,
  type AnalysisDeps,
} from './analysis-core';

export function createAnalysis(deps: AnalysisDeps): AnalysisController {
  const state = $state(createInitialAnalysisState());
  return new AnalysisController(state, deps);
}
