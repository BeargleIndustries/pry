import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runActions, type TaskFields } from './tasks';

// "Run it" sends only what it can: a task done with the app's own controls gets nothing to send (rubric r2).
const noop = async () => {};
const set = {
  actions: {
    run: { args: z.object({}).strict(), doc: '', effect: 'compute' as const, run: noop },
    focus_patch_cell: { args: z.object({}).strict(), doc: '', effect: 'view' as const, run: noop },
    write_it: { args: z.object({ temperature: z.number() }).strict(), doc: '', effect: 'compute' as const, run: noop },
    run_dla: { args: z.object({ answer: z.string().optional() }).strict(), doc: '', effect: 'compute' as const, run: noop },
  },
};
const task = (t: Partial<TaskFields>): TaskFields => ({ target: [], ...t });

describe('runActions', () => {
  it('› a view-only task never falls back to the generic run (it would wipe the result the task reads)', () => {
    expect(runActions(task({ learner_actions: ['focus_patch_cell'] }), set, null)).toEqual([]);
  });
  it('› an action that needs arguments only the app gives is left to the app', () => {
    expect(runActions(task({ learner_actions: ['write_it'] }), set, null)).toEqual([]);
  });
  it('› a sendable compute action still runs, and a task naming none still runs the prompt', () => {
    expect(runActions(task({ learner_actions: ['run_dla'] }), set, null)).toEqual([{ name: 'run_dla', args: {} }]);
    expect(runActions(task({}), set, null)).toEqual([{ name: 'run', args: {} }]);
  });
});
