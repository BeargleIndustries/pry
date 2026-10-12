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
}

export const MAX_DEFINITION_LENGTH = 140;

export const glossary: Record<string, GlossaryEntry> = {
  token: {
    term: 'token',
    definition:
      'A word-piece: the smallest chunk of text the model works with. A common word is one token; a rare word may be split into several.',
    aliases: ['tokens', 'word-piece', 'word-pieces', 'word piece'],
  },
  attention: {
    term: 'attention',
    definition:
      'How each word-piece pulls in information from itself and earlier ones. The model can only look back at earlier text, never ahead.',
    aliases: [],
  },
  'attention-head': {
    term: 'attention head',
    definition:
      'One of several small readers inside each layer. Each head decides for itself which earlier word-pieces to look at.',
    aliases: ['head', 'heads', 'attention heads'],
  },
  layer: {
    term: 'layer',
    definition:
      "One step in the model's stack. Each layer reads the running notes, adds its own work and passes them up. GPT-2 small has 12.",
    aliases: ['layers'],
  },
  'residual-stream': {
    term: 'residual stream',
    definition:
      'The running notes passed up from layer to layer. Every head and MLP reads from it and adds its result back in.',
    aliases: ['residual'],
  },
  mlp: {
    term: 'MLP',
    definition:
      'The processing block in each layer, after attention. It works on each word-piece separately. Research suggests it stores many facts.',
    aliases: ['mlps', 'processing layer', 'processing layers', 'mlp layer'],
  },
  logit: {
    term: 'logit',
    definition:
      "The model's raw score for one possible next word-piece, before the scores are turned into probabilities. Higher means more favored.",
    aliases: ['logits'],
  },
  probability: {
    term: 'probability',
    definition:
      'How likely the model thinks a next word-piece is, from 0% to 100%. All the options together add up to 100%.',
    aliases: ['probabilities'],
  },
  'logit-lens': {
    term: 'logit lens',
    definition:
      "A rough trick that asks each layer: what would you predict if you had to answer now? It shows the guess forming layer by layer.",
    aliases: [],
  },
  dla: {
    term: 'DLA',
    definition:
      'Direct logit attribution: an estimate of how much each head or MLP directly pushed the predicted word-piece up or down.',
    aliases: ['direct logit attribution'],
  },
  'activation-patching': {
    term: 'activation patching',
    definition:
      "Copying one part's internal state from one prompt's run into another's, to test whether that part causes the difference.",
    aliases: ['patching', 'swap & compare'],
  },
  ablation: {
    term: 'ablation',
    definition:
      "Switching part of the model off (for example, zeroing a head's output) and re-running to see whether the answer changes.",
    aliases: ['ablate', 'ablated', 'knockout', 'knock out'],
  },
  sae: {
    term: 'SAE',
    definition:
      "Sparse autoencoder: a separate tool trained to split a layer's internal state into many features, only a few active at a time.",
    aliases: ['saes', 'sparse autoencoder', 'feature detector', 'feature dictionary'],
  },
  feature: {
    term: 'feature',
    definition:
      'A pattern an SAE found inside the model, often matching a concept. Its label is a best guess from the text where it fires.',
    aliases: ['features', 'sae feature', 'sae features'],
  },
  activation: {
    term: 'activation',
    definition:
      'How strongly something inside the model (such as a feature) responds to the current text. A bigger number means a stronger response.',
    aliases: ['activations', 'act'],
  },
  steering: {
    term: 'steering',
    definition:
      "Adding a feature's direction to the model's internal state while it runs, to push its writing toward or away from a concept.",
    aliases: ['steer'],
  },
  'induction-head': {
    term: 'induction head',
    definition:
      'A copying head: when a word-piece repeats, it looks at what came right after it last time, which helps predict that again.',
    aliases: ['induction heads', 'copying head', 'copying heads'],
  },
  'previous-token-head': {
    term: 'previous-token head',
    definition:
      'A head that mostly looks at the word-piece just before the current one. Copying heads rely on heads like this.',
    aliases: ['previous-token heads', 'previous token head'],
  },
  'attention-sink': {
    term: 'start-of-text marker',
    definition:
      "A special first token. Lots of heads park their attention on it when nothing else is worth looking at, so it's often bright.",
    aliases: ['attention sink', 'start of text', 'bos', 'bos token'],
  },
  temperature: {
    term: 'temperature',
    definition:
      'How much chance goes into picking each next word. At 0 the model always takes its top guess; higher values take more risks.',
    aliases: [],
  },
  neuronpedia: {
    term: 'Neuronpedia',
    definition:
      "A public website that catalogues SAE features, with example text and AI-written labels. Pry's feature labels come from it.",
    aliases: [],
  },
  embedding: {
    term: 'embedding',
    definition:
      "The model's first step: turning each word-piece into a long list of numbers that the layers can work on.",
    aliases: ['embeddings', 'embed'],
  },
  unembedding: {
    term: 'unembedding',
    definition:
      "The model's last step: turning the final internal state into a score (a logit) for every word-piece it knows.",
    aliases: ['unembed'],
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
