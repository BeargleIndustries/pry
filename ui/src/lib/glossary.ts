// Plain-language glossary (T30). Each definition is one short sentence or two,
// at most 140 characters (checked in glossary.test.ts), and says only what is
// true for the small models Pry runs. <Term key="..."> looks entries up here,
// by key or by any alias.

export interface GlossaryEntry {
  /** Display name, used when <Term> has no child text. */
  term: string;
  /** At most 140 characters. */
  definition: string;
  /** Other words a newcomer might meet for the same idea (matched case-insensitively). */
  aliases: string[];
  /**
   * The lesson that introduces the term, matching `introduced_in` in
   * `ui/src/lessons/terms.yaml`. Unset for UI words no lesson introduces.
   */
  introducedIn?: string;
}

export const MAX_DEFINITION_LENGTH = 140;

export const glossary: Record<string, GlossaryEntry> = {
  token: {
    term: 'token',
    definition:
      'The smallest chunk of text the model works with, from a fixed list. A common word is one token; a rare word may be split into several.',
    aliases: ['tokens'],
    introducedIn: 'pry.p1-2',
  },
  attention: {
    term: 'attention',
    definition:
      'How each token pulls in information from itself and earlier tokens. The model can only look back at earlier text, never ahead.',
    aliases: [],
    introducedIn: 'pry.p2-1',
  },
  'attention-head': {
    term: 'attention head',
    definition:
      'One of several parts in each layer that do attention. Each head has its own pattern for which earlier tokens it draws from.',
    aliases: ['head', 'heads', 'attention heads'],
    introducedIn: 'pry.p2-1',
  },
  layer: {
    term: 'layer',
    definition:
      "One step in the model's stack. Each layer reads the residual stream, adds its own work into it and passes it up. GPT-2 small has 12.",
    aliases: ['layers'],
    introducedIn: 'pry.p1-3',
  },
  'residual-stream': {
    term: 'residual stream',
    definition:
      "Each token's list of numbers that travels up through the layers. Every head and MLP reads from it and adds its result back in.",
    aliases: ['residual'],
    introducedIn: 'pry.p1-3',
  },
  mlp: {
    term: 'MLP',
    definition:
      'The half of each layer that comes after attention. It works on each token separately. Research suggests it stores many facts.',
    aliases: ['mlps', 'mlp layer'],
    introducedIn: 'pry.p2-4',
  },
  logit: {
    term: 'logit',
    definition:
      "The model's raw score for one possible next token, before the scores are turned into probabilities. Higher means more favored.",
    aliases: ['logits'],
    introducedIn: 'pry.p1-4',
  },
  probability: {
    term: 'probability',
    definition:
      'The chance the model gives one possible next token, from 0% to 100%. All the options together add up to 100%.',
    aliases: ['probabilities'],
    introducedIn: 'pry.p1-4',
  },
  'logit-lens': {
    term: 'logit lens',
    definition:
      "A rough trick that asks each layer: what would you predict if you had to answer now? It shows the guess forming layer by layer.",
    aliases: [],
    introducedIn: 'pry.p2-3',
  },
  dla: {
    term: 'DLA',
    definition:
      'Direct logit attribution: how much each head or MLP directly pushed the guess up or down. It leaves out help that goes through other parts.',
    aliases: ['direct logit attribution', 'why (dla)'],
    introducedIn: 'pry.p2-4',
  },
  patching: {
    term: 'activation patching',
    definition:
      "Copying one part's activations from one prompt's run into another's, to test whether that part carries the difference. Pry's Swap test.",
    aliases: ['patching', 'activation-patching', 'swap test'],
    introducedIn: 'pry.p3-3',
  },
  ablation: {
    term: 'ablation',
    definition:
      "Switching part of the model off (for example, zeroing a head's output) and re-running to see whether the answer changes.",
    aliases: ['ablate', 'ablated', 'knockout', 'knock out'],
    introducedIn: 'pry.p3-2',
  },
  sae: {
    term: 'SAE',
    definition:
      "A sparse autoencoder (SAE): a separate network that splits a layer's residual stream into many features, with only a few active at once.",
    aliases: ['saes', 'sparse autoencoder'],
    introducedIn: 'pry.p2-5',
  },
  feature: {
    term: 'feature',
    definition:
      'A pattern an SAE found inside the model, often matching a concept. Its label is a best guess from the text where it fires.',
    aliases: ['features', 'sae feature', 'sae features'],
    introducedIn: 'pry.p2-5',
  },
  activation: {
    term: 'activation',
    definition:
      'How strongly something inside the model (such as a feature) responds to the current text. A bigger number means a stronger response.',
    aliases: ['activations', 'act'],
    introducedIn: 'pry.p1-6',
  },
  steering: {
    term: 'steering',
    definition:
      "Adding a feature's direction to the model's internal state while it runs, to push its writing toward or away from a concept.",
    aliases: ['steer'],
    introducedIn: 'pry.p3-5',
  },
  'induction-head': {
    term: 'induction head',
    definition:
      'A copying head: when a token repeats, it looks at what came right after it last time, which helps predict that again.',
    aliases: ['induction heads', 'copying head', 'copying heads'],
    introducedIn: 'pry.p2-2',
  },
  'previous-token-head': {
    term: 'previous-token head',
    definition:
      'A head that mostly looks at the token just before the current one. Copying heads rely on heads like this.',
    aliases: ['previous-token heads', 'previous token head'],
    introducedIn: 'pry.p2-2',
  },
  'attention-sink': {
    term: 'start-of-text marker',
    definition:
      "A special first token. Lots of heads park their attention on it when nothing else is worth looking at, so it's often bright.",
    aliases: ['start of text', 'bos', 'bos token'],
    introducedIn: 'pry.p1-2',
  },
  temperature: {
    term: 'temperature',
    definition:
      'How much randomness goes into picking each next token. At 0 the model always takes its top guess; higher values take more risks.',
    aliases: [],
    introducedIn: 'pry.p1-5',
  },
  neuronpedia: {
    term: 'Neuronpedia',
    definition:
      "A public website that catalogues SAE features, with example text and AI-written labels. Pry's feature labels come from it.",
    aliases: [],
    introducedIn: 'pry.p2-5',
  },
  embedding: {
    term: 'embedding',
    definition:
      "The model's first step: turning each token into a long list of numbers that the layers can work on.",
    aliases: ['embeddings', 'embed'],
    introducedIn: 'pry.p1-2',
  },
  unembedding: {
    term: 'unembedding',
    definition:
      "The model's last step: turning the final residual stream into a score (a logit) for every token in its vocabulary.",
    aliases: ['unembed'],
    introducedIn: 'pry.p2-3',
  },
  'direct-value-path': {
    term: 'direct value path',
    definition:
      "One part's output fed straight into a later head's values, with nothing in between. Key parts lines show only this kind of link.",
    aliases: ['value path'],
    introducedIn: 'pry.p3-7',
  },
  threshold: {
    term: 'threshold',
    definition: "The cutoff: parts that push less than this don't show. Lower it to see more parts.",
    aliases: ['cutoff'],
    introducedIn: 'pry.p3-7',
  },
  'query-key': {
    term: 'query and key',
    definition:
      "The word doing the looking is the query, and the word it's looking at is the key. A head scores every pair.",
    aliases: ['query', 'queries', 'key', 'keys', 'query/key'],
    introducedIn: 'pry.p2-1',
  },
  'name-mover': {
    term: 'name mover',
    definition:
      'A head that copies a name from earlier in the text into the guess. In GPT-2 small, layer 9, head 9 is a well-known one.',
    aliases: ['name movers', 'name mover head', 'name mover heads'],
    introducedIn: 'pry.p3-2',
  },
  seed: {
    term: 'seed',
    definition:
      "The starting number for the random picks when the model writes. Use the same seed and settings and you'll get the same text.",
    aliases: ['random seed'],
    introducedIn: 'pry.p1-5',
  },
  circuit: {
    term: 'circuit',
    definition:
      'A small set of parts that work together on one job. Key parts shows the biggest direct pushes: a starting point, not an established circuit.',
    aliases: ['circuits', 'key parts'],
    introducedIn: 'pry.p3-7',
  },
};

const index: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [key, entry] of Object.entries(glossary)) {
    m.set(key.toLowerCase(), key);
    m.set(entry.term.toLowerCase(), key);
    for (const a of entry.aliases) m.set(a.toLowerCase(), key);
  }
  return m;
})();

/** Canonical key for a key, display term or alias, or null if unknown. */
export function resolveTerm(name: string): string | null {
  return index.get(name.trim().toLowerCase()) ?? null;
}

/** Entry for a key, display term or alias, or null if unknown. */
export function lookupTerm(name: string): GlossaryEntry | null {
  const key = resolveTerm(name);
  return key ? glossary[key] : null;
}
