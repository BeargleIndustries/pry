// Pry views (plan T2): tool renderers mounted in compare and observe steps.
// T2a ships the names and argument schemas; each `component` throws until T2b
// adds the Svelte components to this folder (e.g. embedding-compare.svelte).

import { z } from 'zod';
import { notImplemented, type ViewDef } from '../contract';

function stub(doc: string, args: ViewDef['args']): ViewDef {
  return {
    doc,
    args,
    get component(): unknown {
      return notImplemented();
    },
  };
}

// TODO(pry-learning T2b): the plan names the views but not their arguments;
// these shapes are T2a's placeholders.
const captures = z.object({ a: z.string(), b: z.string() }).strict();

export const pryViews: Record<string, ViewDef> = {
  'embedding-compare': stub(
    'Two token positions side by side with the count of matching numbers; rows split into embedding and positional embedding when split; cosine only beside the lists it compares.',
    z.object({}).strict(),
  ),
  'text-diff': stub('Two captured texts with the changed tokens marked.', captures),
  'top5-pair': stub('Two captured top 5 lists side by side.', captures),
  'three-logits': stub('Clean, corrupted and patched logits on one line with the share formula.', z.object({}).strict()),
  'summary-table': stub('The three-tool summary table from P3.6.', z.record(z.string(), z.unknown())),
};
