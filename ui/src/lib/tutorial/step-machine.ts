// Pure step-state reducer for the driven tutorial. Plain TS so vitest can test
// it without the Svelte compiler; `tutorial-store.svelte.ts` holds the state in
// `$state` and DrivenTutorial.svelte dispatches events.
//
// An async step (Run / layer switch / model switch) goes idle -> running, then
// running -> idle (the caller advances) on success or running -> failed on
// error. `failed` always clears `running`, so the Next/Back buttons never stay
// stuck; the step offers "Try again" (back to running) or "Skip" (idle; the
// caller advances without the async result).

export type StepStatus = 'idle' | 'running' | 'failed';

export interface StepMachine {
  status: StepStatus;
  error: string | null;
}

export type StepEvent =
  | { type: 'run' }
  | { type: 'succeeded' }
  | { type: 'failed'; error?: string | null }
  | { type: 'retry' }
  | { type: 'skip' }
  | { type: 'reset' };

export const DEFAULT_RUN_ERROR = "That didn't work. The engine may still be starting up.";

export function initialStepMachine(): StepMachine {
  return { status: 'idle', error: null };
}

export function stepReducer(state: StepMachine, event: StepEvent): StepMachine {
  switch (event.type) {
    case 'run':
      return state.status === 'idle' ? { status: 'running', error: null } : state;
    case 'retry':
      return state.status === 'failed' ? { status: 'running', error: null } : state;
    case 'succeeded':
      return state.status === 'running' ? { status: 'idle', error: null } : state;
    case 'failed':
      return state.status === 'running'
        ? { status: 'failed', error: event.error || DEFAULT_RUN_ERROR }
        : state;
    case 'skip':
    case 'reset':
      return initialStepMachine();
  }
}

/**
 * Did an awaited Run / layer switch succeed? Both replace the response object
 * on success and leave it unchanged (layer switch) or null it (generate) on
 * failure, so success is "a new, non-null response appeared".
 */
export function asyncStepSucceeded<T>(before: T | null, after: T | null): boolean {
  return after !== null && after !== before;
}

/** The model the tour copy is written for. */
export const TOUR_PRESET_ID = 'gpt2-small';

/**
 * Offer a switch to GPT-2 small when another model is loaded. Nothing loaded
 * (null) needs no offer: the first Run loads the default, which is GPT-2 small.
 */
export function needsModelOffer(activePresetId: string | null | undefined, dismissed: boolean): boolean {
  if (dismissed || activePresetId == null) return false;
  return activePresetId !== TOUR_PRESET_ID;
}
