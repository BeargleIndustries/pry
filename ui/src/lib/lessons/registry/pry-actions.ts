// Pry actions (plan T2 "Pry actions"): every name with its argument schema,
// effect, scope where gated, doc and `stateful` where marked. T2a ships the
// names; `run` is a stub until T2b fills it in place.
// Aliases of the generic names (generic.ts) point at the same definition.

import { z } from 'zod';
import { notImplemented, type ActionDef } from './contract';
import { PRY_MODELS } from './pry-models';

export const PANELS = [
  'attention',
  'logit-lens',
  'dla',
  'patching',
  'circuit',
  'steering',
  'predictions',
  'features',
  'watch-it-write',
] as const;

const layer = z.number().int().min(0);
const head = z.number().int().min(0);
const featureId = z.number().int().min(0);
const occurrence = z.union([z.literal('first'), z.literal('last'), z.number().int().min(1)]);
const noArgs = z.object({}).strict();
const embeddingSide = z.object({ prompt: z.string(), token: z.string(), occurrence: occurrence.optional() }).strict();

const run = notImplemented as ActionDef['run'];

const set_prompt: ActionDef = {
  args: z.object({ text: z.string() }).strict(),
  doc: 'Sets the prompt.',
  effect: 'view',
  run,
};

const open_panel: ActionDef = {
  args: z.object({ panel: z.enum(PANELS) }).strict(),
  doc: 'Opens a left or right tab.',
  effect: 'view',
  run,
};

const focus_token: ActionDef = {
  args: z.union([
    z.object({ text: z.string(), occurrence: occurrence.optional() }).strict(),
    z.object({ index: z.number().int().min(0) }).strict(),
  ]),
  doc: 'Selects a token by its text and which occurrence (first, last or the nth), or by index, where the start marker is 0.',
  effect: 'view',
  run,
};

const switch_model: ActionDef = {
  args: z.object({ preset: z.enum(PRY_MODELS) }).strict(),
  doc: 'Switches the model through the load controller, licence check included. May download weights.',
  effect: 'download',
  scope: (args: { preset: string }) => args.preset,
  stateful: true,
  run,
};

export const pryActions: Record<string, ActionDef> = {
  set_prompt,
  set_input: set_prompt,
  run: {
    args: noArgs,
    doc: 'Runs the prompt. Runner-issued runs are memoised.',
    effect: 'compute',
    run,
  },
  ensure_run: {
    args: z.object({ prompt: z.string() }).strict(),
    doc: 'Runs the prompt only if the memo lacks this request.',
    effect: 'compute',
    run,
  },
  open_panel,
  open_view: open_panel,
  focus_token,
  focus_item: focus_token,
  highlight: {
    args: z.union([
      z.object({ anchor: z.string() }).strict(),
      z.object({ anchors: z.array(z.string()).min(1) }).strict(),
    ]),
    doc: 'Rings an anchor. A list points at each anchor in turn.',
    effect: 'view',
    run,
  },
  set_hidden: {
    args: z.object({ anchor: z.string(), on: z.boolean() }).strict(),
    doc: 'Hides or shows a hideable region.',
    effect: 'view',
    run,
  },
  reset: {
    args: noArgs,
    doc: 'Returns the app to its baseline, like Back to normal.',
    effect: 'view',
    run,
  },
  set_compare_mode: {
    args: z.object({ on: z.boolean() }).strict(),
    doc: 'Turns Compare mode on or off.',
    effect: 'view',
    run,
  },
  set_compare: {
    args: z.object({ a: z.string(), b: z.string() }).strict(),
    doc: 'Sets the two Compare prompts.',
    effect: 'view',
    run,
  },
  run_compare: {
    args: noArgs,
    doc: 'Runs both Compare prompts.',
    effect: 'compute',
    run,
  },
  write_it: {
    args: z
      .object({
        temperature: z.number().min(0),
        seed: z.number().int().optional(),
        max_tokens: z.number().int().min(1).optional(),
      })
      .strict(),
    doc: 'Runs Watch it write and returns the text.',
    effect: 'compute',
    run,
  },
  set_attention_view: {
    args: z.object({ view: z.enum(['lines', 'expert']) }).strict(),
    doc: 'Picks the attention view: Lines or Expert.',
    effect: 'view',
    run,
  },
  set_aggregation: {
    args: z.object({ aggregation: z.enum(['max', 'spread', 'looks-back', 'previous', 'mean']) }).strict(),
    doc: 'Picks the Score by option for the attention grid.',
    effect: 'view',
    run,
  },
  set_lines_head: {
    args: z.object({ layer, head }).strict(),
    doc: 'Picks the head the Lines view draws.',
    effect: 'view',
    run,
  },
  set_focus_mode: {
    args: z.object({ mode: z.enum(['from', 'to']) }).strict(),
    doc: 'Picks FROM or TO for the attention grid.',
    effect: 'view',
    run,
  },
  open_head: {
    args: z.object({ layer, head }).strict(),
    doc: 'Opens one attention head.',
    effect: 'view',
    run,
  },
  show_copying_heads: {
    args: z.object({ on: z.boolean() }).strict(),
    doc: 'Turns the Copying heads view on or off.',
    effect: 'compute',
    run,
  },
  run_logit_lens: {
    args: noArgs,
    doc: 'Runs the logit lens and waits for it.',
    effect: 'compute',
    run,
  },
  run_dla: {
    args: z.object({ answer: z.string().optional(), contrast: z.string().optional() }).strict(),
    doc: 'Runs DLA and waits for it, with an optional answer and contrast token.',
    effect: 'compute',
    run,
  },
  switch_sae_layer: {
    args: z.object({ layer }).strict(),
    doc: 'Switches the feature dictionary (SAE) layer.',
    effect: 'compute',
    stateful: true,
    run,
  },
  open_feature: {
    args: z.object({ id: featureId }).strict(),
    doc: 'Opens the feature card for one feature id.',
    effect: 'view',
    run,
  },
  search_concepts: {
    args: z.object({ text: z.string() }).strict(),
    doc: 'Looks up a concept on Neuronpedia. The learner starts it.',
    effect: 'network',
    scope: () => 'neuronpedia',
    run,
  },
  set_head_ablation: {
    args: z.object({ heads: z.array(z.object({ layer, head }).strict()), on: z.boolean() }).strict(),
    doc: 'Marks attention heads to knock out.',
    effect: 'view',
    run,
  },
  run_head_ablation: {
    args: noArgs,
    doc: 'Runs the prompt with the marked heads knocked out.',
    effect: 'compute',
    run,
  },
  run_patching: {
    args: z.object({ clean: z.string(), corrupted: z.string(), type: z.enum(['head', 'mlp', 'resid']) }).strict(),
    doc: 'Runs the Swap test (activation patching) on a clean and a corrupted prompt.',
    effect: 'compute',
    run,
  },
  set_patch_view: {
    args: z.object({ type: z.enum(['head', 'mlp', 'resid']) }).strict(),
    doc: 'Shows one Swap test view without running it again.',
    effect: 'view',
    run,
  },
  focus_patch_cell: {
    args: z.object({ layer, position: z.number().int().min(0) }).strict(),
    doc: 'Selects a Swap test cell so its three logits and share can be read.',
    effect: 'view',
    run,
  },
  set_feature_ablation: {
    args: z.object({ ids: z.array(featureId), on: z.boolean() }).strict(),
    doc: 'Marks features to knock out.',
    effect: 'view',
    run,
  },
  run_feature_ablation: {
    args: noArgs,
    doc: 'Runs the prompt with the marked features knocked out.',
    effect: 'compute',
    run,
  },
  set_steering: {
    args: z.object({ feature_id: featureId, strength: z.number() }).strict(),
    doc: 'Sets the steering feature and Steering strength.',
    effect: 'view',
    run,
  },
  run_steer: {
    args: z.object({ control: z.literal(true).optional() }).strict(),
    doc: 'Runs steering. With control, also runs a norm-matched control feature at the same strength.',
    effect: 'compute',
    run,
  },
  steer_across: {
    args: z.object({ prompts: z.array(z.string()).min(1) }).strict(),
    doc: 'Runs the same steering on other prompts, to see if the effect holds.',
    effect: 'compute',
    run,
  },
  run_circuit: {
    args: z.object({ threshold: z.number().optional() }).strict(),
    doc: 'Builds the Key parts map.',
    effect: 'compute',
    run,
  },
  show_embedding: {
    args: z.object({ a: embeddingSide, b: embeddingSide, split: z.boolean().optional() }).strict(),
    doc: 'Prepares the embedding reader: two token positions side by side.',
    effect: 'compute',
    run,
  },
  switch_model,
  open_link: {
    args: z.object({ url: z.url() }).strict(),
    doc: 'Opens a link in the browser, always through the dispatcher.',
    effect: 'external',
    scope: (args: { url: string }) => new URL(args.url).host,
    run,
  },
};
