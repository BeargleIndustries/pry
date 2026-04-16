// TutorialActions — callback interface passed from +page.svelte into
// DrivenTutorial, then threaded into each step's action().
import type { TokenInfo } from '$lib/types';

export interface TutorialActions {
  setPrompt(text: string): void;
  runGenerate(): Promise<void>;
  setActiveTab(tab: 'attention' | 'features'): void;
  setLeftTab?: (tab: string) => void;
  setRightTab?: (tab: string) => void;
  setFocusTokenIndex(idx: number | undefined): void;
  setPanelAAggregation(agg: 'max' | 'mean' | 'entropy'): void;
  findTokenIndex(predicate: (t: TokenInfo) => boolean): number | undefined;
  switchSaeLayer?: (layer: number) => Promise<void>;
  exit(): void;
}
