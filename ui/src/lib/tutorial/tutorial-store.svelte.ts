// Tutorial store -- singleton with Svelte 5 runes.
// Holds ONLY tutorial-local state. App state lives in +page.svelte.

import { drivenSteps } from './driven-steps';
import type { DrivenStep } from './driven-steps';
import { advancedDrivenSteps } from './advanced-steps';
import { markTipsSeenForStep } from '$lib/tips/coordinate';

class TutorialState {
  open = $state(false);
  stepIndex = $state(0);
  whyExpanded = $state(false);
  awaitingAsync = $state(false);
  highlightTarget = $state<string | null>(null);
  isAdvanced = $state(false);

  private get activeSteps(): DrivenStep[] {
    return this.isAdvanced ? advancedDrivenSteps : drivenSteps;
  }

  get totalSteps() {
    return this.activeSteps.length;
  }

  get currentStep() {
    return this.activeSteps[this.stepIndex] ?? null;
  }

  start() {
    this.isAdvanced = false;
    this.stepIndex = 0;
    this.whyExpanded = false;
    this.awaitingAsync = false;
    this.highlightTarget = drivenSteps[0]?.target ?? null;
    this.open = true;
  }

  startAdvanced() {
    this.isAdvanced = true;
    this.stepIndex = 0;
    this.whyExpanded = false;
    this.awaitingAsync = false;
    this.highlightTarget = advancedDrivenSteps[0]?.target ?? null;
    this.open = true;
  }

  close() {
    const steps = this.activeSteps;
    const current = steps[this.stepIndex];
    if (current) markTipsSeenForStep(current.id, current.target);
    this.open = false;
    this.awaitingAsync = false;
    this.highlightTarget = null;
  }

  next() {
    const steps = this.activeSteps;
    if (this.stepIndex < steps.length - 1) {
      const advancingFrom = steps[this.stepIndex];
      if (advancingFrom)
        markTipsSeenForStep(advancingFrom.id, advancingFrom.target);
      this.stepIndex += 1;
      this.whyExpanded = false;
      this.highlightTarget = steps[this.stepIndex]?.target ?? null;
    }
  }

  back() {
    const steps = this.activeSteps;
    if (this.stepIndex > 0) {
      this.stepIndex -= 1;
      this.whyExpanded = false;
      this.highlightTarget = steps[this.stepIndex]?.target ?? null;
    }
  }

  reset() {
    const steps = this.activeSteps;
    this.stepIndex = 0;
    this.whyExpanded = false;
    this.awaitingAsync = false;
    this.highlightTarget = steps[0]?.target ?? null;
  }
}

export const tutorialState = new TutorialState();
