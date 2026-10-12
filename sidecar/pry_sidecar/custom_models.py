"""Custom models (T32): user-added HuggingFace models, loaded without an SAE.

A custom model is addressed everywhere by the preset id ``custom:<hf_id>``.
It loads through TransformerLens like a preset, but with no feature
dictionary (SAE), so only the SAE-free analyses work: attention,
predictions, logit lens, DLA, head ablation, patching, copying heads,
compare and watch-it-write.

Validation (``/custom-models/validate``) is real, not a regex:
  1. the repo id must be on TransformerLens' list of models it can load
     (its alias map, case-insensitive), because ``from_pretrained`` refuses
     anything else;
  2. the repo's ``config.json`` is fetched from HuggingFace (with the user's
     token, if any) and its architecture must be a decoder-only one that
     ``HookedTransformer`` converts;
  3. the parameter count is estimated from the config, and from it a memory
     estimate the Rust side turns into the usual Comfortable / Tight / CpuOk /
     Insufficient verdict (``presets_compat.rs``).

``assess_config`` is pure (no network, no torch) so it is unit-tested with
fixture config.json files.
"""

from __future__ import annotations

import json
import math
import os
import re
from typing import Any, Callable, Optional

CUSTOM_PREFIX = "custom:"

# Shown by every feature endpoint (409) and by the feature panels in the UI.
NO_SAE_MESSAGE = (
    "Features need a trained feature dictionary (SAE); "
    "this model doesn't have one in Pry yet."
)

# Decoder-only architectures TransformerLens 2.15.4 converts into a
# HookedTransformer (loading_from_pretrained.convert_hf_model_config).
# BERT and T5 are on TL's list too, but they load as HookedEncoder /
# HookedEncoderDecoder, which Pry's panels don't support.
SUPPORTED_ARCHITECTURES = frozenset({
    "GPT2LMHeadModel",
    "GPTNeoForCausalLM",
    "GPTNeoXForCausalLM",
    "GPTJForCausalLM",
    "OPTForCausalLM",
    "BloomForCausalLM",
    "LlamaForCausalLM",
    "MistralForCausalLM",
    "MixtralForCausalLM",
    "Qwen2ForCausalLM",
    "PhiForCausalLM",
    "Phi3ForCausalLM",
    "GemmaForCausalLM",
    "Gemma2ForCausalLM",
})

# Architectures whose MLP has a gate (three weight matrices instead of two).
_GATED_MLP = frozenset({
    "LlamaForCausalLM", "MistralForCausalLM", "MixtralForCausalLM",
    "Qwen2ForCausalLM", "Phi3ForCausalLM", "GemmaForCausalLM", "Gemma2ForCausalLM",
})
# Architectures with a learned position table (counted in the parameters).
_LEARNED_POSITIONS = frozenset({"GPT2LMHeadModel", "GPTNeoForCausalLM", "OPTForCausalLM"})

# Memory estimate: TransformerLens keeps fp32 weights (4 bytes each) with
# separate embed/unembed matrices, plus working room and the CUDA context.
_BYTES_PER_PARAM = 4
_WORKING_OVERHEAD = 1.25
_BASE_MB = 1200
# Above this many parameters the CPU is too slow to be worth offering.
CPU_OK_MAX_PARAMS = 500_000_000

_HF_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)?$")


def is_custom_id(preset_id: Optional[str]) -> bool:
    return isinstance(preset_id, str) and preset_id.startswith(CUSTOM_PREFIX)


def custom_preset_id(hf_id: str) -> str:
    return f"{CUSTOM_PREFIX}{hf_id}"


def hf_id_of(preset_id: str) -> str:
    return preset_id[len(CUSTOM_PREFIX):]


def is_valid_hf_id(hf_id: str) -> bool:
    return 0 < len(hf_id) <= 200 and bool(_HF_ID_RE.match(hf_id))


# ---------------------------------------------------------------------------
# TransformerLens lookups (lazy: importing TL pulls in torch)
# ---------------------------------------------------------------------------


def tl_official_name(hf_id: str) -> Optional[str]:
    """TransformerLens' official name for ``hf_id`` (alias-aware), or None."""
    from transformer_lens.loading_from_pretrained import make_model_alias_map

    return make_model_alias_map().get(hf_id.lower())


def tl_needs_remote_code(official_name: str) -> bool:
    from transformer_lens.loading_from_pretrained import NEED_REMOTE_CODE_MODELS

    return official_name.startswith(NEED_REMOTE_CODE_MODELS)


# ---------------------------------------------------------------------------
# Size estimate (pure)
# ---------------------------------------------------------------------------


def _first(cfg: dict, *keys: str) -> Any:
    for k in keys:
        v = cfg.get(k)
        if v is not None:
            return v
    return None


def estimate_params(cfg: dict) -> Optional[int]:
    """Approximate parameter count from a HuggingFace config.json.

    Counts embeddings, attention (with grouped key/value heads), the MLP
    (gated or not, times the experts for mixture-of-experts) and a learned
    position table where the architecture has one. Norms and biases are
    ignored (well under 1%). None if the config lacks the sizes.
    """
    n_layers = _first(cfg, "num_hidden_layers", "n_layer", "num_layers")
    d_model = _first(cfg, "hidden_size", "n_embd", "d_model")
    vocab = _first(cfg, "vocab_size")
    n_heads = _first(cfg, "num_attention_heads", "n_head", "num_heads")
    if not all(isinstance(v, int) and v > 0 for v in (n_layers, d_model, vocab, n_heads)):
        return None
    d_mlp = _first(cfg, "intermediate_size", "n_inner", "ffn_dim") or 4 * d_model
    n_kv = _first(cfg, "num_key_value_heads") or n_heads
    head_dim = _first(cfg, "head_dim") or d_model // n_heads
    arch = (cfg.get("architectures") or [""])[0]

    attn = 2 * d_model * n_heads * head_dim + 2 * d_model * n_kv * head_dim
    mlp = (3 if arch in _GATED_MLP else 2) * d_model * d_mlp
    mlp *= _first(cfg, "num_local_experts") or 1
    embed = vocab * d_model
    unembed = 0 if cfg.get("tie_word_embeddings", True) else vocab * d_model
    positions = 0
    if arch in _LEARNED_POSITIONS:
        positions = (_first(cfg, "n_positions", "max_position_embeddings") or 0) * d_model
    return n_layers * (attn + mlp) + embed + unembed + positions


def estimate_vram_mb(cfg: dict, n_params: int) -> int:
    """Memory the loaded model needs, in MB, rounded up to 100 MB."""
    d_model = _first(cfg, "hidden_size", "n_embd", "d_model") or 0
    vocab = _first(cfg, "vocab_size") or 0
    # TL keeps its own unembed matrix even when HF ties it to the embedding.
    tl_params = n_params + (vocab * d_model if cfg.get("tie_word_embeddings", True) else 0)
    weights_mb = tl_params * _BYTES_PER_PARAM / (1024 * 1024)
    return int(math.ceil((_BASE_MB + weights_mb * _WORKING_OVERHEAD) / 100) * 100)


def params_label(n: int) -> str:
    """'124M', '1.1B' style label."""
    if n >= 1_000_000_000:
        return f"{n / 1e9:.1f}B"
    return f"{round(n / 1e6)}M"


# ---------------------------------------------------------------------------
# Assessment (pure)
# ---------------------------------------------------------------------------


def assess_config(
    hf_id: str,
    cfg: dict,
    official_name: Optional[str],
    needs_remote_code: bool = False,
) -> dict:
    """Decide whether Pry can load ``hf_id`` given its config.json.

    ``official_name`` is TransformerLens' name for the model, or None when TL
    doesn't list it. Returns the ``/custom-models/validate`` body.
    """
    archs = cfg.get("architectures") or []
    arch = archs[0] if archs else (cfg.get("model_type") or "unknown")
    result: dict = {
        "hf_id": official_name or hf_id,
        "supported": False,
        "architecture": arch,
        "message": "",
        "n_params": None,
        "params_label": None,
        "n_layers": _first(cfg, "num_hidden_layers", "n_layer", "num_layers"),
        "n_heads": _first(cfg, "num_attention_heads", "n_head", "num_heads"),
        "vram_estimate_mb": None,
        "cpu_ok": False,
        "gated": False,
    }

    if arch not in SUPPORTED_ARCHITECTURES:
        result["message"] = (
            f"Pry can't look inside this kind of model ({arch}). It works with "
            "text-generating models built like GPT-2, Pythia, Llama, Mistral, Qwen2, "
            "Phi or Gemma."
        )
        return result
    if official_name is None:
        result["message"] = (
            f"This model is built like one Pry understands ({arch}), but TransformerLens, "
            "the library Pry uses to look inside models, doesn't have it on its list of "
            "models it knows how to load. Try a listed one, like EleutherAI/pythia-160m-deduped."
        )
        return result
    if needs_remote_code:
        result["message"] = (
            "This model needs to download and run its own setup code, which Pry doesn't "
            "allow. Try a different model."
        )
        return result

    n_params = estimate_params(cfg)
    if n_params is None:
        result["message"] = (
            "Couldn't work out this model's size from its settings file, so Pry can't "
            "tell whether it fits on this computer."
        )
        return result

    result.update(
        supported=True,
        n_params=n_params,
        params_label=params_label(n_params),
        vram_estimate_mb=estimate_vram_mb(cfg, n_params),
        cpu_ok=n_params <= CPU_OK_MAX_PARAMS,
        message="Pry can load this model.",
    )
    return result


# ---------------------------------------------------------------------------
# Fetch + validate (network)
# ---------------------------------------------------------------------------


class CustomModelError(Exception):
    """Plain-language validation failure. ``gated`` marks a license gate."""

    def __init__(self, message: str, gated: bool = False) -> None:
        super().__init__(message)
        self.gated = gated


def gated_message(hf_id: str, has_token: bool) -> str:
    page = f"huggingface.co/{hf_id}"
    if has_token:
        return (
            f"This model is gated: its owner asks people to accept their terms first, and "
            f"your HuggingFace token doesn't have access yet. Open {page} while signed in, "
            "accept the terms, then check again."
        )
    return (
        f"This model is gated: its owner asks people to accept their terms first. "
        f"Open {page} while signed in to HuggingFace and accept the terms, then give Pry "
        "a HuggingFace access token so it can download the model for you."
    )


def fetch_config(hf_id: str, token: Optional[str]) -> dict:
    """Download (or read from cache) the repo's config.json."""
    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import (
        EntryNotFoundError,
        GatedRepoError,
        LocalEntryNotFoundError,
        RepositoryNotFoundError,
    )

    try:
        path = hf_hub_download(hf_id, "config.json", token=token or None)
    except GatedRepoError as e:
        raise CustomModelError(gated_message(hf_id, bool(token)), gated=True) from e
    except RepositoryNotFoundError as e:
        raise CustomModelError(
            f"There's no model called '{hf_id}' on HuggingFace (or it's private). "
            "Check the spelling; names look like 'organization/model-name'."
        ) from e
    # LocalEntryNotFoundError subclasses EntryNotFoundError, so it goes first.
    except LocalEntryNotFoundError as e:
        raise CustomModelError(
            "Couldn't reach HuggingFace to check this model. Check your internet "
            "connection and try again."
        ) from e
    except EntryNotFoundError as e:
        raise CustomModelError(
            f"'{hf_id}' doesn't have a settings file (config.json), so it isn't a model "
            "Pry can load."
        ) from e
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate(
    hf_id: str,
    token: Optional[str] = None,
    official: Callable[[str], Optional[str]] = tl_official_name,
    remote_code: Callable[[str], bool] = tl_needs_remote_code,
    fetch: Callable[[str, Optional[str]], dict] = fetch_config,
) -> dict:
    """Full check for ``/custom-models/validate``. Raises CustomModelError."""
    hf_id = hf_id.strip()
    if not is_valid_hf_id(hf_id):
        raise CustomModelError(
            "That doesn't look like a HuggingFace model name. Names look like "
            "'organization/model-name', using letters, digits, '.', '-' and '_'."
        )
    name = official(hf_id)
    cfg = fetch(name or hf_id, token)
    return assess_config(hf_id, cfg, name, bool(name) and remote_code(name))


def hf_token() -> Optional[str]:
    return os.environ.get("HF_TOKEN") or None
