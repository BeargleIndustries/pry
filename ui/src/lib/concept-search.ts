// Concept search (T24): pure helpers for POST /concept-search.
//
// The sidecar forwards the query to Neuronpedia's
// POST https://www.neuronpedia.org/api/explanation/search (see
// sidecar/pry_sidecar/concept_search.py). The Tauri CSP only allows the UI to
// talk to the local sidecar, so the network call lives there.

/** Neuronpedia rejects shorter queries with a 400. */
export const MIN_QUERY_CHARS = 3;
export const MAX_QUERY_CHARS = 200;

export const NEURONPEDIA_NOTICE =
  'Searching sends the words you type to Neuronpedia (neuronpedia.org), a public site that labels these features. Only your search words and which model and layer you are using are sent.';

export interface ConceptHit {
  feature_id: number;
  description: string;
  /** Similarity between your words and the feature's label (0-1). */
  similarity: number | null;
  /** Tokens the feature most pushes up when it is active. */
  top_boosted_tokens: string[];
}

export interface ConceptSearchResult {
  preset_id: string;
  sae_layer: number;
  query: string;
  results: ConceptHit[];
  status: 'ok' | 'no_coverage';
}

/** Plain message if the query can't be searched, else null. */
export function queryProblem(query: string): string | null {
  const q = query.trim();
  if (q.length < MIN_QUERY_CHARS) return `Type at least ${MIN_QUERY_CHARS} characters to search.`;
  if (q.length > MAX_QUERY_CHARS) return `Keep the search under ${MAX_QUERY_CHARS} characters.`;
  return null;
}

export function buildConceptSearchBody(query: string, presetId?: string | null): string {
  return JSON.stringify({ query: query.trim(), ...(presetId ? { preset_id: presetId } : {}) });
}

function toHit(raw: unknown): ConceptHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r.feature_id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return null;
  if (typeof r.description !== 'string' || !r.description.trim()) return null;
  return {
    feature_id: id,
    description: r.description.trim(),
    similarity: typeof r.similarity === 'number' && Number.isFinite(r.similarity) ? r.similarity : null,
    top_boosted_tokens: Array.isArray(r.top_boosted_tokens)
      ? r.top_boosted_tokens.filter((t): t is string => typeof t === 'string')
      : [],
  };
}

/** Validate a /concept-search body; drops malformed hits instead of throwing. */
export function parseConceptSearch(json: unknown): ConceptSearchResult {
  const r = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const results = Array.isArray(r.results)
    ? r.results.map(toHit).filter((h): h is ConceptHit => h !== null)
    : [];
  return {
    preset_id: typeof r.preset_id === 'string' ? r.preset_id : '',
    sae_layer: typeof r.sae_layer === 'number' ? r.sae_layer : -1,
    query: typeof r.query === 'string' ? r.query : '',
    results,
    status: r.status === 'no_coverage' ? 'no_coverage' : 'ok',
  };
}

/** True when the sidecar says Neuronpedia couldn't be reached (HTTP 502). */
export function isNeuronpediaUnavailable(err: { status?: number; body?: string } | null | undefined): boolean {
  if (!err || err.status !== 502 || !err.body) return false;
  try {
    return (JSON.parse(err.body) as { error?: unknown }).error === 'neuronpedia_unavailable';
  } catch {
    return false;
  }
}

/** "70% label match": how close your words are to the label, not to what the feature does. */
export function similarityLabel(sim: number | null): string | null {
  if (sim === null) return null;
  const pct = Math.round(Math.min(1, Math.max(0, sim)) * 100);
  return `${pct}% label match`;
}

/** Show a boosted token readably (leading space -> visible marker). */
export function showToken(tok: string): string {
  return tok.replace(/^ /, '·').replace(/\n/g, '\\n');
}
