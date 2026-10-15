// Pry views (plan T2): tool renderers the runner mounts in compare and observe
// steps. Each component takes `args` (checked by its schema) and, for views
// over captured runs, `captures` (capture name → the `result` readout stored
// at that do step).

import { z } from 'zod';
import type { ViewDef } from '../contract';
import EmbeddingCompare from './embedding-compare.svelte';
import TextDiff from './text-diff.svelte';
import Top5Pair from './top5-pair.svelte';
import ThreeLogits from './three-logits.svelte';
import SummaryTable from './summary-table.svelte';

const captures = z.object({ a: z.string(), b: z.string() }).strict();

export const pryViews: Record<string, ViewDef> = {
  'embedding-compare': {
    doc: 'Two token positions side by side with the count of matching numbers; rows split into embedding and positional embedding when split; cosine only beside the lists it compares.',
    args: z.object({}).strict(),
    component: EmbeddingCompare,
  },
  'text-diff': {
    doc: 'A captured text against a second capture (b) or a literal reference text, with the changed tokens marked.',
    args: z
      .object({ a: z.string(), b: z.string().optional(), text: z.string().optional() })
      .strict()
      .refine((v) => (v.b === undefined) !== (v.text === undefined), { message: 'give exactly one of b (a capture) or text (a literal reference)' }),
    component: TextDiff,
  },
  'top5-pair': { doc: 'Two captured top 5 lists side by side.', args: captures, component: Top5Pair },
  'three-logits': {
    doc: 'Clean, corrupted and patched logits on one line with the share formula.',
    args: z.object({}).strict(),
    component: ThreeLogits,
  },
  'summary-table': {
    doc: 'The three-tool summary table from P3.6.',
    args: z.record(z.string(), z.unknown()),
    component: SummaryTable,
  },
};
