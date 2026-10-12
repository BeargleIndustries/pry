import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_ERROR,
  asyncStepSucceeded,
  initialStepMachine,
  needsModelOffer,
  stepReducer,
  type StepEvent,
  type StepMachine,
} from './step-machine';

const run = (events: StepEvent[], from: StepMachine = initialStepMachine()) =>
  events.reduce(stepReducer, from);

describe('stepReducer', () => {
  it('run -> succeeded returns to idle', () => {
    expect(run([{ type: 'run' }])).toEqual({ status: 'running', error: null });
    expect(run([{ type: 'run' }, { type: 'succeeded' }])).toEqual({ status: 'idle', error: null });
  });

  it('a failed Run clears running and keeps the error', () => {
    const s = run([{ type: 'run' }, { type: 'failed', error: 'engine down' }]);
    expect(s).toEqual({ status: 'failed', error: 'engine down' });
    expect(s.status).not.toBe('running');
  });

  it('a failure without a message gets the default copy', () => {
    expect(run([{ type: 'run' }, { type: 'failed' }]).error).toBe(DEFAULT_RUN_ERROR);
  });

  it('Try again goes back to running and clears the error', () => {
    const s = run([{ type: 'run' }, { type: 'failed', error: 'x' }, { type: 'retry' }]);
    expect(s).toEqual({ status: 'running', error: null });
    expect(run([{ type: 'succeeded' }], s).status).toBe('idle');
  });

  it('Skip from failed returns to idle', () => {
    expect(run([{ type: 'run' }, { type: 'failed' }, { type: 'skip' }])).toEqual(initialStepMachine());
  });

  it('ignores events that do not apply to the current status', () => {
    const idle = initialStepMachine();
    expect(stepReducer(idle, { type: 'succeeded' })).toBe(idle);
    expect(stepReducer(idle, { type: 'failed' })).toBe(idle);
    expect(stepReducer(idle, { type: 'retry' })).toBe(idle);
    const running = run([{ type: 'run' }]);
    expect(stepReducer(running, { type: 'run' })).toBe(running);
    // A late failure after the user skipped must not resurrect the error.
    const skipped = run([{ type: 'skip' }], running);
    expect(stepReducer(skipped, { type: 'failed', error: 'late' })).toBe(skipped);
  });

  it('reset always returns to idle', () => {
    expect(run([{ type: 'run' }, { type: 'reset' }])).toEqual(initialStepMachine());
    expect(run([{ type: 'run' }, { type: 'failed' }, { type: 'reset' }])).toEqual(initialStepMachine());
  });
});

describe('asyncStepSucceeded', () => {
  const r1 = { id: 1 };
  const r2 = { id: 2 };
  it('succeeds when a new response appears', () => {
    expect(asyncStepSucceeded(null, r1)).toBe(true);
    expect(asyncStepSucceeded(r1, r2)).toBe(true);
  });
  it('fails when the response was cleared or unchanged', () => {
    expect(asyncStepSucceeded(r1, null)).toBe(false);
    expect(asyncStepSucceeded(null, null)).toBe(false);
    expect(asyncStepSucceeded(r1, r1)).toBe(false);
  });
});

describe('needsModelOffer', () => {
  it('offers a switch when another model is loaded', () => {
    expect(needsModelOffer('pythia-70m', false)).toBe(true);
  });
  it('no offer on GPT-2 small, with nothing loaded, or once dismissed', () => {
    expect(needsModelOffer('gpt2-small', false)).toBe(false);
    expect(needsModelOffer(null, false)).toBe(false);
    expect(needsModelOffer(undefined, false)).toBe(false);
    expect(needsModelOffer('pythia-70m', true)).toBe(false);
  });
});
