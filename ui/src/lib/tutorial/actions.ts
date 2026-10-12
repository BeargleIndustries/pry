// TutorialActions: the moves the tour can make in the app. +page.svelte
// implements them and passes them to DrivenTutorial, which threads them into
// each step's enter() / run.
import type { GenerateResponse, TokenInfo } from '$lib/types';
import type { Aggregation } from '$lib/attention-agg';

export type LeftTab = 'attention' | 'logit-lens' | 'dla' | 'patching' | 'circuit';
export type RightTab = 'features' | 'predictions' | 'steering';
export type PatchType = 'head' | 'mlp' | 'resid';

export interface TutorialActions {
  setPrompt(text: string): void;
  runGenerate(): Promise<void>;
  /** The last successful Run (null before the first one). */
  response(): GenerateResponse | null;
  openLeftTab(tab: LeftTab): void;
  openRightTab(tab: RightTab): void;
  setFocusTokenIndex(idx: number | undefined): void;
  setPanelAAggregation(agg: Aggregation): void;
  findTokenIndex(predicate: (t: TokenInfo) => boolean): number | undefined;
  switchSaeLayer(layer: number): Promise<void>;
  currentSaeLayer(): number | null;
  /** Copying-heads view in the Attention panel (scores the heads the first time). */
  showCopyingHeads(): void;
  hideCopyingHeads(): void;
  /** Turn head ablation on with these heads picked (empty list + false turns it off). */
  setHeadAblation(on: boolean, heads?: { layer: number; head: number }[]): void;
  runHeadAblation(): Promise<void>;
  headAblationResult(): unknown;
  /** Fill Swap & Compare's boxes and run it. */
  runPatching(clean: string, corrupted: string, type: PatchType): Promise<void>;
  patchingResult(): unknown;
  setCompareMode(on: boolean): void;
  setComparePrompts(a: string, b: string): void;
  runCompare(): Promise<void>;
  compareResult(): unknown;
  /** Preset currently loaded in the engine (null if none). The tour is pinned to gpt2-small. */
  activePresetId(): string | null;
  /** Load a different preset (the page's model-switch flow). Used for the GPT-2 small offer. */
  switchModel(presetId: string): Promise<void>;
  exit(): void;
}

/** What a step sees: the page's actions plus the tour's own view controls. */
export interface TourContext extends TutorialActions {
  /** Ask the Attention panel for its Lines or Expert (grid) view. */
  setAttentionView(view: 'lines' | 'expert'): void;
}
