"""Real inference: run a prompt through a loaded model, extract attention
matrices across all layers, encode the residual stream at the configured
layer through the SAE, and decorate the top-K features per token with
Neuronpedia auto-interp descriptions + top-activating snippets.

Heavy deps (torch / transformer_lens / sae_lens) are imported lazily inside
run_generate so that `from pry_sidecar.inference import ...` remains cheap
for tests that never actually execute a forward pass.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import requests

from .custom_models import is_custom_id
from .presets import PRESETS, PresetManifest
from .registry import REGISTRY, LoadedModel, ModelRegistry
from .schemas import (
    AblateFeatureRequest,
    AblateHeadRequest,
    AblateResponse,
    AblationPrediction,
    AttentionLayer,
    CircuitEdge,
    CircuitNode,
    CircuitRequest,
    CircuitResponse,
    DLAComponent,
    DLARequest,
    DLAResponse,
    FeatureHit,
    GenerationStep,
    GenerateRequest,
    GenerateResponse,
    HeadScore,
    HeadScoresRequest,
    HeadScoresResponse,
    LogitLensCell,
    LogitLensRequest,
    LogitLensResponse,
    PatchComponent,
    PatchRequest,
    PatchResponse,
    SAEFeaturesRequest,
    SAEFeaturesResponse,
    SteerRequest,
    SteerResponse,
    TokenFeatures,
    TokenInfo,
    TokenizeRequest,
    TokenizeResponse,
    TopPrediction,
)

NEURONPEDIA_API = "https://www.neuronpedia.org/api/feature"


def sae_hook_name(manifest: PresetManifest, layer: int) -> str:
    """TransformerLens hook the preset's SAE was trained on, at ``layer``.

    GPT-2 (jb) SAEs read ``hook_resid_pre``; Pythia (sm) SAEs read
    ``hook_resid_post``. Always go through the manifest, never hardcode.
    """
    return f"blocks.{layer}.{manifest.sae.hook}"


def _layer_mismatch_msg(requested: int, loaded_layer: int) -> str:
    return (
        f"This feature belongs to layer {requested} but the loaded feature map "
        f"is for layer {loaded_layer}. Re-run after switching layers."
    )


def _target_position(requested: Optional[int], seq_len: int) -> int:
    """The token position to analyse: ``requested``, or the last token.

    Raises ValueError (a 400 at the endpoint) when ``requested`` is past the
    end of the prompt, instead of silently clamping to the last token.
    """
    if requested is None:
        return seq_len - 1
    if requested >= seq_len:
        raise ValueError(
            f"Token position {requested} is out of range; this prompt has "
            f"positions 0-{seq_len - 1}."
        )
    return requested


def run_tokenize(req: TokenizeRequest, loaded: LoadedModel) -> TokenizeResponse:
    """Tokenize ``req.text`` exactly as the analyses do (BOS prepended)."""
    if loaded.model is None:
        raise RuntimeError(f"model '{req.preset_id}' was unloaded during tokenize")
    tokens = [str(t) for t in loaded.model.to_str_tokens(req.text)]
    return TokenizeResponse(tokens=tokens, count=len(tokens))


def _generate_continuation(model, prompt_tokens, max_new_tokens: int) -> str:
    """Greedy-generate from ``prompt_tokens`` and decode only the new tokens.

    Works at the token level (generate returns prompt + new ids), so the
    prompt is removed exactly even when decoding it wouldn't round-trip.
    """
    out = model.generate(
        prompt_tokens,
        max_new_tokens=max_new_tokens,
        temperature=0.0,
        verbose=False,
    )
    new_ids = out[0, prompt_tokens.shape[1]:].tolist()
    eos = getattr(getattr(model, "tokenizer", None), "eos_token_id", None)
    if eos is not None and eos in new_ids:
        new_ids = new_ids[: new_ids.index(eos)]  # generate pads with EOS after stopping
    return model.to_string(new_ids) if new_ids else ""


def _stepwise_generate(
    model, prompt_tokens, max_new_tokens: int, temperature: float, seed: Optional[int]
) -> tuple[list[int], list[GenerationStep]]:
    """Write up to ``max_new_tokens`` tokens one at a time, recording each pick.

    Temperature 0 takes the argmax (identical to the old greedy generate) and
    reports the plain softmax. Above 0 it samples from softmax(logits / T)
    with a CPU generator seeded by ``seed``, so the same seed gives the same
    tokens on the same machine (GPU and CPU logits differ by ~1e-5, which can
    flip a borderline draw across devices). Stops at end-of-text; that token is not a step.
    Returns (new token ids incl. a final EOS if hit, steps).
    """
    import torch
    from transformer_lens.past_key_value_caching import HookedTransformerKeyValueCache

    eos = getattr(getattr(model, "tokenizer", None), "eos_token_id", None)
    gen = None
    if temperature > 0:
        gen = torch.Generator(device="cpu")
        gen.manual_seed(int(seed if seed is not None else 0))

    kv = HookedTransformerKeyValueCache.init_cache(model.cfg, model.cfg.device, 1)
    new_ids: list[int] = []
    steps: list[GenerationStep] = []
    committed = ""
    step_input = prompt_tokens
    with torch.no_grad():
        for _ in range(max_new_tokens):
            logits = model(step_input, return_type="logits", past_kv_cache=kv)
            final = logits[0, -1, :].float()
            if temperature > 0:
                probs = torch.softmax(final / temperature, dim=-1).cpu()
                chosen = int(torch.multinomial(probs, 1, generator=gen).item())
            else:
                probs = torch.softmax(final, dim=-1).cpu()
                chosen = int(final.argmax().item())
            new_ids.append(chosen)
            if eos is not None and chosen == eos:
                break
            top2_vals, top2_ids = torch.topk(probs, 2)
            ru_idx = 1 if int(top2_ids[0]) == chosen else 0
            ru_id = int(top2_ids[ru_idx])
            decoded = model.tokenizer.decode(new_ids)
            if decoded.endswith("�"):
                text = ""  # a character still waiting for its next byte
            else:
                text, committed = decoded[len(committed):], decoded
            steps.append(
                GenerationStep(
                    token=model.to_single_str_token(chosen),
                    token_id=chosen,
                    text=text,
                    probability=float(probs[chosen]),
                    runner_up=model.to_single_str_token(ru_id),
                    runner_up_probability=float(top2_vals[ru_idx]),
                )
            )
            step_input = torch.tensor([[chosen]], device=prompt_tokens.device)
    return new_ids, steps


# Word-count bucket of an auto-interp label -> how detailed the label is.
# The bucket is NOT a confidence measure; ``confidence`` is kept on the wire
# as a deprecated alias for one release.
LABEL_DETAIL: dict[str, str] = {
    "high": "detailed",
    "medium": "short",
    "low": "short",
    "none": "none",
}


# ---------------------------------------------------------------------------
# Neuronpedia fetchers (cached — the API rate-limits and tutorials rerun)
# ---------------------------------------------------------------------------

# H1 fix: both fetch_feature_description and fetch_top_activating_snippets
# previously issued separate HTTP GETs to the same URL. Extract a shared
# _fetch_raw helper so each (model_id, release_id, feature_id) triple costs
# exactly one HTTP round-trip, regardless of call order.
#
# M1 fix: replaced @lru_cache with a dict-based cache that only stores
# successful results. lru_cache caches None returns (network errors, 404s)
# permanently, meaning a temporarily-down Neuronpedia poisons the cache for
# the process lifetime with no retry path.

from pry_sidecar import __version__ as VERSION

_FETCH_CACHE: dict[str, dict] = {}
_FETCH_CACHE_LOCK = threading.Lock()
_FETCH_CACHE_MAX = 4096


def _fetch_raw(
    model_id: str,
    release_id: str,
    feature_id: int,
) -> Optional[dict]:
    """Fetch and cache the raw Neuronpedia feature JSON. Returns None on any error.
    Only successful responses are cached — failures are not stored so retries work."""
    url = f"{NEURONPEDIA_API}/{model_id}/{release_id}/{feature_id}"
    with _FETCH_CACHE_LOCK:
        if url in _FETCH_CACHE:
            return _FETCH_CACHE[url]
    # cache miss — fetch outside the lock
    try:
        resp = requests.get(url, timeout=5, headers={"User-Agent": f"pry/{VERSION}"})
        if resp.status_code != 200:
            return None  # don't cache failures
        data = resp.json()
    except Exception:
        return None  # don't cache failures
    with _FETCH_CACHE_LOCK:
        # M2 fix: hold the lock across the eviction loop AND the insert as a
        # single atomic block. Without this, two threads can each pop one entry
        # before either inserts, leaving the cache temporarily under-full then
        # over-full. The lock is already cheap (dict ops only, no I/O).
        if len(_FETCH_CACHE) >= _FETCH_CACHE_MAX:
            _FETCH_CACHE.pop(next(iter(_FETCH_CACHE)))
        _FETCH_CACHE[url] = data
    return data


def fetch_feature_description(
    model_id: str,
    release_id: str,
    feature_id: int,
) -> tuple[Optional[str], str]:
    """Fetch a feature's auto-interp label. Returns (description, length_bucket).

    ``length_bucket`` is a label word-count heuristic, not a confidence
    measure (map it through ``LABEL_DETAIL`` for the ``label_detail`` field):
      - high:   >=3 words, non-trivial
      - medium: 2 words
      - low:    1 word
      - none:   no description / fetch failed
    """
    data = _fetch_raw(model_id, release_id, feature_id)
    if data is None:
        return None, "none"
    try:
        explanations = data.get("explanations") or []
        desc = None
        if explanations:
            desc = explanations[0].get("description")
        if not desc:
            return None, "none"
        return desc, _label_length_bucket(desc)
    except Exception:
        return None, "none"


def _label_length_bucket(desc: str) -> str:
    """Bucket a label by word count. Says nothing about whether it is right."""
    words = desc.strip().split()
    if len(words) >= 3 and not all(w.startswith('"') or len(w) <= 2 for w in words):
        return "high"
    if len(words) >= 2:
        return "medium"
    return "low"


def fetch_top_activating_snippets(
    model_id: str,
    release_id: str,
    feature_id: int,
    limit: int = 5,
) -> tuple[str, ...]:
    """Fetch top-activating text snippets for a feature. Returns a tuple
    (hashable so it plays nice with lru_cache). Graceful empty on failure."""
    data = _fetch_raw(model_id, release_id, feature_id)
    if data is None:
        return tuple()
    try:
        activations = data.get("activations") or []
        sorted_acts = sorted(
            activations,
            key=lambda a: a.get("maxValue", 0) or 0,
            reverse=True,
        )[:limit]
        snippets: list[str] = []
        for act in sorted_acts:
            tokens = act.get("tokens") or []
            if tokens:
                text = "".join(tokens)[:80].strip()
                if text:
                    snippets.append(text)
        return tuple(snippets)
    except Exception:
        return tuple()


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run_generate(req: GenerateRequest, loaded: LoadedModel) -> GenerateResponse:
    """Run inference on a loaded preset.

    H1 fix: accepts the already-fetched LoadedModel from the caller (main.py)
    rather than re-fetching from REGISTRY. This eliminates the TOCTOU window
    between the is-loaded check and the get() call.

    M3 fix: guards loaded.model / loaded.sae for None in case a concurrent
    unload() nulled them after the caller's get() but before we use them.
    """
    import torch  # heavy import — kept lazy

    total_start = time.perf_counter()

    # M3 fix: guard for concurrent unload — unload() nulls model/sae while
    # holding the per-preset lock, so these can be None even on a non-None
    # LoadedModel that was fetched moments ago.
    # T32: a custom model (custom:<hf_id>) has no manifest and no SAE; it
    # returns attention + predictions with empty sae_features.
    manifest = PRESETS.get(req.preset_id)
    if manifest is None and not is_custom_id(req.preset_id):
        raise RuntimeError(f"unknown preset: {req.preset_id!r}")
    has_sae = manifest is not None

    if loaded.model is None or (has_sae and loaded.sae is None):
        raise RuntimeError(
            f"model '{req.preset_id}' was unloaded during inference"
        )

    # Acquire per-preset lock for the entire inference operation to prevent
    # a concurrent unload from nulling the model mid-inference.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        model = loaded.model
        sae = loaded.sae
        sae_layer = (
            None if not has_sae
            else req.sae_layer if req.sae_layer is not None else loaded.sae_layer
        )
        if model is None or (has_sae and sae is None):
            raise RuntimeError(f"model '{req.preset_id}' was unloaded during inference")
        if has_sae and sae_layer != loaded.sae_layer:
            # The loaded SAE is trained for loaded.sae_layer only.
            raise ValueError(
                f"Asked for layer {sae_layer} but the loaded feature map is for "
                f"layer {loaded.sae_layer}. Switch layers first."
            )

        # -- tokenize --------------------------------------------------------
        tokens_tensor = model.to_tokens(req.prompt)
        token_strs = model.to_str_tokens(req.prompt)
        tokens = [TokenInfo(index=i, text=str(s)) for i, s in enumerate(token_strs)]

        # -- forward pass with cache ----------------------------------------
        resid_hook_name = sae_hook_name(manifest, sae_layer) if has_sae else None

        def names_filter(name: str) -> bool:
            return name.endswith("hook_pattern") or name == resid_hook_name

        forward_start = time.perf_counter()
        with torch.no_grad():
            _logits, cache = model.run_with_cache(
                tokens_tensor,
                names_filter=names_filter,
            )
        forward_ms = (time.perf_counter() - forward_start) * 1000

        # -- attention across all layers ------------------------------------
        # H3 fix: cap seq_len to avoid multi-MB JSON payloads. At seq=512 an
        # untruncated GPT-2 attention dump is ~37M floats. Cap at 64 tokens and
        # signal truncation in the response so the frontend can show a warning.
        _ATTN_SEQ_CAP = 64
        attention_layers: list[AttentionLayer] = []
        attention_truncated: bool = False
        n_layers = int(getattr(model.cfg, "n_layers", 0))
        for layer_idx in range(n_layers):
            key = f"blocks.{layer_idx}.attn.hook_pattern"
            if key not in cache:
                continue
            pattern = cache[key][0]  # [n_heads, seq, seq]
            seq_len = pattern.shape[-1]
            if seq_len > _ATTN_SEQ_CAP:
                pattern = pattern[:, :_ATTN_SEQ_CAP, :_ATTN_SEQ_CAP]
                attention_truncated = True
            heads = pattern.float().cpu().numpy().tolist()
            attention_layers.append(AttentionLayer(layer=layer_idx, heads=heads))

        # -- SAE features at the configured layer --------------------------
        sae_start = time.perf_counter()
        sae_features: list[TokenFeatures] = []
        unique_feature_ids: set[int] = set()
        top_k = max(1, int(req.top_k_features))
        if has_sae:
            resid = cache[resid_hook_name][0]  # [seq, d_model]
            # H5 fix: ensure resid is on the SAE's device and matches its expected dtype.
            # In normal operation both are on the same device, but explicit cast guards
            # against mixed-placement edge cases and sae_lens dtype expectations (float32).
            resid = resid.to(device=sae.device, dtype=getattr(sae, "dtype", resid.dtype))
            with torch.no_grad():
                feature_acts = sae.encode(resid)  # [seq, d_sae]
            n_feature_tokens = feature_acts.shape[0]
        else:
            n_feature_tokens = 0
        sae_ms = (time.perf_counter() - sae_start) * 1000

        for token_idx in range(n_feature_tokens):
            top_vals, top_ids = torch.topk(feature_acts[token_idx], top_k)
            hits: list[FeatureHit] = []
            for val, fid in zip(top_vals.tolist(), top_ids.tolist()):
                if val > 0.01:
                    fid_int = int(fid)
                    hits.append(
                        FeatureHit(
                            id=fid_int,
                            activation=float(val),
                            description=None,
                            confidence="none",
                            top_activating_snippets=[],
                        )
                    )
                    unique_feature_ids.add(fid_int)
            sae_features.append(TokenFeatures(token_index=token_idx, top_k=hits))

        # -- top-k next-token predictions ------------------------------------
        top_predictions: list[TopPrediction] = []
        try:
            final_logits = _logits[0, -1, :]  # last position logits
            top_probs = torch.softmax(final_logits.float(), dim=-1)
            top_vals, top_ids = torch.topk(top_probs, 10)
            for rank, (prob, tid) in enumerate(
                zip(top_vals.tolist(), top_ids.tolist()), start=1
            ):
                tok_str = model.to_single_str_token(tid)
                top_predictions.append(
                    TopPrediction(token=tok_str, probability=float(prob), rank=rank)
                )
        except Exception:
            pass  # non-critical — degrade gracefully

        # -- optional generation (T26: stepwise, with per-step chances) -------
        generation: Optional[str] = None
        generation_steps: list[GenerationStep] = []
        seed_used: Optional[int] = None
        if req.max_new_tokens > 0:
            if req.temperature > 0:
                seed_used = (
                    req.seed if req.seed is not None
                    else int(torch.randint(0, 2**31 - 1, (1,)).item())
                )
            new_ids, generation_steps = _stepwise_generate(
                model, tokens_tensor, req.max_new_tokens, req.temperature, seed_used
            )
            # Same text TL's generate(prompt) returned: prompt + continuation,
            # special tokens (BOS/EOS) dropped.
            all_ids = tokens_tensor[0].tolist() + new_ids
            generation = model.tokenizer.decode(all_ids, skip_special_tokens=True)

    # Lock released — Neuronpedia fetches (network I/O) outside lock

    # -- Neuronpedia descriptions + snippets ----------------------------
    desc_start = time.perf_counter()
    # H2 fix: derive Neuronpedia ids from the preset manifest instead of
    # hardcoding "gpt2-small". Returns None for non-GPT-2 presets so we skip
    # the fetch entirely rather than producing garbage 404 release ids.
    neuronpedia_model_id = manifest.neuronpedia_model_id if has_sae else None
    neuronpedia_release_id = manifest.neuronpedia_release_id(sae_layer) if has_sae else None

    def _fetch_one(fid: int) -> tuple[int, tuple[Optional[str], str, tuple[str, ...]]]:
        if neuronpedia_model_id is None or neuronpedia_release_id is None:
            return fid, (None, "none", tuple())
        desc, conf = fetch_feature_description(neuronpedia_model_id, neuronpedia_release_id, fid)
        snippets = fetch_top_activating_snippets(neuronpedia_model_id, neuronpedia_release_id, fid)
        return fid, (desc, conf, snippets)

    feature_data: dict[int, tuple[Optional[str], str, tuple[str, ...]]] = {}
    if unique_feature_ids and neuronpedia_model_id is not None:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for fid, data in pool.map(_fetch_one, unique_feature_ids):
                feature_data[fid] = data

    for token_features in sae_features:
        for hit in token_features.top_k:
            desc, bucket, snippets = feature_data.get(hit.id, (None, "none", tuple()))
            hit.description = desc
            hit.label_detail = LABEL_DETAIL.get(bucket, "none")  # type: ignore[assignment]
            hit.confidence = bucket  # type: ignore[assignment]  # deprecated alias
            hit.top_activating_snippets = list(snippets)

    description_fetch_ms = (time.perf_counter() - desc_start) * 1000

    total_ms = (time.perf_counter() - total_start) * 1000

    return GenerateResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        tokens=tokens,
        generation=generation,
        generation_steps=generation_steps,
        temperature_used=req.temperature,
        seed_used=seed_used,
        attention=attention_layers,
        attention_truncated=attention_truncated,
        sae_features=sae_features,
        sae_layer_used=sae_layer,
        top_predictions=top_predictions,
        timing_ms={
            "forward_ms": forward_ms,
            "sae_ms": sae_ms,
            "description_fetch_ms": description_fetch_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


def run_sae_features(
    req: SAEFeaturesRequest,
    registry: "ModelRegistry",
    manifest: "PresetManifest",
) -> SAEFeaturesResponse:
    """Run forward pass + SAE at specified layer. No attention extraction, no generation.

    CONCURRENCY: Acquires the per-preset lock for the ENTIRE operation:
    swap_sae (if needed) + forward pass + SAE encode. This uses the same
    lock as /generate, so layer switches block concurrent generates and
    vice versa. Simple, safe. 2-5s max per layer switch is acceptable.
    """
    import torch  # heavy import -- kept lazy

    total_start = time.perf_counter()

    loaded = registry.get(req.preset_id)
    if loaded is None:
        raise RuntimeError(f"preset {req.preset_id!r} not loaded")

    lock = registry._get_lock(req.preset_id)
    with lock:
        # Swap SAE if needed
        if req.sae_layer != loaded.sae_layer:
            swap_start = time.perf_counter()
            registry.swap_sae(req.preset_id, req.sae_layer, manifest)
            swap_ms = (time.perf_counter() - swap_start) * 1000
        else:
            swap_ms = 0.0

        if loaded.model is None or loaded.sae is None:
            raise RuntimeError(
                f"model '{req.preset_id}' was unloaded during SAE feature extraction"
            )

        model = loaded.model
        sae = loaded.sae

        # Tokenize
        tokens_tensor = model.to_tokens(req.prompt)
        token_strs = model.to_str_tokens(req.prompt)
        tokens = [TokenInfo(index=i, text=str(s)) for i, s in enumerate(token_strs)]

        # Forward pass -- only cache the residual hook for the target layer
        resid_hook_name = sae_hook_name(manifest, req.sae_layer)

        forward_start = time.perf_counter()
        with torch.no_grad():
            _logits, cache = model.run_with_cache(
                tokens_tensor,
                names_filter=lambda name: name == resid_hook_name,
            )
        forward_ms = (time.perf_counter() - forward_start) * 1000

        # SAE encode
        sae_start = time.perf_counter()
        resid = cache[resid_hook_name][0]  # [seq, d_model]
        resid = resid.to(device=sae.device, dtype=getattr(sae, "dtype", resid.dtype))
        with torch.no_grad():
            feature_acts = sae.encode(resid)  # [seq, d_sae]
        sae_ms = (time.perf_counter() - sae_start) * 1000

    # Lock released -- build response outside lock

    sae_features: list[TokenFeatures] = []
    unique_feature_ids: set[int] = set()
    top_k = max(1, int(req.top_k_features))
    for token_idx in range(feature_acts.shape[0]):
        top_vals, top_ids = torch.topk(feature_acts[token_idx], top_k)
        hits: list[FeatureHit] = []
        for val, fid in zip(top_vals.tolist(), top_ids.tolist()):
            if val > 0.01:
                fid_int = int(fid)
                hits.append(
                    FeatureHit(
                        id=fid_int,
                        activation=float(val),
                        description=None,
                        confidence="none",
                        top_activating_snippets=[],
                    )
                )
                unique_feature_ids.add(fid_int)
        sae_features.append(TokenFeatures(token_index=token_idx, top_k=hits))

    # Neuronpedia descriptions -- use req.sae_layer explicitly
    desc_start = time.perf_counter()
    neuronpedia_model_id = manifest.neuronpedia_model_id
    neuronpedia_release_id = manifest.neuronpedia_release_id(req.sae_layer)

    def _fetch_one(fid: int) -> tuple[int, tuple[Optional[str], str, tuple[str, ...]]]:
        if neuronpedia_model_id is None or neuronpedia_release_id is None:
            return fid, (None, "none", tuple())
        desc, conf = fetch_feature_description(neuronpedia_model_id, neuronpedia_release_id, fid)
        snippets = fetch_top_activating_snippets(neuronpedia_model_id, neuronpedia_release_id, fid)
        return fid, (desc, conf, snippets)

    feature_data: dict[int, tuple[Optional[str], str, tuple[str, ...]]] = {}
    if unique_feature_ids and neuronpedia_model_id is not None:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for fid, data in pool.map(_fetch_one, unique_feature_ids):
                feature_data[fid] = data

    for token_features in sae_features:
        for hit in token_features.top_k:
            desc, bucket, snippets = feature_data.get(hit.id, (None, "none", tuple()))
            hit.description = desc
            hit.label_detail = LABEL_DETAIL.get(bucket, "none")  # type: ignore[assignment]
            hit.confidence = bucket  # type: ignore[assignment]  # deprecated alias
            hit.top_activating_snippets = list(snippets)

    description_fetch_ms = (time.perf_counter() - desc_start) * 1000
    total_ms = (time.perf_counter() - total_start) * 1000

    return SAEFeaturesResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        tokens=tokens,
        sae_features=sae_features,
        sae_layer_used=req.sae_layer,
        timing_ms={
            "swap_ms": swap_ms,
            "forward_ms": forward_ms,
            "sae_ms": sae_ms,
            "description_fetch_ms": description_fetch_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Logit Lens (Phase B4)
# ---------------------------------------------------------------------------


def run_logit_lens(req: LogitLensRequest, loaded: LoadedModel) -> LogitLensResponse:
    """Run logit lens: for each layer, unembed the residual stream and see
    what the model would predict if forced to answer at that point."""
    import torch

    total_start = time.perf_counter()

    if loaded.model is None:
        raise RuntimeError(f"model '{req.preset_id}' was unloaded during logit lens")

    model = loaded.model
    n_layers = int(getattr(model.cfg, "n_layers", 0))

    # Acquire per-preset lock for the entire operation.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        # Tokenize
        tokens_tensor = model.to_tokens(req.prompt)
        token_strs = model.to_str_tokens(req.prompt)
        tokens = [TokenInfo(index=i, text=str(s)) for i, s in enumerate(token_strs)]
        seq_len = len(tokens)

        # Cache hook_resid_post at ALL layers
        def names_filter(name: str) -> bool:
            return name.endswith("hook_resid_post")

        forward_start = time.perf_counter()
        with torch.no_grad():
            logits, cache = model.run_with_cache(
                tokens_tensor,
                names_filter=names_filter,
            )
        forward_ms = (time.perf_counter() - forward_start) * 1000

        # Get final-layer predictions for each position (ground truth to compare)
        lens_start = time.perf_counter()
        final_probs = torch.softmax(logits[0].float(), dim=-1)  # [seq, vocab]
        final_preds = torch.argmax(final_probs, dim=-1)  # [seq]
        # Gemma 2 soft-caps its output logits (cap * tanh(x / cap)); the lens
        # must too, or its last row disagrees with the real predictions.
        soft_cap = float(getattr(model.cfg, "output_logits_soft_cap", 0.0) or 0.0)

        # Build grid: [layer][token_pos]
        grid: list[list[LogitLensCell]] = []
        for layer_idx in range(n_layers):
            key = f"blocks.{layer_idx}.hook_resid_post"
            if key not in cache:
                # Shouldn't happen, but degrade gracefully
                grid.append([
                    LogitLensCell(predicted_token="?", probability=0.0, matches_final=False)
                    for _ in range(seq_len)
                ])
                continue

            resid = cache[key][0]  # [seq, d_model]
            # Apply final layer norm then unembed
            normed = model.ln_final(resid)  # [seq, d_model]
            layer_logits = normed @ model.W_U  # [seq, vocab]
            if hasattr(model, "b_U") and model.b_U is not None:
                layer_logits = layer_logits + model.b_U
            layer_logits = layer_logits.float()
            if soft_cap > 0:
                layer_logits = soft_cap * torch.tanh(layer_logits / soft_cap)
            layer_probs = torch.softmax(layer_logits, dim=-1)  # [seq, vocab]
            layer_preds = torch.argmax(layer_probs, dim=-1)  # [seq]

            row: list[LogitLensCell] = []
            for pos in range(seq_len):
                pred_id = int(layer_preds[pos].item())
                prob = float(layer_probs[pos, pred_id].item())
                pred_token = model.to_single_str_token(pred_id)
                matches = bool(layer_preds[pos].item() == final_preds[pos].item())
                row.append(LogitLensCell(
                    predicted_token=pred_token,
                    probability=prob,
                    matches_final=matches,
                ))
            grid.append(row)

        lens_ms = (time.perf_counter() - lens_start) * 1000
    total_ms = (time.perf_counter() - total_start) * 1000

    return LogitLensResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        tokens=tokens,
        grid=grid,
        n_layers=n_layers,
        timing_ms={
            "forward_ms": forward_ms,
            "lens_ms": lens_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Direct Logit Attribution (Phase B5)
# ---------------------------------------------------------------------------


def run_dla(req: DLARequest, loaded: LoadedModel) -> DLAResponse:
    """Compute per-component logit contribution toward the predicted token
    at a target position."""
    import torch

    total_start = time.perf_counter()

    if loaded.model is None:
        raise RuntimeError(f"model '{req.preset_id}' was unloaded during DLA")

    model = loaded.model
    n_layers = int(getattr(model.cfg, "n_layers", 0))
    n_heads = int(getattr(model.cfg, "n_heads", 0))

    # Acquire per-preset lock for the entire operation.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        # Tokenize
        tokens_tensor = model.to_tokens(req.prompt)
        token_strs = model.to_str_tokens(req.prompt)
        tokens = [TokenInfo(index=i, text=str(s)) for i, s in enumerate(token_strs)]
        seq_len = len(tokens)

        # Target position: default to last token
        target_pos = _target_position(req.target_token_index, seq_len)

        # Cache: hook_result (attention output per head) + hook_mlp_out, and
        # the final LN scale (+ ln1_post scales on post-norm models) so
        # contributions come out in logits.
        forward_start = time.perf_counter()
        with torch.no_grad():
            logits, cache = model.run_with_cache(
                tokens_tensor,
                names_filter=dla_hook_filter(model),
            )
        forward_ms = (time.perf_counter() - forward_start) * 1000

        # Determine predicted token at target position
        final_logits = logits[0, target_pos, :]  # [vocab]
        predicted_id = int(torch.argmax(final_logits).item())
        predicted_token = model.to_single_str_token(predicted_id)

        # Get the unembedding direction for the predicted token
        # W_U shape: [d_model, vocab]
        dla_start = time.perf_counter()
        # Pulled back through the final LayerNorm (scale frozen at target_pos),
        # so each contribution is in logits. The unembedding bias is per-token,
        # not per-component, so it isn't attributed to anything.
        unembed_dir = final_ln_logit_direction(model, cache, predicted_id, target_pos)

        components: list[DLAComponent] = []

        for layer_idx in range(n_layers):
            # Attention heads: hook_result has shape [batch, seq, n_heads, d_model]
            result_key = f"blocks.{layer_idx}.attn.hook_result"
            if result_key in cache:
                result = cache[result_key][0]  # [seq, n_heads, d_model]
                head_dir = _head_logit_direction(model, cache, layer_idx, target_pos, unembed_dir)
                for head_idx in range(n_heads):
                    head_output = result[target_pos, head_idx, :]  # [d_model]
                    contribution = float((head_output.float() @ head_dir).item())
                    components.append(DLAComponent(
                        name=f"L{layer_idx}.H{head_idx}",
                        type="attention",
                        layer=layer_idx,
                        head=head_idx,
                        contribution=contribution,
                    ))

            # MLP: hook_mlp_out has shape [batch, seq, d_model]
            mlp_key = f"blocks.{layer_idx}.hook_mlp_out"
            if mlp_key in cache:
                mlp_output = cache[mlp_key][0, target_pos, :]  # [d_model]
                contribution = float((mlp_output.float() @ unembed_dir).item())
                components.append(DLAComponent(
                    name=f"MLP.{layer_idx}",
                    type="mlp",
                    layer=layer_idx,
                    head=None,
                    contribution=contribution,
                ))

        dla_ms = (time.perf_counter() - dla_start) * 1000

    # Lock released — sort and build response outside lock
    components.sort(key=lambda c: abs(c.contribution), reverse=True)

    total_ms = (time.perf_counter() - total_start) * 1000

    return DLAResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        tokens=tokens,
        target_token_index=target_pos,
        target_token=str(token_strs[target_pos]) if target_pos < len(token_strs) else "",
        predicted_token=predicted_token,
        components=components,
        real_weights_verified=real_weights_verified(model),
        timing_ms={
            "forward_ms": forward_ms,
            "dla_ms": dla_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Feature Steering (Phase C7)
# ---------------------------------------------------------------------------


def _extract_top_predictions(model, logits_2d, position: int = -1, k: int = 10) -> list:
    """Extract top-k predictions from logits at a given position.
    Returns list of AblationPrediction (also usable as TopPrediction)."""
    import torch

    final_logits = logits_2d[position, :]  # [vocab]
    probs = torch.softmax(final_logits.float(), dim=-1)
    top_vals, top_ids = torch.topk(probs, k)
    results = []
    for rank, (prob, tid) in enumerate(zip(top_vals.tolist(), top_ids.tolist()), start=1):
        tok_str = model.to_single_str_token(tid)
        results.append({"token": tok_str, "probability": float(prob), "rank": rank})
    return results


def run_steer(req: SteerRequest, loaded: LoadedModel) -> SteerResponse:
    """Run steered generation: original vs steered output comparison."""
    import torch

    total_start = time.perf_counter()

    hook_name = sae_hook_name(PRESETS[req.preset_id], req.sae_layer)

    # Acquire per-preset lock for the entire operation to prevent concurrent
    # unload (or SAE swap) from changing the model/SAE mid-inference. The
    # model and SAE are read inside the lock for the same reason.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        if loaded.model is None or loaded.sae is None:
            raise RuntimeError(f"model '{req.preset_id}' was unloaded during steering")
        if req.sae_layer != loaded.sae_layer:
            raise ValueError(_layer_mismatch_msg(req.sae_layer, loaded.sae_layer))

        model = loaded.model
        sae = loaded.sae

        # Any feature of the loaded SAE can be steered (T24: concept search
        # picks features that never fired on this prompt). Check the range
        # here too, under the lock: a negative index would silently wrap.
        d_sae = int(sae.cfg.d_sae)
        if not 0 <= req.feature_id < d_sae:
            raise ValueError(
                f"Feature {req.feature_id} is out of range; this feature map "
                f"has features 0-{d_sae - 1}."
            )

        # Get the feature direction from the SAE decoder
        direction = sae.W_dec[req.feature_id].detach().clone()  # [d_model]

        # -- Original generation (no hooks) --
        orig_start = time.perf_counter()
        with torch.no_grad():
            orig_tokens = model.to_tokens(req.prompt)
            orig_logits = model(orig_tokens)
            orig_preds = _extract_top_predictions(model, orig_logits[0])

            # Continuation only; the response carries the prompt separately.
            orig_text = _generate_continuation(model, orig_tokens, req.max_new_tokens)
        orig_ms = (time.perf_counter() - orig_start) * 1000

        # -- Steered generation (persistent hook approach) --
        steer_start = time.perf_counter()
        alpha = req.alpha

        def steering_hook(value, hook):
            value[:, :, :] = value + alpha * direction
            return value

        with torch.no_grad():
            # Install persistent hook, generate, then clean up
            model.add_hook(hook_name, steering_hook)
            try:
                # Get steered logits for predictions
                steered_logits = model(orig_tokens)
                steered_preds = _extract_top_predictions(model, steered_logits[0])

                steered_text = _generate_continuation(model, orig_tokens, req.max_new_tokens)
            finally:
                model.reset_hooks()
        steer_ms = (time.perf_counter() - steer_start) * 1000
    total_ms = (time.perf_counter() - total_start) * 1000

    return SteerResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        feature_id=req.feature_id,
        alpha=req.alpha,
        original_generation=orig_text,
        steered_generation=steered_text,
        original_top_predictions=[
            TopPrediction(**p) for p in orig_preds
        ],
        steered_top_predictions=[
            TopPrediction(**p) for p in steered_preds
        ],
        timing_ms={
            "original_ms": orig_ms,
            "steered_ms": steer_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Head Ablation (Phase C8)
# ---------------------------------------------------------------------------


def run_ablate_heads(req: AblateHeadRequest, loaded: LoadedModel) -> AblateResponse:
    """Zero out specified attention heads and compare predictions."""
    import torch

    total_start = time.perf_counter()

    if loaded.model is None:
        raise RuntimeError(f"model '{req.preset_id}' was unloaded during head ablation")

    model = loaded.model

    # Acquire per-preset lock for the entire operation (original + ablated passes).
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        tokens_tensor = model.to_tokens(req.prompt)

        # -- Original predictions --
        orig_start = time.perf_counter()
        with torch.no_grad():
            orig_logits = model(tokens_tensor)
        orig_preds = _extract_top_predictions(model, orig_logits[0])
        orig_ms = (time.perf_counter() - orig_start) * 1000

        # -- Ablated predictions --
        # Build hooks that zero out specified heads at hook_result
        # hook_result shape: [batch, seq, n_heads, d_model]
        # Group ablations by layer for efficiency
        layer_heads: dict[int, list[int]] = {}
        for abl in req.ablations:
            layer_heads.setdefault(abl.layer, []).append(abl.head)

        ablate_start = time.perf_counter()
        for layer, heads in layer_heads.items():
            hook_name = f"blocks.{layer}.attn.hook_result"
            captured_heads = list(heads)
            def make_hook(h=captured_heads):
                def hook_fn(value, hook):
                    for head in h:
                        value[:, :, head, :] = 0.0
                    return value
                return hook_fn
            model.add_hook(hook_name, make_hook())
        try:
            with torch.no_grad():
                ablated_logits = model(tokens_tensor)
            ablated_preds = _extract_top_predictions(model, ablated_logits[0])
        finally:
            model.reset_hooks()
        ablate_ms = (time.perf_counter() - ablate_start) * 1000

    # Lock released — build response outside lock
    prediction_delta = []
    orig_map = {p["token"]: p["probability"] for p in orig_preds}
    ablated_map = {p["token"]: p["probability"] for p in ablated_preds}
    all_tokens_set = set(orig_map.keys()) | set(ablated_map.keys())
    for tok in all_tokens_set:
        o = orig_map.get(tok, 0.0)
        a = ablated_map.get(tok, 0.0)
        prediction_delta.append({
            "token": tok,
            "original_prob": o,
            "ablated_prob": a,
            "delta": a - o,
        })
    prediction_delta.sort(key=lambda d: abs(d["delta"]), reverse=True)

    total_ms = (time.perf_counter() - total_start) * 1000

    return AblateResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        original_predictions=[AblationPrediction(**p) for p in orig_preds],
        ablated_predictions=[AblationPrediction(**p) for p in ablated_preds],
        prediction_delta=prediction_delta,
        timing_ms={
            "original_ms": orig_ms,
            "ablate_ms": ablate_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Feature Ablation (Phase C9)
# ---------------------------------------------------------------------------


def run_ablate_features(req: AblateFeatureRequest, loaded: LoadedModel) -> AblateResponse:
    """Zero out specified SAE features and compare predictions."""
    import torch

    total_start = time.perf_counter()

    manifest = PRESETS[req.preset_id]

    # Acquire per-preset lock for the entire operation (original + ablated passes).
    # Model/SAE are read inside the lock so a concurrent SAE swap can't hand us
    # a feature map for a different layer.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        if loaded.model is None or loaded.sae is None:
            raise RuntimeError(f"model '{req.preset_id}' was unloaded during feature ablation")
        for abl in req.feature_ablations:
            if abl.layer != loaded.sae_layer:
                raise ValueError(_layer_mismatch_msg(abl.layer, loaded.sae_layer))

        model = loaded.model
        sae = loaded.sae

        tokens_tensor = model.to_tokens(req.prompt)

        # -- Original predictions --
        orig_start = time.perf_counter()
        with torch.no_grad():
            orig_logits = model(tokens_tensor)
        orig_preds = _extract_top_predictions(model, orig_logits[0])
        orig_ms = (time.perf_counter() - orig_start) * 1000

        # -- Ablated predictions --
        # For each targeted feature at its layer, subtract its contribution
        # from the residual stream: activation * decoder_direction
        # Group feature ablations by layer
        layer_features: dict[int, list[int]] = {}
        for abl in req.feature_ablations:
            layer_features.setdefault(abl.layer, []).append(abl.feature_index)

        ablate_start = time.perf_counter()
        for layer, feature_ids in layer_features.items():
            hook_name = sae_hook_name(manifest, layer)
            captured_sae = sae
            captured_fids = list(feature_ids)
            def make_feature_hook(s=captured_sae, fids=captured_fids):
                def hook_fn(value, hook):
                    with torch.no_grad():
                        acts = s.encode(value)
                        for fid in fids:
                            alpha = acts[:, :, fid]
                            direction = s.W_dec[fid]
                            value = value - alpha.unsqueeze(-1) * direction.unsqueeze(0).unsqueeze(0)
                    return value
                return hook_fn
            model.add_hook(hook_name, make_feature_hook())
        try:
            with torch.no_grad():
                ablated_logits = model(tokens_tensor)
            ablated_preds = _extract_top_predictions(model, ablated_logits[0])
        finally:
            model.reset_hooks()
        ablate_ms = (time.perf_counter() - ablate_start) * 1000

    # Lock released — build response outside lock
    prediction_delta = []
    orig_map = {p["token"]: p["probability"] for p in orig_preds}
    ablated_map = {p["token"]: p["probability"] for p in ablated_preds}
    all_tokens_set = set(orig_map.keys()) | set(ablated_map.keys())
    for tok in all_tokens_set:
        o = orig_map.get(tok, 0.0)
        a = ablated_map.get(tok, 0.0)
        prediction_delta.append({
            "token": tok,
            "original_prob": o,
            "ablated_prob": a,
            "delta": a - o,
        })
    prediction_delta.sort(key=lambda d: abs(d["delta"]), reverse=True)

    total_ms = (time.perf_counter() - total_start) * 1000

    return AblateResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        original_predictions=[AblationPrediction(**p) for p in orig_preds],
        ablated_predictions=[AblationPrediction(**p) for p in ablated_preds],
        prediction_delta=prediction_delta,
        timing_ms={
            "original_ms": orig_ms,
            "ablate_ms": ablate_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Activation Patching (Phase D10)
# ---------------------------------------------------------------------------


def _forward_with_fp32_logit(model, tokens, target_pos: int, token_id: int):
    """Run ``model(tokens)`` (with any hooks already added) and also return the
    logit of ``token_id`` at ``target_pos`` computed in float32 from the final
    normalized residual. For bf16 models (Gemma) the model's own logits are
    rounded to ~0.125 near 20, too coarse for patching's small differences;
    for fp32 models this equals the model's logit.
    """
    import torch

    grabbed = {}

    def grab(x, hook):
        grabbed["n"] = x[0, target_pos].detach()
        return x

    with model.hooks(fwd_hooks=[("ln_final.hook_normalized", grab)]):
        logits = model(tokens)
    if "n" not in grabbed:  # no final-norm hook (shouldn't happen): fall back
        return logits, float(logits[0, target_pos, token_id].float().item())
    value = grabbed["n"].float() @ model.W_U[:, token_id].float()
    b_U = getattr(model, "b_U", None)
    if b_U is not None:
        value = value + b_U[token_id].float()
    cap = float(getattr(model.cfg, "output_logits_soft_cap", 0.0) or 0.0)
    if cap > 0:
        value = cap * torch.tanh(value / cap)
    return logits, float(value.item())


# Residual patching runs one forward pass per (layer, position); ~12 x 50.
MAX_RESID_PATCH_RUNS = 600


def run_patching(req: PatchRequest, loaded: LoadedModel) -> PatchResponse:
    """Run activation patching: run clean and corrupted prompts, then for each
    component patch clean activations into the corrupted run and measure
    the logit difference on the target token.

    Uses TransformerLens run_with_hooks for each component patch.
    """
    import torch

    total_start = time.perf_counter()

    if loaded.model is None:
        raise RuntimeError(f"model '{req.preset_id}' was unloaded during patching")

    model = loaded.model
    n_layers = int(getattr(model.cfg, "n_layers", 0))
    n_heads = int(getattr(model.cfg, "n_heads", 0))

    # Tokenize both prompts
    clean_tokens = model.to_tokens(req.clean_prompt)
    corrupted_tokens = model.to_tokens(req.corrupted_prompt)

    # Validate sequence lengths match (required for activation patching)
    if clean_tokens.shape[1] != corrupted_tokens.shape[1]:
        raise ValueError(
            f"Clean and corrupted prompts must tokenize to the same length "
            f"(got {clean_tokens.shape[1]} vs {corrupted_tokens.shape[1]})"
        )

    # Determine target position
    clean_strs = model.to_str_tokens(req.clean_prompt)
    corrupted_strs = model.to_str_tokens(req.corrupted_prompt)
    seq_len = min(len(clean_strs), len(corrupted_strs))
    target_pos = _target_position(req.target_token_index, seq_len)

    # Residual patching costs one forward pass per (layer, position) that can
    # matter: from the first differing token up to the target.
    diffs = (clean_tokens[0] != corrupted_tokens[0]).nonzero()
    first_diff = int(diffs[0].item()) if diffs.numel() else seq_len
    if req.patch_type == "resid":
        runs = n_layers * max(0, target_pos - first_diff + 1)
        if runs > MAX_RESID_PATCH_RUNS:
            raise ValueError(
                f"Residual patching on these prompts needs {runs} model runs "
                f"(limit {MAX_RESID_PATCH_RUNS}). Use shorter prompts, or make "
                f"them differ closer to the end."
            )

    # Determine names_filter based on patch_type for efficient caching
    if req.patch_type == "head":
        def _patching_names_filter(name: str) -> bool:
            return name.endswith("hook_result")
    elif req.patch_type == "mlp":
        def _patching_names_filter(name: str) -> bool:
            return name.endswith("hook_mlp_out")
    else:  # resid
        def _patching_names_filter(name: str) -> bool:
            return name.endswith("hook_resid_pre")

    # Acquire per-preset lock — patching runs up to 144 forward passes for
    # head patching, so we must prevent concurrent unload.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        # -- Run clean prompt with filtered cache --
        cache_start = time.perf_counter()
        with torch.no_grad():
            clean_logits, clean_cache = model.run_with_cache(
                clean_tokens,
                names_filter=_patching_names_filter,
            )
        cache_ms = (time.perf_counter() - cache_start) * 1000

        # -- Run corrupted prompt (baseline) --
        with torch.no_grad():
            corrupted_logits = model(corrupted_tokens)

        # Get predicted tokens
        clean_pred_id = int(torch.argmax(clean_logits[0, target_pos, :]).item())
        corrupted_pred_id = int(torch.argmax(corrupted_logits[0, target_pos, :]).item())
        clean_predicted_token = model.to_single_str_token(clean_pred_id)
        corrupted_predicted_token = model.to_single_str_token(corrupted_pred_id)

        # Baseline logit values for the clean prediction token
        with torch.no_grad():
            _, clean_logit_val = _forward_with_fp32_logit(model, clean_tokens, target_pos, clean_pred_id)
            _, corrupted_logit_val = _forward_with_fp32_logit(model, corrupted_tokens, target_pos, clean_pred_id)

        # -- Patch each component --
        patch_start = time.perf_counter()
        components: list[PatchComponent] = []

        if req.patch_type == "head":
            # Patch attention head outputs one at a time
            for layer_idx in range(n_layers):
                cache_key = f"blocks.{layer_idx}.attn.hook_result"
                if cache_key not in clean_cache:
                    continue
                clean_result = clean_cache[cache_key]  # [1, seq, n_heads, d_model]

                for head_idx in range(n_heads):
                    def patch_head_hook(value, hook, _clean=clean_result, _h=head_idx):
                        value[:, :, _h, :] = _clean[:, :value.shape[1], _h, :]
                        return value

                    hook_name = f"blocks.{layer_idx}.attn.hook_result"
                    model.add_hook(hook_name, patch_head_hook)
                    try:
                        with torch.no_grad():
                            _, patched_logit_val = _forward_with_fp32_logit(model, corrupted_tokens, target_pos, clean_pred_id)
                    finally:
                        model.reset_hooks()
                    effect = patched_logit_val - corrupted_logit_val

                    components.append(PatchComponent(
                        name=f"L{layer_idx}.H{head_idx}",
                        layer=layer_idx,
                        head=head_idx,
                        effect=effect,
                        clean_logit=clean_logit_val,
                        corrupted_logit=corrupted_logit_val,
                        patched_logit=patched_logit_val,
                    ))

        elif req.patch_type == "mlp":
            for layer_idx in range(n_layers):
                cache_key = f"blocks.{layer_idx}.hook_mlp_out"
                if cache_key not in clean_cache:
                    continue
                clean_mlp = clean_cache[cache_key]

                def patch_mlp_hook(value, hook, _clean=clean_mlp):
                    value[:, :, :] = _clean[:, :value.shape[1], :]
                    return value

                hook_name = f"blocks.{layer_idx}.hook_mlp_out"
                model.add_hook(hook_name, patch_mlp_hook)
                try:
                    with torch.no_grad():
                        _, patched_logit_val = _forward_with_fp32_logit(model, corrupted_tokens, target_pos, clean_pred_id)
                finally:
                    model.reset_hooks()
                effect = patched_logit_val - corrupted_logit_val

                components.append(PatchComponent(
                    name=f"MLP.{layer_idx}",
                    layer=layer_idx,
                    head=None,
                    effect=effect,
                    clean_logit=clean_logit_val,
                    corrupted_logit=corrupted_logit_val,
                    patched_logit=patched_logit_val,
                ))

        elif req.patch_type == "resid":
            # One (layer, position) at a time. Swapping the whole residual
            # stream at every position would restore the clean run outright
            # (100% at every layer), which says nothing. Per position, it shows
            # where in the sentence the deciding information sits at each depth.
            # The model is causal, so positions before the first differing token
            # (identical in both runs) and after the target can't change the
            # target's logit: they get effect 0 without a forward pass.
            for layer_idx in range(n_layers):
                cache_key = f"blocks.{layer_idx}.hook_resid_pre"
                if cache_key not in clean_cache:
                    continue
                clean_resid = clean_cache[cache_key]

                for pos in range(seq_len):
                    if pos < first_diff or pos > target_pos:
                        components.append(PatchComponent(
                            name=f"L{layer_idx}@{pos}",
                            layer=layer_idx,
                            head=None,
                            position=pos,
                            effect=0.0,
                            clean_logit=clean_logit_val,
                            corrupted_logit=corrupted_logit_val,
                            patched_logit=corrupted_logit_val,
                        ))
                        continue

                    def patch_resid_hook(value, hook, _clean=clean_resid, _p=pos):
                        value[:, _p, :] = _clean[:, _p, :]
                        return value

                    model.add_hook(cache_key, patch_resid_hook)
                    try:
                        with torch.no_grad():
                            _, patched_logit_val = _forward_with_fp32_logit(model, corrupted_tokens, target_pos, clean_pred_id)
                    finally:
                        model.reset_hooks()
                    effect = patched_logit_val - corrupted_logit_val

                    components.append(PatchComponent(
                        name=f"L{layer_idx}@{pos}",
                        layer=layer_idx,
                        head=None,
                        position=pos,
                        effect=effect,
                        clean_logit=clean_logit_val,
                        corrupted_logit=corrupted_logit_val,
                        patched_logit=patched_logit_val,
                    ))

        patch_ms = (time.perf_counter() - patch_start) * 1000

    # Lock released — sort and build response outside lock
    components.sort(key=lambda c: abs(c.effect), reverse=True)

    total_ms = (time.perf_counter() - total_start) * 1000

    return PatchResponse(
        preset_id=req.preset_id,
        clean_prompt=req.clean_prompt,
        corrupted_prompt=req.corrupted_prompt,
        patch_type=req.patch_type,
        target_token_index=target_pos,
        clean_predicted_token=clean_predicted_token,
        corrupted_predicted_token=corrupted_predicted_token,
        tokens=list(clean_strs),
        components=components,
        timing_ms={
            "cache_ms": cache_ms,
            "patch_ms": patch_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Circuit Subgraph Visualization (Phase D11)
# ---------------------------------------------------------------------------

EDGES_METHOD_DIRECT_VALUE_PATH = "direct_value_path"
# Edges are returned only when |weight| >= this many logits (unless the
# request overrides it), and at most CIRCUIT_MAX_EDGES of them, largest first.
CIRCUIT_EDGE_THRESHOLD = 0.05
CIRCUIT_MAX_EDGES = 30


def final_ln_logit_direction(model, cache, predicted_id: int, target_pos: int):
    """Unembedding direction for ``predicted_id`` pulled back through the final
    LayerNorm, with its scale at ``target_pos`` frozen from the clean run.

    ``x @ direction`` is then component x's direct contribution to the
    predicted token's logit, in logits (TransformerLens' apply_ln_to_stack).
    Needs ``ln_final.hook_scale`` in the cache; without it the scale is skipped.
    """
    import torch

    norm = getattr(model.cfg, "normalization_type", None)
    u = model.W_U[:, predicted_id].float()
    w = getattr(getattr(model, "ln_final", None), "w", None)
    if isinstance(w, torch.Tensor):
        u = u * w.float()
    if norm in ("LN", "LNPre"):
        u = u - u.mean()
    if "ln_final.hook_scale" in cache:
        u = u / cache["ln_final.hook_scale"][0, target_pos, 0].float()
    return u


# Post-norm models (Gemma 2: cfg.use_normalization_before_and_after) send the
# summed head output through ln1_post before the residual stream. DLA, Key
# parts and edges map head outputs through it (attn_post_norm). Set True once
# tests/test_gemma.py::test_real_gemma_sums passed on the real gemma-2-2b
# (2026-10-12, CPU: DLA sum 54.0906 vs logit 54.0909). While False, responses
# for these models carry real_weights_verified=False.
POST_NORM_VERIFIED = True


def uses_attn_post_norm(model) -> bool:
    """True when attention output goes through ``ln1_post`` (Gemma 2)."""
    return bool(getattr(model.cfg, "use_normalization_before_and_after", False))


def real_weights_verified(model) -> bool:
    return POST_NORM_VERIFIED or not uses_attn_post_norm(model)


def attn_post_norm(model, cache, layer: int):
    """``ln1_post`` of ``layer`` as a per-position multiplier, or None.

    ln1_post is a weighted RMSNorm (no centering). With its scale frozen from
    the clean run it is linear, ``x -> x * w / scale``, so it can be applied
    to each head's output separately. Returns ``[pos, d_model]`` (w / scale)
    for post-norm models, None otherwise. Needs
    ``blocks.{layer}.ln1_post.hook_scale`` in the cache.
    """
    if not uses_attn_post_norm(model):
        return None
    scale = cache[f"blocks.{layer}.ln1_post.hook_scale"][0].float()  # [pos, 1]
    w = model.blocks[layer].ln1_post.w.float()  # [d_model]
    return w / scale


def _head_logit_direction(model, cache, layer: int, target_pos: int, unembed_dir):
    """``unembed_dir`` pulled back through ``layer``'s ln1_post at
    ``target_pos`` (unchanged when the model has none), so
    ``head_output @ direction`` is the head's contribution in logits."""
    post = attn_post_norm(model, cache, layer)
    return unembed_dir * post[target_pos] if post is not None else unembed_dir


def _is_post_norm_scale(name: str) -> bool:
    return name.endswith("ln1_post.hook_scale")


def dla_hook_filter(model):
    """Cache names filter for DLA: head results, MLP outputs, the final norm
    scale, and the ln1_post scales only on post-norm models."""
    post = uses_attn_post_norm(model)

    def keep(name: str) -> bool:
        return (
            name.endswith("hook_result")
            or name.endswith("hook_mlp_out")
            or name == "ln_final.hook_scale"
            or (post and _is_post_norm_scale(name))
        )

    return keep


def circuit_edge_hook_filter(name: str, post_norm: bool = False) -> bool:
    """Cache entries ``direct_value_path_edges`` needs. ``post_norm`` adds the
    ln1_post scales (post-norm models only)."""
    return (
        name.endswith("attn.hook_z")
        or name.endswith("attn.hook_pattern")
        or name.endswith("hook_mlp_out")
        or name.endswith("ln1.hook_scale")
        or name == "ln_final.hook_scale"
        or (post_norm and _is_post_norm_scale(name))
    )


def circuit_hook_filter(model):
    """Cache names filter for ``run_circuit``: node importance + edges."""
    post = uses_attn_post_norm(model)

    def keep(name: str) -> bool:
        return (
            name.endswith("hook_result")
            or name.endswith("hook_mlp_out")
            or circuit_edge_hook_filter(name, post)
        )

    return keep


def _component_layer(cid: str) -> tuple[int, int | None]:
    """``"L3.H7"`` -> (3, 7); ``"MLP.4"`` -> (4, None)."""
    if cid.startswith("MLP."):
        return int(cid.split(".")[1]), None
    layer_s, head_s = cid[1:].split(".H")
    return int(layer_s), int(head_s)


def direct_value_path_edges(
    model,
    cache,
    target_pos: int,
    predicted_id: int,
    source_ids: list[str],
    target_ids: list[str],
) -> dict[tuple[str, str], float]:
    """Signed "direct value path" edge weights, in logits of the predicted token.

    For a source component S (an attention head ``L{l}.H{h}`` or ``MLP.{l}``)
    in layer l_s and a target attention head T in layer l_t > l_s, with
    t = ``target_pos``::

        edge(S -> T) = sum_p  A_T[t, p] / s1_T[p]
                              * ( c(S_out[p]) * w1_T ) @ W_V^T @ W_O^T
                              * ( c(.) * w_f / s_f[t] ) @ W_U[:, predicted]

    where

    - ``S_out[p]`` is what S writes to the residual stream at position p
      (``z_S[p] @ W_O^S`` for a head, without the shared ``b_O``; the MLP
      output for an MLP). On post-norm models (Gemma 2) a head's output and
      T's output both pass through their layer's frozen ``ln1_post``
      (``attn_post_norm``), as in the real forward pass;
    - ``c(x) = x - mean(x)`` is LayerNorm centering (identity for RMSNorm or
      no norm);
    - ``s1_T[p]`` is T's ``ln1`` scale at p and ``s_f[t]`` the final LN scale
      at t, both FROZEN from the clean run; ``w1_T`` / ``w_f`` are the LN
      weights (already folded into W_V / W_U when TransformerLens folded LN,
      so they are 1 here);
    - ``A_T[t, p]`` is T's attention pattern from the clean run, frozen;
    - LN biases, ``b_V`` and ``b_O`` are excluded: they don't depend on S.

    Read it as: the part of T's output at t that is built from S's output
    (S enters T's value input through T's frozen ln1, gets mixed by T's frozen
    attention, then reaches the logits through the frozen final LN without
    passing through any other component), projected on the predicted token's
    unembedding direction. Positive = pushes toward the predicted token.

    Only the value (V) path is measured. Q- and K-composition (S changing
    *where* T attends) are excluded, and so is any route through components
    between S and T or after T.
    """
    import torch

    cfg = model.cfg
    norm = getattr(cfg, "normalization_type", None)
    centers = norm in ("LN", "LNPre")

    def center(v: "torch.Tensor") -> "torch.Tensor":
        return v - v.mean(dim=-1, keepdim=True) if centers else v

    def ln_weight(ln_module) -> "torch.Tensor | None":
        w = getattr(ln_module, "w", None)
        return w.float() if isinstance(w, torch.Tensor) else None

    def ln_scale(name: str, head: int | None = None) -> "torch.Tensor | None":
        if name not in cache:
            return None
        s = cache[name][0].float()  # [pos, 1] or [pos, n_heads, 1]
        if s.dim() == 3:
            return s[:, head if head is not None else 0, 0]
        return s[:, 0]

    with torch.no_grad():
        # Output side: logit direction pulled back through the frozen final LN.
        u = final_ln_logit_direction(model, cache, predicted_id, target_pos)

        # Source outputs, [pos, d_model] each.
        source_out: dict[str, torch.Tensor] = {}
        for sid in source_ids:
            layer, head = _component_layer(sid)
            if head is None:
                source_out[sid] = cache[f"blocks.{layer}.hook_mlp_out"][0].float()
            else:
                z = cache[f"blocks.{layer}.attn.hook_z"][0, :, head, :].float()
                out = z @ model.blocks[layer].attn.W_O[head].float()
                post = attn_post_norm(model, cache, layer)
                source_out[sid] = out * post if post is not None else out

        edges: dict[tuple[str, str], float] = {}
        for tid in target_ids:
            lt, ht = _component_layer(tid)
            if ht is None:
                continue  # value path only exists for attention heads
            attn = model.blocks[lt].attn
            # T's output reaches the residual through its frozen ln1_post, if any.
            post_t = attn_post_norm(model, cache, lt)
            u_t = u * post_t[target_pos] if post_t is not None else u
            # T's value-input direction that moves the predicted logit.
            v_dir = attn.W_V[ht].float() @ (attn.W_O[ht].float() @ u_t)  # [d_model]
            w1 = ln_weight(getattr(model.blocks[lt], "ln1", None))
            if w1 is not None:
                v_dir = v_dir * w1
            v_dir = center(v_dir)
            coef = cache[f"blocks.{lt}.attn.hook_pattern"][0, ht, target_pos, :].float()
            s1 = ln_scale(f"blocks.{lt}.ln1.hook_scale", ht)
            if s1 is not None:
                coef = coef / s1
            for sid, out in source_out.items():
                if _component_layer(sid)[0] >= lt:
                    continue
                edges[(sid, tid)] = float((coef * (out @ v_dir)).sum().item())
    return edges


def run_circuit(req: CircuitRequest, loaded: LoadedModel) -> CircuitResponse:
    """List the components (heads + MLPs) whose direct logit attribution to
    the predicted token exceeds the threshold.

    Edges between the listed components are "direct value path" weights
    (``edges_method="direct_value_path"``, see ``direct_value_path_edges``):
    signed, in logits, value path only.
    """
    import torch

    total_start = time.perf_counter()

    # Fix 9: explicitly reject patching source — don't silently return DLA results
    if req.source == "patching":
        raise NotImplementedError(
            "Patching-based circuit discovery is not yet implemented. Use source='dla'."
        )

    if loaded.model is None:
        raise RuntimeError(f"model '{req.preset_id}' was unloaded during circuit extraction")

    model = loaded.model
    n_layers = int(getattr(model.cfg, "n_layers", 0))
    n_heads = int(getattr(model.cfg, "n_heads", 0))

    # Acquire per-preset lock for the entire operation.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        # Tokenize
        tokens_tensor = model.to_tokens(req.prompt)
        token_strs = model.to_str_tokens(req.prompt)
        seq_len = len(token_strs)
        # The word to explain: the focused word if given, else the last (code:A4).
        target_pos = _target_position(req.target_token_index, seq_len)

        # Run with cache to get component outputs (+ what the edges need)
        forward_start = time.perf_counter()
        with torch.no_grad():
            logits, cache = model.run_with_cache(
                tokens_tensor,
                names_filter=circuit_hook_filter(model),
            )
        forward_ms = (time.perf_counter() - forward_start) * 1000

        # Get component importance via DLA, in logits (same units as the edges)
        predicted_id = int(torch.argmax(logits[0, target_pos, :]).item())
        unembed_dir = final_ln_logit_direction(model, cache, predicted_id, target_pos)

        graph_start = time.perf_counter()

        # Compute importance for each component
        component_importance: dict[str, float] = {}
        for layer_idx in range(n_layers):
            # Attention heads
            result_key = f"blocks.{layer_idx}.attn.hook_result"
            if result_key in cache:
                result = cache[result_key][0]  # [seq, n_heads, d_model]
                head_dir = _head_logit_direction(model, cache, layer_idx, target_pos, unembed_dir)
                for head_idx in range(n_heads):
                    head_output = result[target_pos, head_idx, :]
                    contribution = float((head_output.float() @ head_dir).item())
                    cid = f"L{layer_idx}.H{head_idx}"
                    component_importance[cid] = contribution

            # MLPs
            mlp_key = f"blocks.{layer_idx}.hook_mlp_out"
            if mlp_key in cache:
                mlp_output = cache[mlp_key][0, target_pos, :]
                contribution = float((mlp_output.float() @ unembed_dir).item())
                cid = f"MLP.{layer_idx}"
                component_importance[cid] = contribution

        # Determine threshold
        abs_vals = [abs(v) for v in component_importance.values()]
        if req.threshold is not None:
            threshold = req.threshold
        elif abs_vals:
            # Default: top 20% by absolute importance
            abs_vals_sorted = sorted(abs_vals, reverse=True)
            cutoff_idx = max(1, len(abs_vals_sorted) // 5)
            threshold = abs_vals_sorted[min(cutoff_idx, len(abs_vals_sorted) - 1)]
        else:
            threshold = 0.0

        # Build nodes
        nodes: list[CircuitNode] = []
        node_ids: set[str] = set()
        for cid, importance in component_importance.items():
            if abs(importance) >= threshold:
                if cid.startswith("MLP"):
                    layer = int(cid.split(".")[1])
                    nodes.append(CircuitNode(
                        id=cid, type="mlp", layer=layer, head=None, importance=importance
                    ))
                else:
                    parts = cid.replace("L", "").split(".H")
                    layer = int(parts[0])
                    head = int(parts[1])
                    nodes.append(CircuitNode(
                        id=cid, type="attention", layer=layer, head=head, importance=importance
                    ))
                node_ids.add(cid)

        # Edges among the listed components: direct value path (T23).
        node_list = [n.id for n in nodes]
        edge_weights = direct_value_path_edges(
            model, cache, target_pos, predicted_id, node_list, node_list
        )
        edge_threshold = (
            req.edge_threshold if req.edge_threshold is not None else CIRCUIT_EDGE_THRESHOLD
        )
        ranked = sorted(edge_weights.items(), key=lambda kv: abs(kv[1]), reverse=True)
        edges = [
            CircuitEdge(source=s, target=t, weight=w)
            for (s, t), w in ranked
            if abs(w) >= edge_threshold
        ][:CIRCUIT_MAX_EDGES]
        graph_ms = (time.perf_counter() - graph_start) * 1000

    # Lock released — build response outside lock
    total_ms = (time.perf_counter() - total_start) * 1000

    return CircuitResponse(
        preset_id=req.preset_id,
        prompt=req.prompt,
        threshold=threshold,
        source=req.source,
        nodes=nodes,
        edges=edges,
        edges_method=EDGES_METHOD_DIRECT_VALUE_PATH,
        edge_threshold=edge_threshold,
        real_weights_verified=real_weights_verified(model),
        timing_ms={
            "forward_ms": forward_ms,
            "graph_ms": graph_ms,
            "total_ms": total_ms,
        },
        status="ok",
    )


# ---------------------------------------------------------------------------
# Head scores: induction + previous-token heads (T20)
# ---------------------------------------------------------------------------

# The induction test: REPEAT_LEN random tokens, then the same tokens again.
# Seeded so every run (and every test) sees the same sequence.
REPEAT_LEN = 25
REPEAT_SEED = 0
# Sample from ordinary word pieces: skips the low ids (single bytes and
# punctuation) and the rare tail at the end of the vocab.
REPEAT_VOCAB_LO = 1000
REPEAT_VOCAB_HI = 20000


def _repeated_sequence(model):
    """BOS + REPEAT_LEN seeded random tokens + the same tokens again: [1, 1 + 2*REPEAT_LEN]."""
    import torch

    hi = min(REPEAT_VOCAB_HI, int(model.cfg.d_vocab))
    gen = torch.Generator().manual_seed(REPEAT_SEED)
    half = torch.randint(REPEAT_VOCAB_LO, hi, (REPEAT_LEN,), generator=gen)
    tok = model.tokenizer
    bos = tok.bos_token_id if tok.bos_token_id is not None else tok.eos_token_id
    seq = torch.cat([torch.tensor([bos]), half, half]).unsqueeze(0)
    return seq.to(model.cfg.device)


def _attention_patterns(model, tokens_tensor) -> list:
    """Run ``tokens_tensor`` and return each layer's attention pattern, [head, q, k]."""
    import torch

    with torch.no_grad():
        _, cache = model.run_with_cache(
            tokens_tensor,
            names_filter=lambda name: name.endswith("attn.hook_pattern"),
        )
    n_layers = int(model.cfg.n_layers)
    return [cache[f"blocks.{layer}.attn.hook_pattern"][0] for layer in range(n_layers)]


def _previous_token_scores(patterns: list) -> list[list[float]]:
    """Mean ``pattern[i, i-1]`` per head, over positions 2..end.

    Position 1 is skipped: its previous token is BOS, where many heads park
    their attention when they have nothing better to do.
    """
    import torch

    out = []
    for pat in patterns:
        q = torch.arange(2, pat.shape[-1], device=pat.device)
        out.append(pat[:, q, q - 1].mean(dim=-1).tolist())
    return out


def _induction_scores(patterns: list, repeat_len: int) -> list[list[float]]:
    """Mean attention from each second-repeat token to the token right after
    its first occurrence, per head.

    With BOS at 0, the first copy sits at 1..R and the second at R+1..2R.
    Token ``i`` in the second copy first appeared at ``i - R``, so the token
    that came next last time is at ``i - R + 1``.
    """
    import torch

    out = []
    for pat in patterns:
        q = torch.arange(repeat_len + 1, 2 * repeat_len + 1, device=pat.device)
        out.append(pat[:, q, q - repeat_len + 1].mean(dim=-1).tolist())
    return out


def run_head_scores(req: HeadScoresRequest, loaded: LoadedModel) -> HeadScoresResponse:
    """Score every attention head as an induction ("copying") head and as a
    previous-token head.

    Raises ValueError (a 400 at the endpoint) when ``req.prompt`` is too short
    to have a word pair after the first word.
    """
    total_start = time.perf_counter()

    if loaded.model is None:
        raise RuntimeError(f"model '{req.preset_id}' was unloaded during head scoring")

    model = loaded.model
    n_layers = int(model.cfg.n_layers)
    n_heads = int(model.cfg.n_heads)

    # Acquire per-preset lock for the entire operation.
    lock = REGISTRY._get_lock(req.preset_id)
    with lock:
        rep_tokens = _repeated_sequence(model)
        forward_start = time.perf_counter()
        rep_patterns = _attention_patterns(model, rep_tokens)
        induction = _induction_scores(rep_patterns, REPEAT_LEN)

        if req.prompt is not None:
            prompt_tokens = model.to_tokens(req.prompt)
            if prompt_tokens.shape[-1] < 3:
                raise ValueError(
                    "This prompt is too short to score previous-word heads; use at least two words."
                )
            prev = _previous_token_scores(_attention_patterns(model, prompt_tokens))
        else:
            prev = _previous_token_scores(rep_patterns)
        forward_ms = (time.perf_counter() - forward_start) * 1000

        sequence_tokens = [str(model.to_single_str_token(int(t))) for t in rep_tokens[0, 1:]]

    # Lock released — rank and build response outside lock
    scores = [
        HeadScore(
            layer=layer,
            head=head,
            induction=induction[layer][head],
            previous_token=prev[layer][head],
        )
        for layer in range(n_layers)
        for head in range(n_heads)
    ]
    top_induction = sorted(scores, key=lambda s: (-s.induction, s.layer, s.head))[: req.top_k]
    top_previous = sorted(scores, key=lambda s: (-s.previous_token, s.layer, s.head))[: req.top_k]
    total_ms = (time.perf_counter() - total_start) * 1000

    return HeadScoresResponse(
        preset_id=req.preset_id,
        n_layers=n_layers,
        n_heads=n_heads,
        repeat_len=REPEAT_LEN,
        sequence_tokens=sequence_tokens,
        previous_token_source="prompt" if req.prompt is not None else "repeated_sequence",
        scores=scores,
        top_induction=top_induction,
        top_previous_token=top_previous,
        timing_ms={"forward_ms": forward_ms, "total_ms": total_ms},
        status="ok",
    )
