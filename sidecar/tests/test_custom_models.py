"""T32 custom models: config validation, size estimate, SAE-less endpoints.

Non-inference tests use fixture config.json files (tests/fixtures/hf_configs,
copied from the public HuggingFace repos) and never touch the network.
``test_load_custom_no_sae`` loads real gpt2 weights from the HF cache.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from pry_sidecar import custom_models, main
from pry_sidecar.custom_models import (
    NO_SAE_MESSAGE,
    CustomModelError,
    assess_config,
    estimate_params,
    validate,
)
from pry_sidecar.registry import LoadedModel, ModelRegistry

CONFIGS = Path(__file__).resolve().parent / "fixtures" / "hf_configs"


def cfg(name: str) -> dict:
    return json.loads((CONFIGS / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("PRY_TOKEN", raising=False)
    monkeypatch.delenv("PRY_DISABLE_AUTH", raising=False)
    with TestClient(main.app) as c:
        yield c


# ---------------------------------------------------------------------------
# Size estimate
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name, real", [
    ("gpt2", 124_439_808),                # GPT-2 small, tied embeddings
    ("pythia-160m-deduped", 162_322_944),  # untied embed/unembed
    ("qwen2.5-0.5b", 494_032_768),         # gated MLP, grouped KV heads
    ("tinyllama-1.1b-chat", 1_100_048_384),
])
def test_estimate_params_close_to_real(name, real):
    est = estimate_params(cfg(name))
    assert est is not None
    assert abs(est - real) / real < 0.02, f"{name}: estimated {est}, real {real}"


def test_estimate_params_missing_sizes():
    assert estimate_params({"architectures": ["GPT2LMHeadModel"], "n_layer": 12}) is None


# ---------------------------------------------------------------------------
# assess_config: supported vs unsupported
# ---------------------------------------------------------------------------


def test_supported_small_model():
    r = assess_config("gpt2", cfg("gpt2"), "gpt2")
    assert r["supported"] is True
    assert r["architecture"] == "GPT2LMHeadModel"
    assert r["params_label"] == "124M"
    assert r["n_layers"] == 12 and r["n_heads"] == 12
    assert r["cpu_ok"] is True
    assert 1500 <= r["vram_estimate_mb"] <= 2500
    assert r["vram_estimate_mb"] % 100 == 0


def test_supported_uses_tl_official_name():
    r = assess_config(
        "eleutherai/pythia-160m-deduped", cfg("pythia-160m-deduped"), "EleutherAI/pythia-160m-deduped",
    )
    assert r["supported"] is True
    assert r["hf_id"] == "EleutherAI/pythia-160m-deduped"
    assert r["architecture"] == "GPTNeoXForCausalLM"


def test_large_model_not_cpu_ok():
    r = assess_config("TinyLlama/x", cfg("tinyllama-1.1b-chat"), "TinyLlama/x")
    assert r["supported"] is True
    assert r["cpu_ok"] is False
    assert r["params_label"] == "1.1B"
    assert r["vram_estimate_mb"] > 5000


def test_unsupported_architecture():
    # BERT is on TransformerLens' list, but it isn't a text-generating model.
    r = assess_config("google-bert/bert-base-cased", cfg("bert-base-cased"), "google-bert/bert-base-cased")
    assert r["supported"] is False
    assert "BertForMaskedLM" in r["message"]
    assert r["vram_estimate_mb"] is None


def test_supported_architecture_not_on_tl_list():
    r = assess_config("TinyLlama/TinyLlama-1.1B-Chat-v1.0", cfg("tinyllama-1.1b-chat"), None)
    assert r["supported"] is False
    assert r["architecture"] == "LlamaForCausalLM"
    assert "TransformerLens" in r["message"]


def test_remote_code_model_refused():
    r = assess_config("microsoft/phi-2", {"architectures": ["PhiForCausalLM"]}, "microsoft/phi-2", True)
    assert r["supported"] is False
    assert "setup code" in r["message"]


# ---------------------------------------------------------------------------
# validate(): plumbing with injected lookups (no network, no TL import)
# ---------------------------------------------------------------------------


def test_validate_bad_name():
    with pytest.raises(CustomModelError, match="doesn't look like"):
        validate("not a model", official=lambda h: None, fetch=lambda h, t: {})
    with pytest.raises(CustomModelError):
        validate("a/b/c", official=lambda h: None, fetch=lambda h, t: {})


def test_validate_fetches_official_name():
    seen = []

    def fetch(hf_id, token):
        seen.append((hf_id, token))
        return cfg("pythia-160m-deduped")

    r = validate(
        " eleutherai/pythia-160m-deduped ",
        token="hf_x",
        official=lambda h: "EleutherAI/pythia-160m-deduped",
        remote_code=lambda n: False,
        fetch=fetch,
    )
    assert seen == [("EleutherAI/pythia-160m-deduped", "hf_x")]
    assert r["supported"] is True


def test_gated_message_mentions_token_step():
    without = custom_models.gated_message("google/gemma-2-2b", has_token=False)
    assert "huggingface.co/google/gemma-2-2b" in without and "access token" in without
    with_token = custom_models.gated_message("google/gemma-2-2b", has_token=True)
    assert "doesn't have access yet" in with_token


def test_fetch_config_maps_hub_errors(monkeypatch):
    import huggingface_hub
    from huggingface_hub.utils import GatedRepoError, LocalEntryNotFoundError, RepositoryNotFoundError

    def raiser(exc):
        def f(*a, **k):
            raise exc
        return f

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", raiser(GatedRepoError("gated")))
    with pytest.raises(CustomModelError) as e:
        custom_models.fetch_config("google/gemma-2-2b", None)
    assert e.value.gated is True

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", raiser(RepositoryNotFoundError("nope")))
    with pytest.raises(CustomModelError, match="no model called") as e:
        custom_models.fetch_config("nobody/nothing", None)
    assert e.value.gated is False

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", raiser(LocalEntryNotFoundError("offline")))
    with pytest.raises(CustomModelError, match="internet"):
        custom_models.fetch_config("gpt2", None)


# ---------------------------------------------------------------------------
# Endpoints (no weights)
# ---------------------------------------------------------------------------


def test_validate_endpoint(client, monkeypatch):
    monkeypatch.setattr(
        custom_models, "validate",
        lambda hf_id, token=None: assess_config(hf_id, cfg("gpt2"), "gpt2"),
    )
    body = client.post("/custom-models/validate", json={"hf_id": "gpt2"}).json()
    assert body["supported"] is True and body["architecture"] == "GPT2LMHeadModel"


def test_validate_endpoint_gated(client, monkeypatch):
    def gated(hf_id, token=None):
        raise CustomModelError(custom_models.gated_message(hf_id, False), gated=True)

    monkeypatch.setattr(custom_models, "validate", gated)
    resp = client.post("/custom-models/validate", json={"hf_id": "google/gemma-2-2b"})
    assert resp.status_code == 422
    assert resp.json()["gated"] is True


@pytest.mark.parametrize("path, body", [
    ("/sae-features", {"preset_id": "custom:gpt2", "prompt": "hi", "sae_layer": 3}),
    ("/steer", {"preset_id": "custom:gpt2", "prompt": "hi", "feature_id": 1, "sae_layer": 3, "alpha": 2.0}),
    ("/ablate-feature", {"preset_id": "custom:gpt2", "prompt": "hi",
                         "feature_ablations": [{"feature_index": 1, "layer": 3}]}),
    ("/concept-search", {"preset_id": "custom:gpt2", "query": "cats"}),
])
def test_feature_endpoints_refuse_custom(client, path, body):
    resp = client.post(path, json=body)
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"] == NO_SAE_MESSAGE


def test_load_request_needs_one_target(client):
    for body in ({}, {"preset_id": "gpt2-small", "custom": {"hf_id": "gpt2"}}):
        resp = client.post("/load", json=body)
        assert resp.status_code == 400
        assert resp.json()["error"] == "validation_error"


class _FakeCustomRegistry(ModelRegistry):
    def load_custom(self, preset_id, tl_name, on_stage=None):
        self.tl_name = tl_name
        on_stage("model_loaded", "cpu")
        loaded = LoadedModel(preset_id, object(), None, None, "cpu")
        self._loaded[preset_id] = loaded
        self._last_loaded = preset_id
        return loaded


def test_load_custom_streams_without_sae_stage(client, monkeypatch):
    from pry_sidecar import prefetch

    fake = _FakeCustomRegistry()
    monkeypatch.setattr(main, "REGISTRY", fake)
    monkeypatch.setattr(custom_models, "tl_official_name", lambda h: "EleutherAI/pythia-160m-deduped")
    monkeypatch.setattr(prefetch, "list_repo_files", lambda repo, token=None, folder=None: {"config.json": 5})
    monkeypatch.setattr(prefetch, "missing_files", lambda repo, files: {})

    resp = client.post("/load", json={"custom": {"hf_id": "eleutherai/pythia-160m-deduped"}})
    events = [json.loads(l[6:]) for l in resp.text.splitlines() if l.startswith("data: ")]
    stages = [e["stage"] for e in events]
    assert stages[-1] == "ready"
    assert "load_sae" not in stages and "download_sae" not in stages
    assert fake.tl_name == "EleutherAI/pythia-160m-deduped"
    assert fake.is_loaded("custom:eleutherai/pythia-160m-deduped")


def test_load_custom_not_on_tl_list(client, monkeypatch):
    monkeypatch.setattr(main, "REGISTRY", _FakeCustomRegistry())
    monkeypatch.setattr(custom_models, "tl_official_name", lambda h: None)
    resp = client.post("/load", json={"preset_id": "custom:someone/unknown"})
    events = [json.loads(l[6:]) for l in resp.text.splitlines() if l.startswith("data: ")]
    assert events[-1]["stage"] == "error"
    assert "TransformerLens" in events[-1]["message"]


# ---------------------------------------------------------------------------
# Inference: gpt2 as a custom model
# ---------------------------------------------------------------------------


@pytest.mark.inference
def test_load_custom_no_sae(client, no_neuronpedia):
    from huggingface_hub import try_to_load_from_cache

    if not isinstance(try_to_load_from_cache("gpt2", "config.json"), str):
        pytest.skip("gpt2 not in local HF cache")

    pid = "custom:gpt2"
    try:
        resp = client.post("/load", json={"custom": {"hf_id": "gpt2"}})
        events = [json.loads(l[6:]) for l in resp.text.splitlines() if l.startswith("data: ")]
        assert events[-1]["stage"] in ("ready", "already_loaded"), events[-1]
        loaded = main.REGISTRY.get(pid)
        assert loaded is not None and loaded.sae is None and loaded.sae_layer is None

        gen = client.post("/generate", json={"preset_id": pid, "prompt": "The cat sat on the", "sae_layer": 8})
        assert gen.status_code == 200, gen.text
        g = gen.json()
        assert len(g["attention"]) == 12
        assert g["sae_features"] == []
        assert g["sae_layer_used"] is None
        assert g["top_predictions"]

        lens = client.post("/logit-lens", json={"preset_id": pid, "prompt": "The cat sat on the"})
        assert lens.status_code == 200, lens.text
        assert lens.json()["n_layers"] == 12 and lens.json()["grid"]

        dla = client.post("/dla", json={"preset_id": pid, "prompt": "The cat sat on the"})
        assert dla.status_code == 200, dla.text

        feats = client.post("/sae-features", json={"preset_id": pid, "prompt": "The cat sat on the", "sae_layer": 8})
        assert feats.status_code == 409
        assert feats.json()["error"] == NO_SAE_MESSAGE

        health = client.get("/health").json()
        assert health["loaded_preset"] == pid and health["sae_layer"] is None
    finally:
        main.REGISTRY.unload(pid)
