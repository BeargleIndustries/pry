"""Concept search (T24): find SAE features whose Neuronpedia label matches a phrase.

Neuronpedia endpoint used (checked 2026-10-11):

    POST https://www.neuronpedia.org/api/explanation/search
    body {"modelId": "gpt2-small", "layers": ["8-res-jb"], "query": "the ocean"}

Source: Neuronpedia's OpenAPI spec served at https://www.neuronpedia.org/api-doc
(tag "Explanations", summary "Search by SAEs/Sources"). No API key is needed
for this call. The query must be at least 3 characters (Neuronpedia answers
400 otherwise). Results are ranked by ``cosine_similarity`` between the query
and each auto-interp label, up to 20 per page. One row per *label*, so a
feature with several labels can appear more than once; we keep its best row.

The search is semantic, so it always returns *something*, even for nonsense.
The similarity score travels to the UI so it can say how close a match is.

This module sends the user's search text to neuronpedia.org; the UI shows a
notice before every search. Feature-label lookups by id live in
``inference._fetch_raw``; both use the same User-Agent and timeout.
"""

from __future__ import annotations

from typing import Literal, Optional

import requests
from pydantic import BaseModel, Field, field_validator

from pry_sidecar import __version__ as VERSION

NEURONPEDIA_SEARCH_URL = "https://www.neuronpedia.org/api/explanation/search"
MIN_QUERY_CHARS = 3  # Neuronpedia rejects shorter queries
MAX_TOP_TOKENS = 5


class NeuronpediaUnavailable(RuntimeError):
    """Neuronpedia could not be reached or answered with an error."""


class ConceptSearchRequest(BaseModel):
    # Defaults to the most recently loaded preset (as GET /feature/{id} does).
    preset_id: Optional[str] = None
    query: str = Field(..., max_length=200)

    @field_validator("query")
    @classmethod
    def _strip_and_check(cls, v: str) -> str:
        v = v.strip()
        if len(v) < MIN_QUERY_CHARS:
            raise ValueError(f"Type at least {MIN_QUERY_CHARS} characters to search.")
        return v


class ConceptHit(BaseModel):
    feature_id: int
    description: str
    # Cosine similarity between the query and the label (0-1). A label match,
    # not a measure of what the feature really does.
    similarity: Optional[float] = None
    # Tokens this feature most pushes up when active (Neuronpedia ``pos_str``).
    top_boosted_tokens: list[str] = Field(default_factory=list)


class ConceptSearchResponse(BaseModel):
    preset_id: str
    sae_layer: int
    query: str
    results: list[ConceptHit] = Field(default_factory=list)
    status: Literal["ok", "no_coverage"] = "ok"


def parse_search_results(data: object, d_sae: int) -> list[ConceptHit]:
    """Turn a Neuronpedia search response into one hit per feature.

    Keeps the best-similarity row per feature, drops rows whose index is not
    a valid feature of the loaded SAE (``0 <= id < d_sae``), and preserves
    Neuronpedia's ranking order otherwise.
    """
    rows = data.get("results") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    best: dict[int, ConceptHit] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            fid = int(row.get("index"))
        except (TypeError, ValueError):
            continue
        if not 0 <= fid < d_sae:
            continue
        desc = row.get("description")
        if not isinstance(desc, str) or not desc.strip():
            continue
        sim = row.get("cosine_similarity")
        sim = float(sim) if isinstance(sim, (int, float)) else None
        neuron = row.get("neuron") if isinstance(row.get("neuron"), dict) else {}
        pos = neuron.get("pos_str") if isinstance(neuron.get("pos_str"), list) else []
        hit = ConceptHit(
            feature_id=fid,
            description=desc.strip(),
            similarity=sim,
            top_boosted_tokens=[t for t in pos if isinstance(t, str)][:MAX_TOP_TOKENS],
        )
        prev = best.get(fid)
        if prev is None:
            best[fid] = hit
        elif (sim or 0.0) > (prev.similarity or 0.0):
            # dict keeps first-insertion order, so the rank stays where the
            # feature first appeared (its best row comes first anyway).
            best[fid] = hit
    return list(best.values())


def search_concepts(model_id: str, release_id: str, query: str, d_sae: int) -> list[ConceptHit]:
    """Search Neuronpedia labels for ``query`` within one SAE.

    Raises NeuronpediaUnavailable on a network error or non-200 answer.
    Not cached: every search is a fresh, user-initiated request.
    """
    try:
        resp = requests.post(
            NEURONPEDIA_SEARCH_URL,
            json={"modelId": model_id, "layers": [release_id], "query": query},
            timeout=8,
            headers={"User-Agent": f"pry/{VERSION}"},
        )
    except requests.RequestException as e:
        raise NeuronpediaUnavailable(
            "Couldn't reach Neuronpedia (neuronpedia.org). Check your internet "
            "connection and try again."
        ) from e
    if resp.status_code != 200:
        raise NeuronpediaUnavailable(
            f"Neuronpedia couldn't run this search right now (HTTP {resp.status_code}). "
            "Try again in a moment."
        )
    try:
        data = resp.json()
    except ValueError as e:
        raise NeuronpediaUnavailable("Neuronpedia sent a reply Pry couldn't read.") from e
    return parse_search_results(data, d_sae)
