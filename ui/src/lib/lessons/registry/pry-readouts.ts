// Pry readouts (plan T2 "Pry readouts"): every name with its argument schema,
// type, unit and doc. T2a ships the names; `read` is a stub until T2b fills it
// in place. Readouts read current state; with `from: <capture>` the runner
// reads the stored result of that capture instead.

import { z } from 'zod';
import { notImplemented, type ReadoutDef } from './contract';
import { PANELS } from './pry-actions';

const layer = z.number().int().min(0);
const head = z.number().int().min(0);
const position = z.number().int().min(0);
const featureId = z.number().int().min(0);
const token = z.object({ token: z.string() }).strict();
const n = z.object({ n: z.number().int().min(1) }).strict();
const compareSide = z.object({ side: z.enum(['a', 'b']) }).strict();
const ablationSide = z.object({ side: z.enum(['original', 'ablated']) }).strict();
const embeddingPart = z.object({ part: z.enum(['embed', 'pos', 'sum']) }).strict();
const steerWhich = z.object({ which: z.enum(['original', 'steered', 'control']) }).strict();

const read = notImplemented as ReadoutDef['read'];

export const pryReadouts: Record<string, ReadoutDef> = {
  result: { type: 'record', doc: 'The current run\'s result: the generic readout every tool maps onto.', read },

  tokens: { type: 'list', doc: 'The prompt\'s tokens, in order.', read },
  token_count: { type: 'number', unit: 'count', doc: 'How many tokens the prompt became.', read },
  word_tokens: {
    args: z.object({ word: z.string() }).strict(),
    type: 'number',
    unit: 'count',
    doc: 'How many strip entries one word became.',
    read,
  },

  'focus.token': { type: 'string', doc: 'The selected token.', read },
  'focus.position': { type: 'number', doc: 'The selected token\'s position, where the start marker is 0.', read },
  'focus.word_number': { type: 'number', doc: 'The number Pry\'s panels show for the selected token, as in "word 6".', read },

  'top_guess.token': { type: 'string', doc: 'The top prediction.', read },
  'top_guess.prob': { type: 'number', unit: 'probability', doc: 'The top prediction\'s probability.', read },
  'top_guess.logit': { type: 'number', unit: 'logit', doc: 'The top prediction\'s logit.', read },
  prediction: { args: token, type: 'record', doc: 'One token\'s probability, logit and rank.', read },
  top_k: { type: 'list', doc: 'The top predictions, each with its token, probability and logit.', read },
  rest_mass: { type: 'number', unit: 'probability', doc: 'The probability left over for every token outside the top list.', read },
  shape: { type: 'string', doc: 'How the probability is spread: most, few or spread.', read },

  'write_it.text': { type: 'string', doc: 'The text Watch it write produced.', read },
  'write_it.tokens': { type: 'list', doc: 'The tokens Watch it write produced.', read },

  'compare.delta': { args: token, type: 'number', unit: 'probability', doc: 'How much one token\'s probability changed between the two Compare prompts.', read },
  'compare.tokens': { args: compareSide, type: 'list', doc: 'One Compare side\'s tokens.', read },
  'compare.token_count': { args: compareSide, type: 'number', unit: 'count', doc: 'How many tokens one Compare side became.', read },
  'compare.top': { args: compareSide, type: 'record', doc: 'One Compare side\'s top prediction.', read },
  'compare.word_diff_count': { type: 'number', unit: 'count', doc: 'How many words differ between the two Compare prompts.', read },

  'embedding.matches': { args: embeddingPart, type: 'number', unit: 'count', doc: 'How many of the 768 numbers match between the two positions.', read },
  'embedding.cosine': { args: embeddingPart, type: 'number', doc: 'Cosine similarity of the two lists, shown only beside them.', read },

  'attention.weight': {
    args: z.object({ layer, head, from: position, to: position }).strict(),
    type: 'number',
    doc: 'How much one head\'s FROM token attends to a TO token.',
    read,
  },
  'attention.top_source': {
    args: z.object({ layer, head, from: position }).strict(),
    type: 'record',
    doc: 'The token one head looks at most from a FROM token.',
    read,
  },
  'attention.avg_top_source': {
    args: z.object({ from: position }).strict(),
    type: 'record',
    doc: 'The token looked at most from a FROM token, averaged over heads as the default Lines view draws it.',
    read,
  },
  'attention.avg_share': {
    args: z.object({ from: position, to: position }).strict(),
    type: 'number',
    doc: 'The share of attention from one token to another, averaged over heads.',
    read,
  },
  lines_head: { type: 'record', doc: 'The layer and head the Lines view shows now.', read },

  'head_scores.top': { args: n, type: 'list', doc: 'The top induction head scores.', read },

  'lens.first_top_layer': { args: token, type: 'number', unit: 'layer', doc: 'The first layer where the token is the logit lens top guess.', read },
  'lens.peak_layer': { args: token, type: 'number', unit: 'layer', doc: 'The layer where the token\'s logit lens probability peaks.', read },
  'lens.peak_prob': { args: token, type: 'number', unit: 'probability', doc: 'The token\'s highest logit lens probability.', read },
  'lens.final_prob': { args: token, type: 'number', unit: 'probability', doc: 'The token\'s probability at the last layer.', read },

  'dla.bars_total': { type: 'number', unit: 'logit', doc: 'The sum of the DLA bars.', read },
  'dla.answer_logit': { type: 'number', unit: 'logit', doc: 'The answer token\'s real logit.', read },
  'dla.contrast_logit': { type: 'number', unit: 'logit', doc: 'The contrast token\'s real logit.', read },
  'dla.actual': { type: 'number', unit: 'logit', doc: 'The real logit, or with a contrast, the difference between the two logits.', read },
  'dla.gap': { type: 'number', unit: 'logit', doc: 'The gap between the bars\' total and the real logit.', read },
  'dla.top_parts': { args: n, type: 'list', doc: 'The parts with the biggest DLA bars.', read },
  'dla.target': { type: 'record', doc: 'The DLA answer and contrast tokens.', read },

  'features.top': { args: n, type: 'list', doc: 'The top features, ids and labels. Labels stay hidden while feature-labels is hidden.', read },
  'features.has': {
    args: z.union([z.object({ label: z.string() }).strict(), z.object({ id: featureId }).strict()]),
    type: 'boolean',
    doc: 'Whether a feature with this label or id is in the list.',
    read,
  },
  'features.activation': { args: z.object({ id: featureId }).strict(), type: 'number', unit: 'activation', doc: 'A feature\'s activation at the focused token.', read },
  'features.label': { args: z.object({ id: featureId }).strict(), type: 'string', doc: 'A feature\'s label.', read },
  'features.has_snippets': { args: z.object({ id: featureId }).strict(), type: 'boolean', doc: 'Whether a feature\'s Neuronpedia snippets have loaded.', read },

  'ablation.heads': { type: 'list', doc: 'The heads knocked out, each with its layer and head.', read },
  'ablation.head_count': { type: 'number', unit: 'count', doc: 'How many heads are knocked out.', read },
  'ablation.top_guess.token': { type: 'string', doc: 'The top prediction with the heads knocked out.', read },
  'ablation.delta': { args: token, type: 'number', unit: 'probability', doc: 'How much one token\'s probability changed with the heads knocked out.', read },
  'ablation.top5': { args: ablationSide, type: 'list', doc: 'The top 5 predictions, original or ablated.', read },

  'patch.cell': { args: z.object({ layer, position }).strict(), type: 'record', doc: 'One Swap test cell: clean, corrupted and patched logits, and the share.', read },
  'patch.peak': { args: z.object({ type: z.enum(['head', 'mlp', 'resid']) }).strict(), type: 'record', doc: 'The Swap test cell with the biggest share.', read },

  'feature_ablation.delta': { args: token, type: 'number', unit: 'probability', doc: 'How much one token\'s probability changed with the features knocked out.', read },
  'feature_ablation.top5': { args: ablationSide, type: 'list', doc: 'The top 5 predictions, original or ablated.', read },

  'steer.text': { args: steerWhich, type: 'string', doc: 'The original, steered or control text.', read },
  'steer.changed_tokens': { type: 'number', unit: 'count', doc: 'How many tokens steering changed.', read },
  'steer.coherence': { args: steerWhich, type: 'number', unit: 'nats', doc: 'The coherence measure for the original, steered or control text, in nats.', read },
  'steer.control_top_changed': { type: 'boolean', doc: 'Whether the control feature changed the top prediction.', read },
  'steer.persist': { args: z.object({ measure: z.string() }).strict(), type: 'number', doc: 'One measure of whether steering held across other prompts.', read },
  'steer.scale': { type: 'record', doc: 'Steering strength beside the feature\'s activation on this prompt: p50, p99 and max.', read },

  'circuit.nodes': { type: 'list', doc: 'The parts in the Key parts map.', read },
  'circuit.target': { type: 'record', doc: 'The token the Key parts map explains.', read },

  readout: { args: z.object({ panel: z.enum(PANELS) }).strict(), type: 'prose', doc: 'A panel\'s readout sentence. For hints only, never checked.', read },
};
