// TutorialActions — callback interface passed from +page.svelte into
// DrivenTutorial, then threaded into each step's action().
import type { TokenInfo } from '$lib/types';
import type { Aggregation } from '$lib/attention-agg';

export interface TutorialActions {
  setPrompt(text: string): void;
  runGenerate(): Promise<void>;
  setActiveTab(tab: 'attention' | 'features'): void;
  setLeftTab?: (tab: string) => void;
  setRightTab?: (tab: string) => void;
  setFocusTokenIndex(idx: number | undefined): void;
  setPanelAAggregation(agg: Aggregation): void;
  findTokenIndex(predicate: (t: TokenInfo) => boolean): number | undefined;
  switchSaeLayer?: (layer: number) => Promise<void>;
  /** Preset currently loaded in the engine (null if none). The tour is pinned to gpt2-small. */
  activePresetId?: () => string | null;
  /** Load a different preset (the page's model-switch flow). Used for the GPT-2 small offer. */
  switchModel?: (presetId: string) => Promise<void>;
  exit(): void;
}
