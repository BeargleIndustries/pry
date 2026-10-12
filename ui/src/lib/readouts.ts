// Plain-language readouts (T21): one or two short sentences per panel that say
// what the chart shows, for people who have never seen these charts before.
//
// Honesty rules:
// - DLA is "direct" attribution: it leaves out indirect effects (one part
//   feeding another) and LayerNorm effects, so the parts never "add up to" the
//   score. Never use "add up", "sum" or "total" in DLA wording.
// - Attention shows where a word looks, not what the model uses. Say "looks
//   at", never "uses" or "because of".
import type {
  DLAComponent,
  DLAResponse,
  FeatureHit,
  GenerateResponse,
  LogitLensResponse,
  TokenFeatures,
  TopPrediction,
} from './types';
import { isNamedFeature } from './feature-label';

/**
 * A token in quotes, shown the way the panels show it: a leading space becomes
 * a middle dot, so " Paris" reads as "·Paris".
 */
export function quoteToken(text: string): string {
  const shown = text.startsWith(' ') ? '·' + text.slice(1) : text;
  return `"${shown.replace(/\n/g, '\\n')}"`;
}

/** A probability (0–1) as a rounded percentage; never rounds a nonzero value to 0% or a non-certain one to 100%. */
export function pct(p: number): string {
  const r = Math.round(p * 100);
  if (r === 0 && p > 0) return '<1%';
  if (r === 100 && p < 1) return '>99%';
  return `${r}%`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export function predictionsReadout(predictions: TopPrediction[] | undefined | null): string | null {
  if (!predictions || predictions.length === 0) return null;
  const sorted = [...predictions].sort((a, b) => a.rank - b.rank);
  const [top, next] = sorted;
  let text = `The model's top guess for the next word is ${quoteToken(top.token)} (${pct(top.probability)}).`;
  if (next) text += ` Next most likely: ${quoteToken(next.token)} (${pct(next.probability)}).`;
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

  const first = column.findIndex((c) => c?.matches_final);
  if (first < 0) return `The model's final answer is ${answer}.`;

  // First layer from which the answer stays on top all the way to the end.
  let settled = lastLayer;
  while (settled > 0 && column[settled - 1]?.matches_final) settled--;

  let text: string;
  if (first === lastLayer) {
    text = `The final answer, ${answer}, only becomes the top guess at the last layer (layer ${lastLayer}).`;
  } else if (first === 0) {
    text = `The final answer, ${answer}, is already the top guess at layer 0, the very first layer.`;
  } else {
    text = `The final answer, ${answer}, first becomes the top guess at layer ${first} (layers run 0 to ${lastLayer}).`;
  }

  if (settled !== first) {
    text += ` It drops back out, then stays on top from layer ${settled} onward.`;
  } else if (first !== lastLayer) {
    text += ' ' + chanceTrend(column, first, lastLayer);
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
  return c.type === 'mlp' ? `the MLP in layer ${c.layer}` : `head ${c.head} in layer ${c.layer}`;
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
  if (focusPos === 0) return `The first word, ${word}, can only look at itself.`;

  const ranked = row
    .map((weight, k) => ({ weight, k }))
    .filter((e) => e.k <= focusPos)
    .sort((a, b) => b.weight - a.weight);
  const name = (k: number) => (k === focusPos ? 'itself' : quoteToken(tokens[k]?.text ?? ''));
  const [top, next] = ranked;
  let text = `${where} looks mostly at ${name(top.k)} (${pct(top.weight)} of its attention).`;
  if (top.k === 0 && isStartMarker(tokens[0]?.text ?? '')) {
    text += ' That is the start-of-text marker, where many heads park their attention when nothing else stands out.';
  }
  if (next && next.weight >= 0.1) text += ` Next: ${name(next.k)} (${pct(next.weight)}).`;
  return text;
}

/** Special tokens like `<|endoftext|>` that models use as a start marker. */
export function isStartMarker(text: string): boolean {
  return /^<\|.*\|>$/.test(text);
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
  if (received.length === 0) return `No later word looks back at ${word}.`;

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
  const hits = [...features.top_k].sort((a, b) => b.activation - a.activation).slice(0, maxShown);
  if (hits.length === 0) return `No features are strongly active on ${word}.`;
  const lead = hits.length === 1 ? 'The strongest feature' : 'The strongest features';
  let text = `${lead} on ${word}: ${joinAnd(hits.map(featurePhrase))}.`;
  if (hits.some((h) => isNamedFeature(h) && h.description?.trim())) {
    text += ' Labels are best guesses from Neuronpedia, not certainties.';
  }
  return text;
}
