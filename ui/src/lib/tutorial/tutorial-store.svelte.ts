// Tutorial store: singleton with Svelte 5 runes. Holds only tour-local state
// (where you are, saved progress, async step status). App state lives in
// +page.svelte. Navigation and storage logic is in tour-progress.ts.

import { tourChapters, type TourChapter, type TourStep } from './tour-steps';
import { markTipsSeenForStep } from '../tips/coordinate';
import { initialStepMachine, stepReducer, type StepEvent } from './step-machine';
import {
  clearProgress,
  emptyProgress,
  isLastPos,
  loadProgress,
  nextPos,
  prevPos,
  resumePos,
  saveProgress,
  withCompleted,
  type TourPos,
  type TourProgress,
} from './tour-progress';

export class TutorialState {
  constructor(private readonly chapters: TourChapter[] = tourChapters) {}

  open = $state(false);
  chapterIndex = $state(0);
  /** Step within the current chapter. */
  stepIndex = $state(0);
  whyExpanded = $state(false);
  /** Async step state (idle / running / failed); see step-machine.ts. */
  machine = $state(initialStepMachine());
  /** Set once the user declines the GPT-2 small switch offer for this tour. */
  modelOfferDismissed = $state(false);
  /** Saved progress (completed chapters, place to resume). Read from storage by refresh(). */
  progress = $state<TourProgress>(emptyProgress());
  /**
   * The Attention view a step asked for. A fresh object each time, so the
   * panel re-applies it even when the value repeats (Back, chapter jumps).
   */
  attentionRequest = $state<{ view: 'lines' | 'expert' } | null>(null);

  get chapterList(): TourChapter[] {
    return this.chapters;
  }

  /** True while a step's async work (Run, layer switch...) is in flight. */
  get awaitingAsync() {
    return this.machine.status === 'running';
  }

  get currentChapter(): TourChapter | null {
    return this.chapters[this.chapterIndex] ?? null;
  }

  get currentStep(): TourStep | null {
    return this.currentChapter?.steps[this.stepIndex] ?? null;
  }

  get isFirst(): boolean {
    return prevPos(this.chapters, this.pos) === null;
  }

  get isFinal(): boolean {
    return isLastPos(this.chapters, this.pos);
  }

  /** Where "Continue where you left off" goes; null when there's nothing to continue. */
  get resumeAt(): TourPos | null {
    return resumePos(this.chapters, this.progress);
  }

  isCompleted(chapterId: string): boolean {
    return this.progress.completed.includes(chapterId);
  }

  private get pos(): TourPos {
    return { chapter: this.chapterIndex, step: this.stepIndex };
  }

  dispatch(event: StepEvent) {
    this.machine = stepReducer(this.machine, event);
  }

  /** Re-read saved progress (e.g. before showing the help menu). */
  refresh() {
    this.progress = loadProgress(this.chapters);
  }

  private save() {
    this.progress = {
      ...this.progress,
      chapterId: this.chapters[this.chapterIndex]?.id ?? null,
      step: this.stepIndex,
    };
    saveProgress(this.progress);
  }

  private markTips() {
    const s = this.currentStep;
    if (s) markTipsSeenForStep(s.id, s.target);
  }

  private moveTo(pos: TourPos) {
    this.chapterIndex = pos.chapter;
    this.stepIndex = pos.step;
    this.whyExpanded = false;
    this.machine = initialStepMachine();
    this.save();
  }

  private openAt(pos: TourPos) {
    this.refresh();
    this.modelOfferDismissed = false;
    this.moveTo(pos);
    this.open = true;
  }

  /** Start from the very first step (completed chapters are kept). */
  start() {
    this.openAt({ chapter: 0, step: 0 });
  }

  /** Continue from saved progress, or start at the beginning if there is none. */
  resume() {
    this.refresh();
    this.openAt(this.resumeAt ?? { chapter: 0, step: 0 });
  }

  goToChapter(index: number) {
    if (index < 0 || index >= this.chapters.length) return;
    if (this.open) this.markTips();
    if (this.open) this.moveTo({ chapter: index, step: 0 });
    else this.openAt({ chapter: index, step: 0 });
  }

  /** Forget all tour progress and start over. */
  restart() {
    clearProgress();
    this.progress = emptyProgress();
    this.start();
  }

  /** Forget all tour progress without opening the tour. */
  resetProgress() {
    clearProgress();
    this.progress = emptyProgress();
  }

  next() {
    const to = nextPos(this.chapters, this.pos);
    if (!to) return;
    this.markTips();
    if (to.chapter !== this.chapterIndex) {
      const done = this.currentChapter;
      if (done) this.progress = withCompleted(this.progress, done.id);
    }
    this.moveTo(to);
  }

  back() {
    const to = prevPos(this.chapters, this.pos);
    if (to) this.moveTo(to);
  }

  /** The last step's Done: every chapter counts as finished and there is nothing to resume. */
  finish() {
    this.markTips();
    const last = this.currentChapter;
    if (last) this.progress = withCompleted(this.progress, last.id);
    this.progress = { ...this.progress, chapterId: null, step: 0 };
    saveProgress(this.progress);
    this.shut();
  }

  close() {
    if (!this.open) return;
    this.markTips();
    this.save();
    this.shut();
  }

  private shut() {
    this.open = false;
    this.machine = initialStepMachine();
    this.attentionRequest = null;
  }

  requestAttentionView(view: 'lines' | 'expert') {
    this.attentionRequest = { view };
  }
}

export const tutorialState = new TutorialState();
