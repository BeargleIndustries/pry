// Pry readouts (plan T2 "Pry readouts"): every name with its argument schema,
// type, unit and doc, and (T2b) its real `read`.
//
// Readouts read current state. With `from: <capture>` they read a capture
// instead: a capture is the value of the generic `result` readout taken when
// the do step ran (a plain copy of everything below), and the runner passes it
// back as `args.from_capture` (not `from`, which attention readouts use for a
// token position). Every read returns undefined while its data isn't there.

import { z } from 'zod';
import type { ReadoutDef } from './contract';
import { PANELS } from './pry-actions';
import { hasPryHost, plain, pryHost, pryUi, type HeadPick } from './pry-state.svelte';
import { aggregateHead, type Aggregation } from '../../attention-agg';
import {
  attentionReadout,
  circuitReadout,
  dlaReadout,
  featuresReadout,
  logitLensReadout,
  patchingReadout,
  predictionsReadout,
  steeringReadout,
} from '../../readouts';
import type {
  AblateResponse,
  CircuitResponse,
  DLAResponse,
  GenerateResponse,
  HeadScoresResponse,
  LogitLensResponse,
  PatchComponent,
  PatchResponse,
  SteerResponse,
  TopPrediction,
} from '../../types';

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

// ---------------------------------------------------------------------------
// The source every readout reads (live, or a capture)
// ---------------------------------------------------------------------------

export interface PrySource {
  response: GenerateResponse | null;
  focusTokenIndex: number | undefined;
  logitLens: LogitLensResponse | null;
  dla: DLAResponse | null;
  headScores: HeadScoresResponse | null;
  headAblations: HeadPick[];
  headAblate: AblateResponse | null;
  featureAblations: { feature_index: number; layer: number }[];
  featureAblate: AblateResponse | null;
  patch: PatchResponse | null;
  patchByType: Partial<Record<string, PatchResponse>>;
  patchCell: PatchComponent | null;
  circuit: CircuitResponse | null;
  steer: SteerResponse | null;
  steerAcross: { prompt: string; response: SteerResponse }[];
  compare: { a: GenerateResponse | null; b: GenerateResponse | null };
  writeIt: GenerateResponse | null;
  embedding: typeof pryUi.embedding;
  linesPick: HeadPick | null;
  aggregation: Aggregation;
  focusMode: 'from' | 'to';
  hidden: Record<string, boolean>;
}

/** Everything the readouts read, from the app as it is now. */
export function liveSource(): PrySource {
  const h = pryHost();
  const s = h.analysis.state;
  return {
    response: s.response,
    focusTokenIndex: s.focusTokenIndex,
    logitLens: s.logitLensResponse,
    dla: s.dlaResponse,
    // Only while the copying-heads view shows them (the scores stay cached per model).
    headScores: s.headScoresMode ? s.headScoresResponse : null,
    headAblations: s.headAblations,
    headAblate: s.headAblateResponse,
    featureAblations: s.featureAblations,
    featureAblate: s.featureAblateResponse,
    patch: s.patchResponse,
    patchByType: pryUi.patching.byType,
    patchCell: pryUi.patching.selectedComponent,
    circuit: s.circuitResponse,
    steer: s.steerResponse,
    steerAcross: pryUi.steerAcross,
    compare: { a: h.compare.state.a, b: h.compare.state.b },
    writeIt: pryUi.writeIt.result,
    embedding: pryUi.embedding,
    linesPick: pryUi.attention.linesPick,
    aggregation: h.getAggregation(),
    focusMode: pryUi.attention.focusMode,
    hidden: pryUi.hidden,
  };
}

type Reader = (src: PrySource, args: any) => unknown;

/** Wraps a reader: picks the capture or the live state, and turns a missing value or host into undefined. */
function reader(fn: Reader): ReadoutDef['read'] {
  return (args?: any) => {
    const { from_capture: cap, ...rest } = (args ?? {}) as { from_capture?: PrySource };
    if (!cap && !hasPryHost()) return undefined;
    try {
      const v = fn(cap ?? liveSource(), rest);
      return v === null || Number.isNaN(v) ? undefined : v;
    } catch {
      return undefined;
    }
  };
}

const preds = (r: GenerateResponse | null | undefined): TopPrediction[] =>
  [...(r?.top_predictions ?? [])].sort((a, b) => a.rank - b.rank);

const record = (p: TopPrediction | undefined) =>
  p ? { prob: p.probability, logit: p.logit ?? undefined, rank: p.rank } : undefined;

const focusTok = (src: PrySource) => src.response?.tokens.find((t) => t.index === src.focusTokenIndex);

/** How many strip entries `word` became: the shortest run of tokens that spells it (leading space optional). */
export function wordTokenCount(tokens: string[], word: string): number | undefined {
  const want = [word, ` ${word.trimStart()}`, word.trimStart()];
  for (let i = 0; i < tokens.length; i++) {
    let acc = '';
    for (let j = i; j < tokens.length; j++) {
      acc += tokens[j];
      if (want.includes(acc)) return j - i + 1;
      if (!want.some((w) => w.startsWith(acc))) break;
    }
  }
  return undefined;
}

/** The MF-1 shape rule: top-1 over 0.5 → most; else top-10 over 0.5 → few; else spread. */
export function shapeOf(p: TopPrediction[]): 'most' | 'few' | 'spread' | undefined {
  if (p.length === 0) return undefined;
  if (p[0].probability > 0.5) return 'most';
  const top10 = p.slice(0, 10).reduce((sum, x) => sum + x.probability, 0);
  return top10 > 0.5 ? 'few' : 'spread';
}

function vector(side: { response: { positions: { embed: number[]; pos_embed: number[] | null }[] } }, part: string): number[] | undefined {
  const p = side.response.positions[0];
  if (!p) return undefined;
  if (part === 'embed') return p.embed;
  if (!p.pos_embed) return undefined;
  if (part === 'pos') return p.pos_embed;
  return p.embed.map((v, i) => v + (p.pos_embed as number[])[i]);
}

/** How many numbers are exactly equal between two lists of the same length. */
export function matchCount(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) m++;
  return m;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const matrix = (src: PrySource, l: number, h: number) => src.response?.attention[l]?.heads?.[h];

function allHeadRows(src: PrySource, from: number): number[][] {
  const rows: number[][] = [];
  for (const L of src.response?.attention ?? []) for (const m of L.heads) if (m[from]) rows.push(m[from]);
  return rows;
}

function avgRow(src: PrySource, from: number): number[] | undefined {
  const rows = allHeadRows(src, from);
  if (rows.length === 0) return undefined;
  return rows[0].map((_, j) => rows.reduce((s, r) => s + (r[j] ?? 0), 0) / rows.length);
}

function argmax(row: number[]): number {
  let best = 0;
  for (let j = 1; j < row.length; j++) if (row[j] > row[best]) best = j;
  return best;
}

/** The head the Lines view shows: the learner's pick if it fits, else the brightest Expert cell. */
export function linesHeadOf(src: PrySource): HeadPick | undefined {
  const att = src.response?.attention ?? [];
  const nL = att.length;
  const nH = att[0]?.heads?.length ?? 0;
  if (nL === 0 || nH === 0) return undefined;
  const pick = src.linesPick;
  if (pick && pick.layer < nL && pick.head < nH) return { layer: pick.layer, head: pick.head };
  const tokens = src.response!.tokens;
  const fi = Math.max(0, tokens.findIndex((t) => t.index === (src.focusTokenIndex ?? tokens[tokens.length - 1]?.index)));
  let best: HeadPick | undefined;
  let bestV = -Infinity;
  for (let l = 0; l < nL; l++) {
    for (let h = 0; h < nH; h++) {
      const m = att[l]?.heads?.[h];
      const v = m ? aggregateHead(m, fi, src.focusMode, src.aggregation) : null;
      if (v !== null && v > bestV) {
        bestV = v;
        best = { layer: l, head: h };
      }
    }
  }
  return best ?? { layer: 0, head: 0 };
}

const lensPos = (src: PrySource) => {
  const toks = src.logitLens?.tokens ?? [];
  const i = toks.findIndex((t) => t.index === src.focusTokenIndex);
  return i >= 0 ? i : toks.length - 1;
};

/** The token's probability at each layer where it is known: from the grid
 *  when it is the cell's top token, else from `tracked` (last position only,
 *  when the request sent it as a track token). */
function lensLayers(src: PrySource, tok: string): { layer: number; prob: number; top: boolean }[] {
  const lens = src.logitLens;
  const g = lens?.grid ?? [];
  const pos = lensPos(src);
  const last = pos === (lens?.tokens.length ?? 0) - 1;
  return g.flatMap((row, l) => {
    const cell = row[pos];
    if (cell?.predicted_token === tok) return [{ layer: l, prob: cell.probability, top: true }];
    const t = last ? lens?.tracked?.[l]?.[tok] : undefined;
    return t ? [{ layer: l, prob: t.prob, top: t.rank === 1 }] : [];
  });
}

/** share = (patched − corrupted) ÷ (clean − corrupted), unless the sidecar sent it. */
export function shareOf(c: PatchComponent): number | undefined {
  if (c.share != null) return c.share;
  const d = c.clean_logit - c.corrupted_logit;
  return d === 0 ? undefined : (c.patched_logit - c.corrupted_logit) / d;
}

const cellRecord = (c: PatchComponent) => ({
  layer: c.layer,
  position: c.position ?? c.head ?? 0,
  clean: c.clean_logit,
  corrupted: c.corrupted_logit,
  patched: c.patched_logit,
  share: shareOf(c),
});

const ablTop5 = (r: AblateResponse | null, side: 'original' | 'ablated') =>
  (side === 'original' ? r?.original_predictions : r?.ablated_predictions)
    ?.slice(0, 5)
    .map((p) => ({ token: p.token, prob: p.probability }));

/** One token's numbers in a knockout run, original or ablated. Ablate responses carry no logit yet. */
function ablPrediction(r: AblateResponse | null, side: 'original' | 'ablated', tok: string) {
  const p = (side === 'original' ? r?.original_predictions : r?.ablated_predictions)?.find((x) => x.token === tok);
  return p ? { prob: p.probability, logit: (p as { logit?: number | null }).logit ?? undefined, rank: p.rank } : undefined;
}

const ablPredArgs = z.object({ side: z.enum(['original', 'ablated']), token: z.string() }).strict();

const focusFeatures = (src: PrySource) => src.response?.sae_features.find((f) => f.token_index === src.focusTokenIndex);

function featureHit(src: PrySource, id: number) {
  for (const tf of src.response?.sae_features ?? []) {
    const hit = tf.top_k.find((f) => f.id === id);
    if (hit) return hit;
  }
  return undefined;
}

const labelsHidden = (src: PrySource) => src.hidden['feature-labels'] === true;

function persist(src: PrySource, measure: string): number | undefined {
  const runs = src.steerAcross;
  if (runs.length === 0) return undefined;
  const changed = runs.filter((r) => r.response.steered_generation !== r.response.original_generation).length;
  if (measure === 'count') return runs.length;
  if (measure === 'changed') return changed;
  if (measure === 'share') return changed / runs.length;
  return undefined;
}

const sideResp = (src: PrySource, side: 'a' | 'b') => (side === 'a' ? src.compare.a : src.compare.b);

// ---------------------------------------------------------------------------
// The readouts
// ---------------------------------------------------------------------------

export const pryReadouts: Record<string, ReadoutDef> = {
  result: {
    type: 'record',
    doc: 'The current run\'s result: the generic readout every tool maps onto.',
    read: () => (hasPryHost() ? plain(liveSource()) : undefined),
  },

  tokens: { type: 'list', doc: 'The prompt\'s tokens, in order.', read: reader((s) => s.response?.tokens.map((t) => t.text)) },
  token_count: { type: 'number', unit: 'count', doc: 'How many tokens the prompt became.', read: reader((s) => s.response?.tokens.length) },
  word_tokens: {
    args: z.object({ word: z.string() }).strict(),
    type: 'number',
    unit: 'count',
    doc: 'How many strip entries one word became.',
    read: reader((s, a) => (s.response ? wordTokenCount(s.response.tokens.map((t) => t.text), a.word) : undefined)),
  },

  'focus.token': { type: 'string', doc: 'The selected token.', read: reader((s) => focusTok(s)?.text) },
  'focus.position': { type: 'number', doc: 'The selected token\'s position, where the start marker is 0.', read: reader((s) => focusTok(s)?.index) },
  'focus.word_number': {
    type: 'number',
    doc: 'The number Pry\'s panels show for the selected token, as in "word 6".',
    read: reader((s) => {
      const t = focusTok(s);
      return t ? t.index + 1 : undefined;
    }),
  },

  'top_guess.token': { type: 'string', doc: 'The top prediction.', read: reader((s) => preds(s.response)[0]?.token) },
  'top_guess.prob': { type: 'number', unit: 'probability', doc: 'The top prediction\'s probability.', read: reader((s) => preds(s.response)[0]?.probability) },
  'top_guess.logit': { type: 'number', unit: 'logit', doc: 'The top prediction\'s logit.', read: reader((s) => preds(s.response)[0]?.logit ?? undefined) },
  prediction: {
    fields: { prob: 'number', logit: 'number', rank: 'number' },
    args: token,
    type: 'record',
    doc: 'One token\'s probability, logit and rank.',
    read: reader((s, a) => record(preds(s.response).find((p) => p.token === a.token))),
  },
  top_k: {
    type: 'list',
    doc: 'The top predictions, each with its token, probability and logit.',
    read: reader((s) => (s.response ? preds(s.response).map((p) => ({ token: p.token, prob: p.probability, logit: p.logit ?? undefined })) : undefined)),
  },
  rest_mass: {
    type: 'number',
    unit: 'probability',
    doc: 'The probability left over for every token outside the top list.',
    read: reader((s) => {
      const p = preds(s.response);
      return p.length ? Math.max(0, 1 - p.reduce((sum, x) => sum + x.probability, 0)) : undefined;
    }),
  },
  shape: { type: 'string', doc: 'How the probability is spread: most, few or spread.', read: reader((s) => shapeOf(preds(s.response))) },

  'write_it.text': {
    type: 'string',
    doc: 'The text Watch it write produced.',
    read: reader((s) => s.writeIt?.generation ?? s.writeIt?.generation_steps?.map((x) => x.text ?? x.token).join('')),
  },
  'write_it.tokens': { type: 'list', doc: 'The tokens Watch it write produced.', read: reader((s) => s.writeIt?.generation_steps?.map((x) => x.token)) },

  'compare.delta': {
    args: token,
    type: 'number',
    unit: 'probability',
    doc: 'How much one token\'s probability changed between the two Compare prompts.',
    read: reader((s, a) => {
      const pa = preds(s.compare.a).find((p) => p.token === a.token);
      const pb = preds(s.compare.b).find((p) => p.token === a.token);
      return pa && pb ? pb.probability - pa.probability : undefined;
    }),
  },
  'compare.prediction': {
    fields: { prob: 'number', logit: 'number', rank: 'number' },
    args: z.object({ side: z.enum(['a', 'b']), token: z.string() }).strict(),
    type: 'record',
    doc: 'One token\'s probability, logit and rank on one Compare side.',
    read: reader((s, a) => record(preds(sideResp(s, a.side)).find((p) => p.token === a.token))),
  },
  'compare.tokens': { args: compareSide, type: 'list', doc: 'One Compare side\'s tokens.', read: reader((s, a) => sideResp(s, a.side)?.tokens.map((t) => t.text)) },
  'compare.token_count': { args: compareSide, type: 'number', unit: 'count', doc: 'How many tokens one Compare side became.', read: reader((s, a) => sideResp(s, a.side)?.tokens.length) },
  'compare.top': {
    fields: { token: 'string', prob: 'number', logit: 'number' },
    args: compareSide,
    type: 'record',
    doc: 'One Compare side\'s top prediction.',
    read: reader((s, a) => {
      const p = preds(sideResp(s, a.side))[0];
      return p ? { token: p.token, prob: p.probability, logit: p.logit ?? undefined } : undefined;
    }),
  },
  'compare.word_diff_count': {
    type: 'number',
    unit: 'count',
    doc: 'How many words differ between the two Compare prompts.',
    read: reader((s) => {
      if (!s.compare.a || !s.compare.b) return undefined;
      const wa = s.compare.a.prompt.trim().split(/\s+/);
      const wb = s.compare.b.prompt.trim().split(/\s+/);
      let d = 0;
      for (let i = 0; i < Math.max(wa.length, wb.length); i++) if (wa[i] !== wb[i]) d++;
      return d;
    }),
  },

  'embedding.matches': {
    args: embeddingPart,
    type: 'number',
    unit: 'count',
    doc: 'How many of the 768 numbers match between the two positions.',
    read: reader((s, a) => {
      if (!s.embedding) return undefined;
      const va = vector(s.embedding.a, a.part);
      const vb = vector(s.embedding.b, a.part);
      return va && vb ? matchCount(va, vb) : undefined;
    }),
  },
  'embedding.cosine': {
    args: embeddingPart,
    type: 'number',
    doc: 'Cosine similarity of the two lists, shown only beside them.',
    read: reader((s, a) => {
      if (!s.embedding) return undefined;
      const va = vector(s.embedding.a, a.part);
      const vb = vector(s.embedding.b, a.part);
      return va && vb ? cosine(va, vb) : undefined;
    }),
  },

  'attention.weight': {
    args: z.object({ layer, head, from: position, to: position }).strict(),
    type: 'number',
    doc: 'How much one head\'s FROM token attends to a TO token.',
    read: reader((s, a) => matrix(s, a.layer, a.head)?.[a.from]?.[a.to]),
  },
  'attention.top_source': {
    args: z.object({ layer, head, from: position }).strict(),
    type: 'record',
    doc: 'The token one head looks at most from a FROM token.',
    read: reader((s, a) => {
      const row = matrix(s, a.layer, a.head)?.[a.from];
      if (!row) return undefined;
      const j = argmax(row);
      return { position: j, token: s.response?.tokens[j]?.text, weight: row[j] };
    }),
  },
  'attention.avg_top_source': {
    args: z.object({ from: position }).strict(),
    type: 'record',
    doc: 'The token looked at most from a FROM token, averaged over heads as the default Lines view draws it.',
    read: reader((s, a) => {
      const row = avgRow(s, a.from);
      if (!row) return undefined;
      const j = argmax(row);
      return { position: j, token: s.response?.tokens[j]?.text, weight: row[j] };
    }),
  },
  'attention.avg_share': {
    args: z.object({ from: position, to: position }).strict(),
    type: 'number',
    doc: 'The share of attention from one token to another, averaged over heads.',
    read: reader((s, a) => avgRow(s, a.from)?.[a.to]),
  },
  lines_head: { type: 'record', doc: 'The layer and head the Lines view shows now.', read: reader((s) => linesHeadOf(s)) },

  'head_scores.top': {
    args: n,
    type: 'list',
    doc: 'The top induction head scores.',
    read: reader((s, a) =>
      s.headScores
        ? [...s.headScores.scores]
            .sort((x, y) => y.induction - x.induction)
            .slice(0, a.n)
            .map((x) => ({ layer: x.layer, head: x.head, induction: x.induction }))
        : undefined,
    ),
  },

  'lens.first_top_layer': { args: token, type: 'number', unit: 'layer', doc: 'The first layer where the token is the logit lens top guess.', read: reader((s, a) => lensLayers(s, a.token).find((x) => x.top)?.layer) },
  'lens.peak_layer': {
    args: token,
    type: 'number',
    unit: 'layer',
    doc: 'The layer where the token\'s logit lens probability peaks.',
    read: reader((s, a) => lensLayers(s, a.token).reduce<{ layer: number; prob: number } | undefined>((b, x) => (!b || x.prob > b.prob ? x : b), undefined)?.layer),
  },
  'lens.peak_prob': {
    args: token,
    type: 'number',
    unit: 'probability',
    doc: 'The token\'s highest logit lens probability.',
    read: reader((s, a) => {
      const l = lensLayers(s, a.token);
      return l.length ? Math.max(...l.map((x) => x.prob)) : undefined;
    }),
  },
  'lens.final_prob': {
    args: token,
    type: 'number',
    unit: 'probability',
    doc: 'The token\'s probability at the last layer.',
    read: reader((s, a) => {
      const n = s.logitLens?.grid.length ?? 0;
      return lensLayers(s, a.token).find((x) => x.layer === n - 1)?.prob;
    }),
  },

  'dla.bars_total': { type: 'number', unit: 'logit', doc: 'The sum of the DLA bars.', read: reader((s) => s.dla?.bars_total) },
  'dla.answer_logit': { type: 'number', unit: 'logit', doc: 'The answer token\'s real logit.', read: reader((s) => s.dla?.answer_logit) },
  'dla.contrast_logit': { type: 'number', unit: 'logit', doc: 'The contrast token\'s real logit.', read: reader((s) => s.dla?.contrast_logit ?? undefined) },
  'dla.actual': { type: 'number', unit: 'logit', doc: 'The real logit, or with a contrast, the difference between the two logits.', read: reader((s) => s.dla?.actual) },
  'dla.gap': { type: 'number', unit: 'logit', doc: 'The gap between the bars\' total and the real logit.', read: reader((s) => s.dla?.gap) },
  'dla.top_parts': {
    args: n,
    type: 'list',
    doc: 'The parts with the biggest DLA bars.',
    read: reader((s, a) =>
      s.dla
        ? [...s.dla.components]
            .sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution))
            .slice(0, a.n)
            .map((c) => ({ part: c.name, contribution: c.contribution }))
        : undefined,
    ),
  },
  'dla.target': {
    fields: { answer: 'string', contrast: 'string' },
    type: 'record',
    doc: 'The DLA answer and contrast tokens.',
    read: reader((s) => (s.dla ? { answer: s.dla.answer_token ?? s.dla.predicted_token, contrast: s.dla.contrast_token ?? null } : undefined)),
  },
  // Added by the T1 gate after T2b closed (critic M7, M10).
  'dla.parts_above': {
    args: z.object({ threshold: z.number() }).strict(),
    type: 'number',
    unit: 'count',
    doc: 'How many DLA bars push harder than a threshold, in logits (P2.4:53).',
    read: reader((s, a) => (s.dla ? s.dla.components.filter((c) => Math.abs(c.contribution) > a.threshold).length : undefined)),
  },
  'dla.target_token_count': {
    args: z.object({ which: z.enum(['answer', 'contrast']) }).strict(),
    type: 'number',
    unit: 'count',
    doc: 'How many tokens the DLA answer or contrast is. The sidecar refuses anything but one token, so a finished run reads 1 (P2.4:95).',
    read: reader((s, a) => {
      if (!s.dla) return undefined;
      const tok = a.which === 'answer' ? (s.dla.answer_token ?? s.dla.predicted_token) : s.dla.contrast_token;
      return tok ? 1 : undefined;
    }),
  },

  'features.top': {
    args: n,
    type: 'list',
    doc: 'The top features, ids and labels. Labels stay hidden while feature-labels is hidden.',
    read: reader((s, a) => {
      const tf = focusFeatures(s);
      if (!tf) return undefined;
      const hide = labelsHidden(s);
      return [...tf.top_k]
        .sort((x, y) => y.activation - x.activation)
        .slice(0, a.n)
        .map((f) => ({ id: f.id, label: hide ? undefined : (f.description ?? undefined), activation: f.activation }));
    }),
  },
  'features.has': {
    args: z.union([z.object({ label: z.string() }).strict(), z.object({ id: featureId }).strict()]),
    type: 'boolean',
    doc: 'Whether a feature with this label or id is in the list.',
    read: reader((s, a) => {
      const tf = focusFeatures(s);
      if (!tf) return undefined;
      if ('id' in a) return tf.top_k.some((f) => f.id === a.id);
      const want = String(a.label).toLowerCase();
      return tf.top_k.some((f) => (f.description ?? '').toLowerCase().includes(want));
    }),
  },
  'features.activation': {
    args: z.object({ id: featureId }).strict(),
    type: 'number',
    unit: 'activation',
    doc: 'A feature\'s activation at the focused token.',
    read: reader((s, a) => focusFeatures(s)?.top_k.find((f) => f.id === a.id)?.activation),
  },
  'features.label': {
    args: z.object({ id: featureId }).strict(),
    type: 'string',
    doc: 'A feature\'s label.',
    read: reader((s, a) => (labelsHidden(s) ? undefined : (featureHit(s, a.id)?.description ?? undefined))),
  },
  'features.has_snippets': {
    args: z.object({ id: featureId }).strict(),
    type: 'boolean',
    doc: 'Whether a feature\'s Neuronpedia snippets have loaded.',
    read: reader((s, a) => (s.response ? (featureHit(s, a.id)?.top_activating_snippets?.length ?? 0) > 0 : undefined)),
  },

  'ablation.heads': { type: 'list', doc: 'The heads knocked out, each with its layer and head.', read: reader((s) => s.headAblations.map((x) => ({ layer: x.layer, head: x.head }))) },
  'ablation.head_count': { type: 'number', unit: 'count', doc: 'How many heads are knocked out.', read: reader((s) => s.headAblations.length) },
  'ablation.top_guess.token': { type: 'string', doc: 'The top prediction with the heads knocked out.', read: reader((s) => s.headAblate?.ablated_predictions[0]?.token) },
  'ablation.delta': {
    args: token,
    type: 'number',
    unit: 'probability',
    doc: 'How much one token\'s probability changed with the heads knocked out.',
    read: reader((s, a) => s.headAblate?.prediction_delta.find((d) => d.token === a.token)?.delta),
  },
  'ablation.top_delta': {
    type: 'number',
    unit: 'probability',
    doc: 'How much the original top token\'s probability changed with the heads knocked out (knocked out minus original).',
    read: reader((s) => {
      const r = s.headAblate;
      const top = r ? [...r.original_predictions].sort((a, b) => a.rank - b.rank)[0] : undefined;
      if (!r || !top) return undefined;
      const after = r.ablated_predictions.find((p) => p.token === top.token);
      if (after) return after.probability - top.probability;
      return r.prediction_delta.find((d) => d.token === top.token)?.delta;
    }),
  },
  'ablation.prediction': {
    fields: { prob: 'number', logit: 'number', rank: 'number' },
    args: ablPredArgs,
    type: 'record',
    doc: 'One token\'s probability, logit and rank with the heads knocked out, or in the original run.',
    read: reader((s, a) => ablPrediction(s.headAblate, a.side, a.token)),
  },
  'ablation.top5': { args: ablationSide, type: 'list', doc: 'The top 5 predictions, original or ablated.', read: reader((s, a) => ablTop5(s.headAblate, a.side)) },

  'patch.cell': {
    fields: { layer: 'number', position: 'number', head: 'number', clean: 'number', corrupted: 'number', patched: 'number', share: 'number' },
    args: z.object({ layer, position }).strict(),
    type: 'record',
    doc: 'One Swap test cell: clean, corrupted and patched logits, and the share.',
    read: reader((s, a) => {
      const c = s.patch?.components.find((x) => x.layer === a.layer && (x.position ?? x.head ?? 0) === a.position);
      return c ? cellRecord(c) : undefined;
    }),
  },
  'patch.focused': {
    fields: { layer: 'number', position: 'number', head: 'number', clean: 'number', corrupted: 'number', patched: 'number', share: 'number' },
    type: 'record',
    doc: 'The Swap test cell selected now: its layer, word position or head, the three logits and the share.',
    read: reader((s) => {
      const c = s.patchCell;
      if (!c) return undefined;
      const where = c.position != null ? { position: c.position } : c.head != null ? { head: c.head } : {};
      return { layer: c.layer, ...where, clean: c.clean_logit, corrupted: c.corrupted_logit, patched: c.patched_logit, share: shareOf(c) };
    }),
  },
  // Added by the T1 gate after T2b closed (critic M11, P3.6:78). The sidecar refuses prompts of
  // different lengths, so a finished run's corrupted count equals its clean count.
  'patch.token_count': {
    args: z.object({ side: z.enum(['clean', 'corrupted']) }).strict(),
    type: 'number',
    unit: 'count',
    doc: 'How many tokens the Swap test\'s Original (clean) or Changed (corrupted) prompt became.',
    read: reader((s) => s.patch?.tokens?.length),
  },
  'patch.peak': {
    fields: { layer: 'number', position: 'number', head: 'number', clean: 'number', corrupted: 'number', patched: 'number', share: 'number' },
    args: z.object({ type: z.enum(['head', 'mlp', 'resid']) }).strict(),
    type: 'record',
    doc: 'The Swap test cell with the biggest share: {layer, head} for heads, {layer} for MLPs, {layer, position} for the residual stream, with its three logits and share.',
    read: reader((s, a) => {
      const r = s.patch?.patch_type === a.type ? s.patch : s.patchByType[a.type];
      let best: PatchComponent | undefined;
      let bestShare: number | undefined;
      for (const c of r?.components ?? []) {
        const share = shareOf(c);
        if (share !== undefined && (bestShare === undefined || share > bestShare)) {
          best = c;
          bestShare = share;
        }
      }
      if (!best) return undefined;
      // Match patch.cell / patch.focused: a head is a head, never a word position.
      const where = a.type === 'head' ? { head: best.head ?? 0 } : a.type === 'resid' ? { position: best.position ?? 0 } : {};
      return { layer: best.layer, ...where, clean: best.clean_logit, corrupted: best.corrupted_logit, patched: best.patched_logit, share: bestShare };
    }),
  },

  'feature_ablation.count': {
    type: 'number',
    unit: 'count',
    doc: 'How many features are knocked out.',
    read: reader((s) => s.featureAblations.length),
  },
  'feature_ablation.delta': {
    args: token,
    type: 'number',
    unit: 'probability',
    doc: 'How much one token\'s probability changed with the features knocked out.',
    read: reader((s, a) => s.featureAblate?.prediction_delta.find((d) => d.token === a.token)?.delta),
  },
  'feature_ablation.prediction': {
    fields: { prob: 'number', logit: 'number', rank: 'number' },
    args: ablPredArgs,
    type: 'record',
    doc: 'One token\'s probability, logit and rank with the features knocked out, or in the original run.',
    read: reader((s, a) => ablPrediction(s.featureAblate, a.side, a.token)),
  },
  'feature_ablation.top5': { args: ablationSide, type: 'list', doc: 'The top 5 predictions, original or ablated.', read: reader((s, a) => ablTop5(s.featureAblate, a.side)) },

  'steer.text': {
    args: steerWhich,
    type: 'string',
    doc: 'The original, steered or control text.',
    read: reader((s, a) =>
      a.which === 'original' ? s.steer?.original_generation : a.which === 'steered' ? s.steer?.steered_generation : s.steer?.control?.generation,
    ),
  },
  'steer.changed_tokens': { type: 'number', unit: 'count', doc: 'How many tokens steering changed.', read: reader((s) => s.steer?.changed_token_indices?.length) },
  'steer.coherence': {
    args: steerWhich,
    type: 'number',
    unit: 'nats',
    doc: 'The coherence measure for the original, steered or control text, in nats.',
    read: reader((s, a) =>
      a.which === 'original' ? s.steer?.coherence?.original : a.which === 'steered' ? s.steer?.coherence?.steered : s.steer?.control?.coherence.steered,
    ),
  },
  'steer.control_top_changed': {
    type: 'boolean',
    doc: 'Whether the control feature changed the top prediction.',
    read: reader((s) => {
      const c = s.steer?.control;
      const o = s.steer?.original_top_predictions[0];
      return c && o ? c.top_predictions[0]?.token !== o.token : undefined;
    }),
  },
  'steer.persist': {
    args: z.object({ measure: z.string() }).strict(),
    type: 'number',
    doc: 'One measure of whether steering held across other prompts.',
    read: reader((s, a) => persist(s, a.measure)),
  },
  'steer.scale': { type: 'record', doc: 'Steering strength beside the feature\'s activation on this prompt: p50, p99 and max.', read: reader((s) => s.steer?.scale ?? undefined) },

  'circuit.nodes': {
    type: 'list',
    doc: 'The parts in the Key parts map.',
    read: reader((s) => s.circuit?.nodes.map((x) => ({ id: x.id, type: x.type, layer: x.layer, head: x.head, importance: x.importance }))),
  },
  'circuit.target': {
    fields: { token: 'string', after: 'string', position: 'number' },
    type: 'record',
    doc: 'The token the Key parts map explains: the top guess after the selected word (`after`, at `position`).',
    // As the panel's header says: "Explains the top guess ' X' after the selected word ' Y'".
    // The guess is Why (DLA)'s answer when it explains the same word, else the run's top guess when
    // the selected word is the last (CircuitPanel's topGuess).
    read: reader((s) => {
      const t = focusTok(s);
      if (!s.circuit || !t) return undefined;
      let guess: string | undefined;
      if (s.dla && s.dla.target_token_index === t.index) guess = s.dla.predicted_token;
      else if (s.response && t.index === s.response.tokens[s.response.tokens.length - 1]?.index) guess = preds(s.response)[0]?.token;
      return guess === undefined ? undefined : { token: guess, after: t.text, position: t.index };
    }),
  },

  readout: {
    args: z.object({ panel: z.enum(PANELS) }).strict(),
    type: 'prose',
    doc: 'A panel\'s readout sentence. For hints only, never checked.',
    read: reader((s, a) => {
      const pos = Math.max(0, s.response?.tokens.findIndex((t) => t.index === s.focusTokenIndex) ?? 0);
      switch (a.panel) {
        case 'predictions':
          return predictionsReadout(s.response?.top_predictions, focusTok(s)?.text);
        case 'attention':
          return attentionReadout(s.response, pos, linesHeadOf(s) ?? null, s.focusMode);
        case 'logit-lens':
          return logitLensReadout(s.logitLens);
        case 'dla':
          return dlaReadout(s.dla);
        case 'patching':
          return patchingReadout(s.patch);
        case 'circuit':
          return circuitReadout(s.circuit);
        case 'steering':
          return steeringReadout(s.steer);
        case 'features':
          return featuresReadout(focusFeatures(s) ?? null, focusTok(s)?.text ?? null);
        default:
          return undefined;
      }
    }),
  },
};
