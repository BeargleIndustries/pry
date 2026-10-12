// Plain-language readouts (T21): one or two short sentences per panel that say
// what the chart shows, for people who have never seen these charts before.
//
// Honesty rules:
// - DLA is "direct" attribution: it leaves out indirect effects (one part
//   feeding another) and LayerNorm effects, so the parts never "add up to" the
//   score. Never use "add up", "sum" or "total" in DLA wording.
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
  TokenFeatures,
  TopPrediction,
} from './types';
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
 * brings the original answer back the most. The numbers are a raw change in
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
    return `No single part brings ${answer} back. Copying any one of them over from the original prompt doesn't raise its score.${quietText}${same}`;
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

/** How many of the words the model wrote changed when the feature was steered. */
export function steeringReadout(response: SteerResponse | null): string | null {
  if (!response) return null;
  const diff = diffTokens(response.original_generation, response.steered_generation);
  const words = diff.right.filter((t) => /\S/.test(t.text));
  const feature = `feature #${response.feature_id}`;
  const strength = `strength ${response.alpha}`;
  if (words.length === 0) return `Steering ${feature} at ${strength} didn't write anything. Press Run Steered again.`;
  const changed = words.filter((t) => t.changed).length;
  if (changed === 0) {
    const which = words.length === 1 ? 'the one word' : `any of the ${words.length} words`;
    return `Steering ${feature} at ${strength} didn't change ${which} it wrote. Try a bigger strength.`;
  }
  const of = changed === words.length ? `all ${words.length}` : `${changed} of the ${words.length}`;
  return `Steering ${feature} at ${strength} changed ${of} words it wrote.`;
}
