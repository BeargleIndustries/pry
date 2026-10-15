// A non-Pry ToolActionSet (plan T2 acceptance): 2 actions, 1 readout, 1 view,
// fake state. Proves the format, lint, dispatcher and (T3) runner take any
// tool. Its "engine" upper-cases the input.

import { z } from 'zod';
import type { ToolActionSet } from '../../registry/contract';

export interface OtherState {
  input: string;
  output: string | null;
}

/** The fake app. */
export const otherApp: OtherState = { input: '', output: null };

export function resetOtherApp(): void {
  otherApp.input = '';
  otherApp.output = null;
}

export const otherTool: ToolActionSet<OtherState> = {
  tool: 'other',
  version: '1.0.0',
  idPrefix: 'other.',
  lessonDir: 'lessons',
  models: ['tiny'],
  services: {},
  spine: [
    { id: 'in', label: 'in' },
    { id: 'out', label: 'out' },
  ],
  baselineSchema: z.strictObject({ input: z.string().optional() }),
  overlaySchema: z.strictObject({ input: z.string().optional(), reset: z.literal(true).optional() }),
  target: (baseline, overlay, from) => {
    const b = (baseline ?? {}) as { input?: string };
    const o = (overlay ?? {}) as { input?: string };
    const start = from ?? { input: b.input ?? '', output: null };
    return { ...start, ...(o.input !== undefined ? { input: o.input } : {}) };
  },
  apply: async (t) => {
    otherApp.input = t.input;
    otherApp.output = t.output;
  },
  snapshot: () => ({ ...otherApp }),
  actions: {
    set_input: {
      args: z.strictObject({ text: z.string() }),
      doc: 'Sets the input.',
      effect: 'view',
      run: async (a: { text: string }) => {
        otherApp.input = a.text;
      },
    },
    run: {
      args: z.strictObject({}),
      doc: 'Runs the input through the engine.',
      effect: 'compute',
      run: async () => {
        otherApp.output = otherApp.input.toUpperCase();
      },
    },
  },
  readouts: {
    result: { type: 'string', doc: 'The output.', read: () => otherApp.output ?? undefined },
  },
  anchors: {},
  views: { card: { doc: 'Shows the output on a card.', args: z.strictObject({}), component: {} } },
  pickers: {},
  memoContext: () => '',
};
