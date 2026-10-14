// A small non-Pry tool for tests: the format and lint work for any ToolActionSet.
// Its baseline and overlay schemas are strict, unlike Pry's T2a placeholders.

import { z } from 'zod';
import type { ToolActionSet } from '../../registry/contract';

const noop = async () => {};

export const fixtureTool: ToolActionSet<Record<string, unknown>> = {
  tool: 'fixture',
  version: '1.2.0',
  idPrefix: 'fix.',
  lessonDir: 'lessons',
  models: ['tiny'],
  services: { catalog: { doc: 'A catalogue.', host: 'catalog.example' } },
  spine: [
    { id: 'in', label: 'in' },
    { id: 'out', label: 'out' },
  ],
  baselineSchema: z.strictObject({ prompt: z.string() }),
  overlaySchema: z.strictObject({ prompt: z.string().optional(), open_panel: z.string().optional() }),
  target: (_b, _o, from) => from ?? {},
  apply: noop,
  snapshot: () => ({}),
  actions: {
    set_input: { args: z.strictObject({ text: z.string() }), doc: 'Sets the input.', effect: 'view', run: noop },
    run: { args: z.strictObject({}), doc: 'Runs.', effect: 'compute', run: noop },
    fetch_label: { args: z.strictObject({}), doc: 'Fetches a label.', effect: 'network', scope: () => 'catalog', run: noop },
  },
  readouts: {
    result: { type: 'record', doc: 'The result.', read: () => undefined },
    score: { type: 'number', unit: 'probability', doc: 'A score.', read: () => undefined },
  },
  anchors: { box: { doc: 'A box.', label: 'the box', locate: () => null } },
  views: {},
  pickers: {},
  memoContext: () => '',
};
