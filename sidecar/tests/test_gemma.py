"""T31: Gemma 2 2B preset (Gemma Scope SAEs, Hugging Face license gate).

Only ``test_gemma_loads_and_features`` needs the gated model weights; it skips
when there is no HF token or google/gemma-2-2b isn't in the local HF cache.
Everything else runs offline except ``test_gemma_scope_files_on_hub``, which
lists one folder of the public (ungated) Gemma Scope repo.
"""

from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

from pry_sidecar.presets import PRESETS

GEMMA = "gemma-2-2b"


def _directory_entry(release: str):
    from sae_lens.toolkit.pretrained_saes_directory import get_pretrained_saes_directory

    return get_pretrained_saes_directory()[release]


def test_gemma_preset_enabled():
    m = PRESETS[GEMMA]
    assert m.enabled and not m.cpu_ok
    assert m.license_gate == "huggingface_gemma"
    assert m.model.tl_name == "gemma-2-2b" and m.model.hf_id == "google/gemma-2-2b"
    # float32 (~13 GB with TL's untied unembed) doesn't fit a 12 GB card.
    assert m.model.dtype == "bfloat16"
    assert m.sae.hook == "hook_resid_post"
    assert m.sae_id(12) == "layer_12/width_16k/canonical"
    assert m.available_sae_layers == list(range(26))
    assert m.display.n_layers == 26 and m.display.n_heads == 8
    assert m.neuronpedia_release_id(12) == "12-gemmascope-res-16k"
    # 9B stays off.
    assert not PRESETS["gemma-2-9b"].enabled


def test_ungated_presets_keep_blocks_sae_ids():
    assert PRESETS["gpt2-small"].sae_id(8) == "blocks.8.hook_resid_pre"
    assert PRESETS["pythia-70m"].sae_id(3) == "blocks.3.hook_resid_post"


def test_gemma_sae_ids_exist_in_saelens_directory():
    m = PRESETS[GEMMA]
    entry = _directory_entry(m.sae.release)
    assert entry.repo_id == "google/gemma-scope-2b-pt-res"
    assert entry.conversion_func == "gemma_2"
    assert entry.model == "gemma-2-2b"
    for layer in m.available_sae_layers:
        sae_id = m.sae_id(layer)
        assert sae_id in entry.saes_map, sae_id
        assert entry.neuronpedia_id[sae_id] == f"gemma-2-2b/{layer}-gemmascope-res-16k"


def test_gemma_scope_config_resolves_to_jumprelu_on_the_inference_hook():
    """Resolve the SAE config the way SAE.from_pretrained does (no download),
    build a randomly initialised SAE from it and run encode()."""
    import torch
    from sae_lens import SAE
    from sae_lens.toolkit.pretrained_sae_loaders import (
        NAMED_PRETRAINED_SAE_CONFIG_GETTERS,
        get_conversion_loader_name,
    )
    from sae_lens.toolkit.pretrained_saes_directory import (
        get_config_overrides,
        get_repo_id_and_folder_name,
    )

    from pry_sidecar.inference import sae_hook_name

    m = PRESETS[GEMMA]
    layer = m.sae.layer
    sae_id = m.sae_id(layer)
    repo_id, folder = get_repo_id_and_folder_name(m.sae.release, sae_id)
    assert folder.startswith(f"layer_{layer}/width_16k/")
    getter = NAMED_PRETRAINED_SAE_CONFIG_GETTERS[get_conversion_loader_name(m.sae.release)]
    cfg = getter(repo_id, folder, "cpu", cfg_overrides=get_config_overrides(m.sae.release, sae_id))

    assert cfg["architecture"] == "jumprelu"
    assert cfg["hook_name"] == sae_hook_name(m, layer) == "blocks.12.hook_resid_post"
    assert cfg["d_in"] == 2304 and cfg["d_sae"] == 16384
    assert cfg["model_name"] == "gemma-2-2b"

    sae = SAE.from_dict({**cfg, "device": "cpu"})
    torch.manual_seed(0)
    x = torch.randn(3, cfg["d_in"], dtype=torch.bfloat16)  # the model runs in bf16
    acts = sae.encode(x.to(sae.dtype))
    assert acts.shape == (3, cfg["d_sae"])
    assert (acts >= 0).all()


def test_gemma_scope_files_on_hub():
    """The canonical layer-12 folder exists in the public Gemma Scope repo."""
    from huggingface_hub import HfApi

    m = PRESETS[GEMMA]
    entry = _directory_entry(m.sae.release)
    folder = entry.saes_map[m.sae_id(m.sae.layer)]
    try:
        files = {
            e.path: getattr(e, "size", None)
            for e in HfApi().list_repo_tree(entry.repo_id, path_in_repo=folder, token=False)
        }
    except Exception as exc:  # offline
        pytest.skip(f"Hugging Face unreachable: {exc}")
    params = f"{folder}/params.npz"
    assert params in files
    # presets.json size_mb tracks the real file (302 MB for width_16k).
    assert abs(files[params] / 1e6 - m.sae.size_mb) < 10


def test_registry_load_passes_valid_kwargs_for_gated_preset(monkeypatch):
    """TL reads HF_TOKEN itself and passes token= to transformers, so a token=
    kwarg from us collides with it; SAELens 5.11's SAE.from_pretrained has no
    token parameter at all. Neither may be passed. The model loads in bf16."""
    import inspect

    import transformer_lens
    import sae_lens

    from pry_sidecar.registry import ModelRegistry

    real_sae_from_pretrained = sae_lens.SAE.from_pretrained
    calls: dict[str, dict] = {}

    def fake_model(name, **kwargs):
        calls["model"] = {"name": name, **kwargs}
        return SimpleNamespace(cfg=SimpleNamespace())

    def fake_sae(**kwargs):
        inspect.signature(real_sae_from_pretrained).bind(**kwargs)  # TypeError on a bad kwarg
        calls["sae"] = kwargs
        return (object(), {}, None)

    monkeypatch.setattr(transformer_lens.HookedTransformer, "from_pretrained", fake_model)
    monkeypatch.setattr(sae_lens.SAE, "from_pretrained", fake_sae)
    monkeypatch.setenv("HF_TOKEN", "hf_dummy")

    m = PRESETS[GEMMA]
    loaded = ModelRegistry().load(GEMMA, m)
    assert loaded.sae_layer == 12
    assert calls["model"]["name"] == "gemma-2-2b"
    assert calls["model"]["dtype"] == "bfloat16"
    assert "token" not in calls["model"]
    assert calls["sae"]["release"] == "gemma-scope-2b-pt-res-canonical"
    assert calls["sae"]["sae_id"] == "layer_12/width_16k/canonical"

    # Ungated presets keep TL's default dtype.
    ModelRegistry().load("gpt2-small", PRESETS["gpt2-small"])
    assert "dtype" not in calls["model"]
    assert calls["sae"]["sae_id"] == "blocks.8.hook_resid_pre"


# ---------------------------------------------------------------------------
# License gate: plain messages naming the missing step
# ---------------------------------------------------------------------------


def _http_error(cls_name: str, status: int):
    from huggingface_hub import errors
    from requests import Response

    resp = Response()
    resp.status_code = status
    return getattr(errors, cls_name)(f"{status} Client Error.", response=resp)


def _chained(inner: BaseException) -> BaseException:
    """What transformers + registry.load turn a GatedRepoError into."""
    outer = OSError("You are trying to access a gated repo.")
    outer.__cause__ = inner
    err = RuntimeError(f"failed to load model gemma-2-2b: {outer}")
    err.__cause__ = outer
    return err


def test_license_gate_error_names_the_missing_step(monkeypatch):
    from pry_sidecar.registry import LicenseGateError, hf_token_for, license_gate_error

    m = PRESETS[GEMMA]

    monkeypatch.delenv("HF_TOKEN", raising=False)
    with pytest.raises(LicenseGateError) as no_token:
        hf_token_for(m)
    assert no_token.value.step == "token"
    assert "Hugging Face token step" in str(no_token.value)
    assert hf_token_for(PRESETS["gpt2-small"]) is None  # ungated: no token needed

    monkeypatch.setenv("HF_TOKEN", "hf_dummy")
    assert hf_token_for(m) == "hf_dummy"

    license_missing = license_gate_error(m, _chained(_http_error("GatedRepoError", 403)))
    assert license_missing is not None and license_missing.step == "license"
    assert "hasn't accepted Google's Gemma license" in str(license_missing)
    assert "huggingface.co/google/gemma-2-2b" in str(license_missing)

    bad_token = license_gate_error(m, _chained(_http_error("GatedRepoError", 401)))
    assert bad_token is not None and bad_token.step == "token"
    assert "didn't accept the token" in str(bad_token)

    # Not about the gate, or not a gated preset: no rewrite.
    assert license_gate_error(m, RuntimeError("CUDA error: device-side assert")) is None
    assert license_gate_error(PRESETS["gpt2-small"], _chained(_http_error("GatedRepoError", 403))) is None
    for msg in (str(no_token.value), str(license_missing), str(bad_token)):
        # ui/src/lib/hf-gate.ts gateStepMissing() keys on this phrase.
        assert "needs one more setup step" in msg
        # errors.ts maps a bare "403" to an engine-auth message; stay clear of it.
        assert "403" not in msg and "401" not in msg


def test_load_gemma_without_token_stops_before_download(monkeypatch):
    import json

    from starlette.testclient import TestClient

    from pry_sidecar import main, prefetch

    monkeypatch.delenv("PRY_TOKEN", raising=False)
    monkeypatch.delenv("PRY_DISABLE_AUTH", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)

    def no_network(*a, **k):
        raise AssertionError("must not touch the Hub without a token")

    monkeypatch.setattr(prefetch, "list_repo_files", no_network)
    monkeypatch.setattr(prefetch, "download_files", no_network)
    with TestClient(main.app) as client:
        resp = client.post("/load", json={"preset_id": GEMMA})
    events = [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]
    assert events[-1]["stage"] == "error"
    assert "Hugging Face token step" in events[-1]["message"]
    assert not main.REGISTRY.is_loaded(GEMMA)


def test_load_gemma_gated_download_names_license_step(monkeypatch):
    import json

    from starlette.testclient import TestClient

    from pry_sidecar import main, prefetch

    monkeypatch.delenv("PRY_TOKEN", raising=False)
    monkeypatch.delenv("PRY_DISABLE_AUTH", raising=False)
    monkeypatch.setenv("HF_TOKEN", "hf_dummy")
    monkeypatch.setattr(prefetch, "list_repo_files", lambda repo, token=None, folder=None: {"config.json": 1})
    monkeypatch.setattr(prefetch, "missing_files", lambda repo, files: dict(files))

    def gated(*a, **k):
        raise _http_error("GatedRepoError", 403)

    monkeypatch.setattr(prefetch, "download_files", gated)
    with TestClient(main.app) as client:
        resp = client.post("/load", json={"preset_id": GEMMA})
    events = [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]
    assert events[-1]["stage"] == "error"
    assert "hasn't accepted Google's Gemma license" in events[-1]["message"]


# ---------------------------------------------------------------------------
# Real weights (needs the license + token; skips otherwise)
# ---------------------------------------------------------------------------


@pytest.mark.inference
def test_gemma_loads_and_features(no_neuronpedia):
    if not os.environ.get("HF_TOKEN"):
        pytest.skip("HF_TOKEN not set (Gemma is gated: accept the license on huggingface.co first)")
    from conftest import _hf_cached

    if not _hf_cached("google/gemma-2-2b"):
        pytest.skip("google/gemma-2-2b not in local HF cache")

    from pry_sidecar.inference import run_sae_features
    from pry_sidecar.registry import REGISTRY
    from pry_sidecar.schemas import SAEFeaturesRequest

    m = PRESETS[GEMMA]
    loaded = REGISTRY.load(GEMMA, m)
    try:
        cfg = loaded.model.cfg
        assert cfg.n_layers == m.display.n_layers and cfg.n_heads == m.display.n_heads
        assert str(cfg.dtype) == "torch.bfloat16"
        assert loaded.sae.cfg.hook_name == f"blocks.{m.sae.layer}.{m.sae.hook}"
        assert loaded.sae.cfg.architecture == "jumprelu"

        resp = run_sae_features(
            SAEFeaturesRequest(preset_id=GEMMA, prompt="The capital of France is", sae_layer=m.sae.layer),
            REGISTRY,
            m,
        )
        assert resp.tokens and resp.sae_layer_used == m.sae.layer
        assert any(tf.top_k for tf in resp.sae_features)
        for tf in resp.sae_features:
            for f in tf.top_k:
                assert 0 <= f.id < loaded.sae.cfg.d_sae
                assert f.activation > 0
    finally:
        REGISTRY.unload(GEMMA)
