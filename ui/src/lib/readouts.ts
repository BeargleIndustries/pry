// Plain-language readouts (T21): one or two short sentences per panel that say
// what the chart shows, for people who have never seen these charts before.
//
// Honesty rules:
// - DLA is "direct" attribution: the bars leave out the embedding's own direct
//   push and the biases. Show the bars' total, the real logit and the gap side
//   by side (dlaTotalLine), labelled, so the learner sees what the bars miss.
// - Attention shows where a word looks, not what the model uses. Say "looks
//   at", never "uses" or "because of".
// - Key parts lines are the direct value path only: say they show one kind of
//   link.
import type {
  CircuitResponse,
  DLAComponent,
  DLAResponse,
  FeatureHit,
  GenerateResponse,
  LogitLensResponse,
  PatchComponent,
  PatchResponse,
  SteerResponse,
  SteerCoherence,
  SteerControl,
  TokenFeatures,
  TopPrediction,
} from './types';
import { formatProbability } from './lessons/slots';
import { isNamedFeature } from './feature-label';
import { signedNumber } from './signed-color';
import { diffTokens } from './token-diff';

/** A token shown the way the panels show it: a leading space becomes a middle dot. */
function showToken(text: string): string {
  const shown = text.startsWith(' ') ? '·' + text.slice(1) : text;
  return shown.replace(/\n/g, '\\n');
}

/**
 * A token in quotes, shown the way the panels show it: a leading space becomes
 * a middle dot, so " Paris" reads as "·Paris".
 */
export function quoteToken(text: string): string {
  return `"${showToken(text)}"`;
}

/** A probability (0–1) as a rounded percentage; never rounds a nonzero value to 0% or a non-certain one to 100%. */
export function pct(p: number): string {
  const r = Math.round(p * 100);
  if (r === 0 && p > 0) return '<1%';
  if (r === 100 && p < 1) return '>99%';
  return `${r}%`;
}

/** Joins with commas and "and"; a list of 3+ switches to semicolons when an item has its own comma ("layer 9, head 9"). */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items[items.length - 1];
  if (items.some((i) => i.includes(','))) return `${items.slice(0, -1).join('; ')}; and ${last}`;
  return `${items.slice(0, -1).join(', ')} and ${last}`;
}

/** Special tokens like `<|endoftext|>` that models use as a start marker. */
export function isStartMarker(text: string): boolean {
  return /^<\|.*\|>$/.test(text);
}

/**
 * The label above Why (DLA) and Key parts: which word's next-word guess the
 * panel explains. `index` is the token index; words are counted from 1, like
 * the word chips.
 */
export function explainingLabel(target: { text: string; index: number } | null | undefined): string {
  if (!target) return 'Explaining the guess after the last word';
  return `Explaining the guess after ${showToken(target.text)} (word ${target.index + 1})`;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/**
 * A guess that starts with a letter only continues a word when the text so
 * far ends in a word piece with no trailing space (not a space, newline, quote
 * or start marker).
 */
function continuesWord(prevToken: string | null | undefined): boolean {
  if (!prevToken || isStartMarker(prevToken)) return false;
  return /[A-Za-z0-9]$/.test(prevToken);
}

/** A next-word guess in plain words: special tokens and word pieces are named for what they are. */
function guessPhrase(token: string, prevToken: string | null | undefined): string {
  if (isStartMarker(token)) return 'the end of the text';
  if (/^\n+$/.test(token)) return 'a line break';
  if (/^[A-Za-z]/.test(token) && continuesWord(prevToken)) {
    return `the word piece ${quoteToken(token)} (part of a longer word)`;
  }
  return quoteToken(token);
}

/** `prevToken` is the prompt's last token, used to tell a word piece from a new word. */
export function predictionsReadout(
  predictions: TopPrediction[] | undefined | null,
  prevToken?: string | null,
): string | null {
  if (!predictions || predictions.length === 0) return null;
  const sorted = [...predictions].sort((a, b) => a.rank - b.rank);
  const [top, next] = sorted;
  const what = /^[ A-Za-z]/.test(top.token) && !isStartMarker(top.token) ? 'the next word' : 'what comes next';
  if (next && next.probability > 0 && pct(next.probability) === pct(top.probability)) {
    return `The model's top guess for ${what} is a near tie between ${guessPhrase(top.token, prevToken)} and ${guessPhrase(next.token, prevToken)} (${pct(top.probability)} each).`;
  }
  let text = `The model's top guess for ${what} is ${guessPhrase(top.token, prevToken)} (${pct(top.probability)}).`;
  if (next && next.probability > 0) text += ` Next most likely: ${guessPhrase(next.token, prevToken)} (${pct(next.probability)}).`;
  return text;
}

// ---------------------------------------------------------------------------
// Logit Lens
// ---------------------------------------------------------------------------

/** Reads the last word's column: at which layer the final answer first becomes the top guess. */
export function logitLensReadout(response: LogitLensResponse | null): string | null {
  if (!response || response.n_layers === 0 || response.tokens.length === 0) return null;
  const nLayers = response.n_layers;
  const pos = response.tokens.length - 1;
  const column = response.grid.map((row) => row[pos]);
  const finalCell = column[nLayers - 1];
  if (!finalCell) return null;
  const answer = quoteToken(finalCell.predicted_token);
  const lastLayer = nLayers - 1;
  const lastWord = quoteToken(response.tokens[pos]?.text ?? '');
  const lead = response.tokens.length === 1 ? `For the only word, ${lastWord}: ` : `For the last word, ${lastWord}: `;

  const first = column.findIndex((c) => c?.matches_final);
  if (first < 0) return `${lead}the model's final answer is ${answer}.`;

  // First layer from which the answer stays on top all the way to the end.
  let settled = lastLayer;
  while (settled > 0 && column[settled - 1]?.matches_final) settled--;

  let text: string;
  if (first === lastLayer) {
    text = `${lead}the final answer, ${answer}, only becomes the top guess at the last layer (layer ${lastLayer}).`;
  } else if (first === 0) {
    text = `${lead}the final answer, ${answer}, is already the top guess at layer 0, the very first layer.`;
  } else {
    text = `${lead}the final answer, ${answer}, first becomes the top guess at layer ${first} (layers run 0 to ${lastLayer}).`;
  }

  if (settled !== first) {
    text += ` It drops back out, then stays on top from layer ${settled} onward.`;
  } else if (first !== lastLayer) {
    text += ' ' + chanceTrend(column, first, lastLayer);
  }
  // The lens is a rough read in early layers (honesty caveat 6).
  if (first !== lastLayer && first < nLayers / 3) {
    text += ' Early layers are a rough read, so that early guess is a hint, not proof.';
  }
  return text;
}

/**
 * How the answer's chance moves from the layer it first tops to the last layer.
 * The path is not always a climb: it can peak mid-stack and fall back, and the
 * two ends can round to the same percentage.
 */
function chanceTrend(column: LogitLensResponse['grid'][number], first: number, lastLayer: number): string {
  const start = column[first].probability;
  const end = column[lastLayer].probability;
  const rounded = (p: number) => Math.round(p * 100);

  let peakLayer = first;
  for (let l = first + 1; l < lastLayer; l++) {
    if (column[l].probability > column[peakLayer].probability) peakLayer = l;
  }
  const peak = column[peakLayer].probability;
  if (peakLayer !== first && rounded(peak) > Math.max(rounded(start), rounded(end))) {
    return `Its chance peaks at ${pct(peak)} at layer ${peakLayer}, then ends at ${pct(end)} at the last layer.`;
  }
  if (rounded(start) === rounded(end)) {
    return `Its chance is about ${pct(end)} there and at the last layer.`;
  }
  return end > start
    ? `Its chance grows from ${pct(start)} there to ${pct(end)} at the last layer.`
    : `Its chance falls from ${pct(start)} there to ${pct(end)} at the last layer.`;
}

// ---------------------------------------------------------------------------
// Direct Logit Attribution ("Why")
// ---------------------------------------------------------------------------

function componentName(c: DLAComponent): string {
  return c.type === 'mlp' ? `the MLP in layer ${c.layer}` : `layer ${c.layer}, head ${c.head}`;
}

/** Which parts pushed the chosen word up most, and which pushed it down most. */
export function dlaReadout(response: DLAResponse | null, maxEach = 2): string | null {
  if (!response || response.components.length === 0) return null;
  const word = quoteToken(response.predicted_token);
  const up = response.components
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, maxEach);
  const down = response.components
    .filter((c) => c.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, maxEach);

  if (up.length === 0 && down.length === 0) return `No part pushed ${word} up or down directly.`;
  const upText = up.length
    ? `The parts that pushed ${word} up most directly: ${joinAnd(up.map(componentName))}.`
    : `No part pushed ${word} up directly.`;
  const downText = down.length
    ? `Pushing it down most: ${joinAnd(down.map(componentName))}.`
    : 'No part pushed it down directly.';
  return `${upText} ${downText}`;
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

export interface HeadRef {
  layer: number;
  head: number;
}

/**
 * What the selected word looks at: in one head when `head` is given, otherwise
 * averaged over every head. `focusPos` is the word's array position.
 */
export function attentionReadout(
  response: GenerateResponse | null,
  focusPos: number,
  head: HeadRef | null = null,
  direction: 'from' | 'to' = 'from',
): string | null {
  if (direction === 'to') return attentionToReadout(response, focusPos, head);
  if (!response || response.tokens.length < 2 || response.attention.length === 0) return null;
  const tokens = response.tokens;
  const focusTok = tokens[focusPos];
  if (!focusTok) return null;
  const word = quoteToken(focusTok.text);

  let row: number[] | null = null;
  let where: string;
  if (head) {
    row = response.attention[head.layer]?.heads?.[head.head]?.[focusPos] ?? null;
    where = `In layer ${head.layer}, head ${head.head}, ${word}`;
  } else {
    const sums: number[] = [];
    let nHeads = 0;
    for (const layer of response.attention) {
      for (const matrix of layer.heads) {
        const r = matrix[focusPos];
        if (!r) continue;
        nHeads++;
        r.forEach((v, k) => (sums[k] = (sums[k] ?? 0) + v));
      }
    }
    if (nHeads > 0) row = sums.map((v) => v / nHeads);
    where = `Averaged over all ${nHeads} heads, ${word}`;
  }

  if (!row || row.length === 0) return `There is no attention data for ${word}.`;
  if (focusPos === 0) {
    return isStartMarker(focusTok.text)
      ? 'The start-of-text marker can only look at itself. Pick a word you typed.'
      : `The first word, ${word}, can only look at itself.`;
  }

  const ranked = row
    .map((weight, k) => ({ weight, k }))
    .filter((e) => e.k <= focusPos)
    .sort((a, b) => b.weight - a.weight);
  const name = (k: number) => (k === focusPos ? 'itself' : quoteToken(tokens[k]?.text ?? ''));
  const [top, next] = ranked;
  const tie = next && next.weight > 0 && pct(next.weight) === pct(top.weight);
  let text = tie
    ? `${where} looks equally at ${name(top.k)} and ${name(next.k)} (${pct(top.weight)} each).`
    : `${where} looks mostly at ${name(top.k)} (${pct(top.weight)} of its attention).`;
  if (top.k === 0 && isStartMarker(tokens[0]?.text ?? '')) {
    text += " That's the start-of-text marker, where lots of heads park their attention when nothing else stands out.";
  }
  if (!tie && next && next.weight >= 0.1) text += ` Next: ${name(next.k)} (${pct(next.weight)}).`;
  return text;
}

/** "To" view: which later word looks at the focus word the most. */
function attentionToReadout(
  response: GenerateResponse | null,
  focusPos: number,
  head: HeadRef | null,
): string | null {
  if (!response || response.tokens.length < 2 || response.attention.length === 0) return null;
  const tokens = response.tokens;
  const focusTok = tokens[focusPos];
  if (!focusTok) return null;
  const word = quoteToken(focusTok.text);

  const matrices = head
    ? [response.attention[head.layer]?.heads?.[head.head]].filter((m): m is number[][] => !!m)
    : response.attention.flatMap((layer) => layer.heads);
  if (matrices.length === 0) return `There is no attention data for ${word}.`;

  // Later words only: earlier ones can't look ahead.
  const received: { k: number; weight: number }[] = [];
  for (let k = focusPos + 1; k < tokens.length; k++) {
    let sum = 0;
    let n = 0;
    for (const m of matrices) {
      const v = m[k]?.[focusPos];
      if (v === undefined) continue;
      sum += v;
      n++;
    }
    if (n > 0) received.push({ k, weight: sum / n });
  }
  if (received.length === 0) {
    return focusPos === tokens.length - 1
      ? `${word} is the last word, so nothing comes after it to look back. Pick an earlier word.`
      : `No later word looks back at ${word}.`;
  }

  received.sort((a, b) => b.weight - a.weight);
  const top = received[0];
  const where = head ? `In layer ${head.layer}, head ${head.head}` : `Averaged over all ${matrices.length} heads`;
  return `${where}, the word that looks at ${word} most is ${quoteToken(tokens[top.k]?.text ?? '')} (${pct(top.weight)} of its attention).`;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function featurePhrase(hit: FeatureHit): string {
  const label = hit.description?.trim();
  return isNamedFeature(hit) && label ? `#${hit.id} ("${label}")` : `#${hit.id} (no label yet)`;
}

/** The strongest features on the selected word and their labels. */
export function featuresReadout(
  features: TokenFeatures | null,
  tokenText: string | null,
  maxShown = 3,
): string | null {
  if (!features || tokenText === null) return null;
  const word = quoteToken(tokenText);
  const marker = isStartMarker(tokenText)
    ? ' This is the start-of-text marker; features here are often odd, so pick a word you typed.'
    : '';
  const hits = features.top_k
    .filter((h) => h.activation > 0)
    .sort((a, b) => b.activation - a.activation)
    .slice(0, maxShown);
  if (hits.length === 0) return `No features are strongly active on ${word}.${marker}`;
  const lead = hits.length === 1 ? 'The strongest feature' : 'The strongest features';
  let text = `${lead} on ${word}: ${joinAnd(hits.map(featurePhrase))}.`;
  if (hits.some((h) => isNamedFeature(h) && h.description?.trim())) {
    text += ' Labels are best guesses from Neuronpedia, not certainties.';
  }
  return text + marker;
}

// ---------------------------------------------------------------------------
// Swap test (activation patching)
// ---------------------------------------------------------------------------

function patchPartName(c: PatchComponent, tokens: string[] | undefined): string {
  if (c.position != null) {
    const tok = tokens?.[c.position];
    const at = tok !== undefined ? quoteToken(tok) : `word ${c.position + 1}`;
    return `the information at ${at} going into layer ${c.layer}`;
  }
  return c.head === null ? `the MLP in layer ${c.layer}` : `layer ${c.layer}, head ${c.head}`;
}

/**
 * Which part, copied over from the original prompt into the changed one,
 * raises the original answer's score the most. The numbers are a raw change in
 * the answer's score (logit), not a percentage.
 */
export function patchingReadout(response: PatchResponse | null): string | null {
  if (!response || response.components.length === 0) return null;
  const answer = quoteToken(response.clean_predicted_token);
  const parts = response.components;
  const maxAbs = Math.max(...parts.map((c) => Math.abs(c.effect)));
  const same =
    response.clean_predicted_token === response.corrupted_predicted_token
      ? ` Both prompts already guess ${answer}, so don't expect big changes.`
      : '';
  if (!(maxAbs > 0)) return `None of the swaps changed the score for ${answer}.${same}`;

  const best = parts.reduce((a, b) => (b.effect > a.effect ? b : a));
  const quiet = parts.filter((c) => Math.abs(c.effect) < 0.1 * maxAbs).length;
  const quietText = quiet > 0 ? ` ${quiet} of ${parts.length} parts barely change it.` : '';
  if (best.effect <= 0) {
    return `No single part raises the score for ${answer}. Copying any one of them over from the original prompt doesn't raise it.${quietText}${same}`;
  }
  return (
    `Copying ${patchPartName(best, response.tokens)} over from the original prompt raises the score for ${answer} the most (${signedNumber(best.effect, 2)}).` +
    quietText +
    same
  );
}

// ---------------------------------------------------------------------------
// Key parts (circuit)
// ---------------------------------------------------------------------------

/** How many parts pushed the guess directly, which pushed hardest, and what the lines mean. */
export function circuitReadout(response: CircuitResponse | null): string | null {
  if (!response || response.nodes.length === 0) return null;
  const nodes = response.nodes;
  const biggest = nodes.reduce((a, b) => (Math.abs(b.importance) > Math.abs(a.importance) ? b : a));
  const name = biggest.type === 'mlp' ? `the MLP in layer ${biggest.layer}` : `layer ${biggest.layer}, head ${biggest.head}`;
  const dir = biggest.importance >= 0 ? 'toward' : 'against';
  const count = nodes.length === 1 ? 'One part pushed the guess directly' : `${nodes.length} parts pushed the guess directly`;
  let text = `${count}. The biggest is ${name}, which pushed ${dir} it (${signedNumber(biggest.importance, 2)}).`;
  if (response.edges_method === 'direct_value_path') {
    text += ' Lines show only one kind of link, the direct value path.';
  }
  return text;
}

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

/** Whether steering changed the text the model wrote. No word count: the marked tokens show what changed. */
export function steeringReadout(response: SteerResponse | null): string | null {
  if (!response) return null;
  const feature = `feature #${response.feature_id}`;
  const strength = `strength ${response.alpha}`;
  if (!/\S/.test(response.steered_generation)) return `Steering ${feature} at ${strength} didn't write anything. Press Run Steered again.`;
  const changed = response.changed_token_indices
    ? response.changed_token_indices.length > 0
    : diffTokens(response.original_generation, response.steered_generation).right.some((t) => t.changed);
  if (!changed) return `Steering ${feature} at ${strength} didn't change the text it wrote. Try a bigger strength.`;
  return `Steering ${feature} at ${strength} changed the text it wrote; the changed tokens are marked.`;
}

// ---------------------------------------------------------------------------
// Measurement display rules (plan T4-ui). Wording is pinned in
// readouts.test.ts and predictions-scale.test.ts; changing a rule needs
// Critic or Brad sign-off.
// ---------------------------------------------------------------------------

/** A token in single quotes with its leading space kept, the way the pinned lines write it (' Mary'). */
function spacedToken(text: string): string {
  return `'${text.replace(/\n/g, '\\n')}'`;
}

/** A logit or other raw number at two decimals, with a real minus sign. */
export function num(v: number): string {
  const s = Math.abs(v).toFixed(2);
  return v < 0 && s !== '0.00' ? `−${s}` : s;
}

// --- Predictions (MF-1) ---

/** The bar's width on the 0-100% track: the probability itself, never scaled to the top bar. */
export function barWidthPct(p: number): string {
  return `${Math.max(0, Math.min(1, p)) * 100}%`;
}

/** A probability with its natural frequency: "9.7% (about 1 in 10)". */
export function probabilityWithFrequency(p: number): string {
  return formatProbability(p);
}

function topTen(predictions: TopPrediction[]): TopPrediction[] {
  return [...predictions].sort((a, b) => a.rank - b.rank).slice(0, 10);
}

/** Everything outside the top ten: 1 − the top ten's sum. */
export function everythingElse(predictions: TopPrediction[]): number {
  const sum = topTen(predictions).reduce((acc, p) => acc + p.probability, 0);
  return Math.max(0, 1 - sum);
}

export const SHAPE_ONE = 'One token has most of the probability.';
export const SHAPE_FEW = 'A few tokens share most of the probability.';
export const SHAPE_SPREAD = 'The probability is spread over many tokens; the top ten have half or less.';

/** The shape of the whole distribution, shown before any tag. */
export function predictionShape(predictions: TopPrediction[] | null | undefined): string | null {
  if (!predictions || predictions.length === 0) return null;
  const ten = topTen(predictions);
  if (ten[0].probability > 0.5) return SHAPE_ONE;
  if (ten.reduce((acc, p) => acc + p.probability, 0) > 0.5) return SHAPE_FEW;
  return SHAPE_SPREAD;
}

/** Tags after the shape sentence: `over 50%`, `top three within 5 points`. */
export function predictionTags(predictions: TopPrediction[] | null | undefined): string[] {
  if (!predictions || predictions.length === 0) return [];
  const ten = topTen(predictions);
  const tags: string[] = [];
  if (ten[0].probability > 0.5) tags.push('over 50%');
  if (ten.length >= 3 && ten[0].probability - ten[2].probability < 0.05) tags.push('top three within 5 points');
  return tags;
}

/** What a clicked bar shows: its logit, the raw score softmax turns into the probability. */
export function predictionLogitLine(pred: TopPrediction): string | null {
  if (pred.logit == null) return null;
  return `${quoteToken(pred.token)} has a logit of ${num(pred.logit)}. Softmax turns the logits into the probabilities above.`;
}

// --- Why (DLA), MF-2 / MF-2b ---

export const DLA_GAP_EXPLAINED =
  "the embedding's own direct push plus the attention-output and unembedding biases, not drawn as bars.";

/**
 * "Bars total … Real logit … Gap …": the bars' total, the real logit (both
 * logits and their difference with a contrast) and the gap, labelled.
 */
export function dlaTotalLine(r: DLAResponse | null): string | null {
  if (!r || r.bars_total == null || r.answer_logit == null || r.gap == null) return null;
  const real =
    r.contrast_logit != null && r.actual != null
      ? `Real logits ${num(r.answer_logit)} and ${num(r.contrast_logit)}, difference ${num(r.actual)}`
      : `Real logit ${num(r.answer_logit)}`;
  return `Bars total ${num(r.bars_total)}. ${real}. Gap ${num(r.gap)}: ${DLA_GAP_EXPLAINED}`;
}

const GAP_PART_NAMES: Record<string, string> = {
  embedding_direct: "The embedding's own direct push",
  biases: 'The attention-output and unembedding biases',
};

/** The fold under the total line: each named part of the gap. */
export function dlaGapParts(r: DLAResponse | null): { name: string; value: string }[] {
  if (!r?.gap_parts) return [];
  return Object.entries(r.gap_parts).map(([k, v]) => ({ name: GAP_PART_NAMES[k] ?? k, value: num(v) }));
}

// --- Key parts header ---

/** "Explains the top guess ' X' after the selected word ' Y'"; the older label when the guess isn't known. */
export function keyPartsHeader(
  topGuess: string | null | undefined,
  selected: { text: string; index: number } | null | undefined,
): string {
  if (topGuess == null || !selected) return explainingLabel(selected);
  return `Explains the top guess ${spacedToken(topGuess)} after the selected word ${spacedToken(selected.text)}`;
}

// --- Swap test (MF-3) ---

export const PATCH_EVERY_POSITION = 'Heads and MLPs are swapped at every position.';
export const PATCH_BELOW_ZERO = 'The swap moved the logit away from the Original value.';
export const PATCH_OVERSHOOT = 'The swap overshot the Original value.';
export const PATCH_NULL_SHARE = "Original and Changed give nearly the same logit here, so a share doesn't mean anything.";
export const PATCH_LEGEND_FORMULA =
  'Square color is the share: (after this swap − Changed prompt) ÷ (Original prompt − Changed prompt).';

/** The part whose three logits show before any square is clicked: the biggest raise. */
export function defaultPatchPart(r: PatchResponse | null): PatchComponent | null {
  if (!r || r.components.length === 0) return null;
  return r.components.reduce((a, b) => (b.effect > a.effect ? b : a));
}

/** "' X''s logit: Original prompt …, Changed prompt …, after this swap …." */
export function patchLogitsLine(r: PatchResponse | null, c: PatchComponent | null): string | null {
  if (!r || !c) return null;
  const token = r.target_token ?? r.clean_predicted_token;
  const clean = r.clean_logit ?? c.clean_logit;
  const corrupted = r.corrupted_logit ?? c.corrupted_logit;
  return `${spacedToken(token)}'s logit: Original prompt ${num(clean)}, Changed prompt ${num(corrupted)}, after this swap ${num(c.patched_logit)}.`;
}

/** The share formula with its numbers, or the line that says a share means nothing here. */
export function patchShareLine(r: PatchResponse | null, c: PatchComponent | null): string | null {
  if (!r || !c || c.share === undefined) return null;
  if (c.share === null) return PATCH_NULL_SHARE;
  const clean = r.clean_logit ?? c.clean_logit;
  const corrupted = r.corrupted_logit ?? c.corrupted_logit;
  return `Share = (${num(c.patched_logit)} − ${num(corrupted)}) ÷ (${num(clean)} − ${num(corrupted)}) = ${Math.round(c.share * 100)}%`;
}

/** Below 0% or above 100%: the line that says which way the share left the range. */
export function patchShareEdge(c: PatchComponent | null): string | null {
  if (!c || c.share == null) return null;
  if (c.share < 0) return PATCH_BELOW_ZERO;
  if (c.share > 1) return PATCH_OVERSHOOT;
  return null;
}

// --- Steering (MF-4, N13) ---

export const COHERENCE_SOURCE = 'average log-probability per token of each continuation, under the unsteered model';
export const STEERING_LIMIT =
  'The push is added at every position, prompt included. Repetitive text scores as very natural, so breaking a loop can look like a drop.';

/**
 * Both coherence numbers with their source, no band label (calibration showed
 * the bands don't separate fine from broken steering). null under 5 tokens.
 */
export function coherenceLine(
  c: SteerCoherence | null | undefined,
  labels: [string, string] = ['Original', 'Steered'],
): string | null {
  if (!c || c.original == null || c.steered == null) return null;
  return `Coherence: ${labels[0]} ${num(c.original)}, ${labels[1]} ${num(c.steered)} (${COHERENCE_SOURCE}).`;
}

function trimNum(v: number): string {
  return String(Number(v.toFixed(2)));
}

/** "Steering strength …; this feature's activation on this prompt runs up to … (most positions under …)." */
export function steeringScaleLine(r: SteerResponse | null): string | null {
  const s = r?.scale;
  if (!s) return null;
  return `Steering strength ${trimNum(s.strength)}; this feature's activation on this prompt runs up to ${trimNum(s.activation_max)} (most positions under ${trimNum(s.activation_p99)}).`;
}

/** The control feature's heading: same strength as the steered one. */
export function controlHeading(c: SteerControl, alpha: number): string {
  return `Control: feature #${c.feature_id}, same strength ${alpha}`;
}

export const CONTROL_EXPLAINED =
  "A feature about the same size as yours, pointing a different way, steered at the same strength. If it changes the text just as much, the change might not be about your feature.";

/** "on N of M prompts": how many of the other prompts the steering changed. */
export function steeringPersistLine(runs: { response: SteerResponse }[]): string | null {
  if (runs.length === 0) return null;
  const changed = runs.filter((r) => r.response.steered_generation !== r.response.original_generation).length;
  return `The steering changed the text on ${changed} of ${runs.length} prompts.`;
}

export type SteeringSection = 'changed' | 'coherence' | 'control' | 'scale';

/** The four parts of the steering result in the pinned order; a part with nothing to show is left out. */
export function steeringSections(r: SteerResponse | null): SteeringSection[] {
  if (!r) return [];
  const out: SteeringSection[] = ['changed'];
  if (coherenceLine(r.coherence)) out.push('coherence');
  if (r.control) out.push('control');
  if (r.scale) out.push('scale');
  return out;
}

// --- Feature knockout (C21) ---

export const FEATURE_KNOCKOUT_NOTE =
  "Knocking out a feature removes only the part of the residual stream the SAE accounts for. The SAE's leftover error stays, so a small change can mean the feature mattered little or that its share was small.";
