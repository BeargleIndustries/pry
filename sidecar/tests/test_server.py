"""T14/T15/T17/T18 server tests: auth token, /health, /load progress,
/tokenize, continuation-only steering, request validation, CPU fallback."""

from __future__ import annotations

import json
import threading
import time
from types import SimpleNamespace

import pytest
from starlette.testclient import TestClient

from pry_sidecar import main
from pry_sidecar.presets import PRESETS
from pry_sidecar.registry import LoadedModel, ModelRegistry

ORIGIN = "http://tauri.localhost"
IOI_ORIGINAL = "When Mary and John went to the store, John gave a drink to"
IOI_CHANGED = "When Mary and John went to the store, Mary gave a drink to"


@pytest.fixture
def client():
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def no_auth_env(monkeypatch):
    monkeypatch.delenv("PRY_TOKEN", raising=False)
    monkeypatch.delenv("PRY_DISABLE_AUTH", raising=False)


# ---------------------------------------------------------------------------
# T14: token middleware
# ---------------------------------------------------------------------------


def test_requires_token(client, monkeypatch):
    monkeypatch.setenv("PRY_TOKEN", "s3cret")

    missing = client.get("/health", headers={"Origin": ORIGIN})
    assert missing.status_code == 403
    assert missing.json() == {"error": "Pry's engine rejected the request (bad token)."}
    # The middleware sits inside CORS, so the UI can read the 403.
    assert missing.headers.get("access-control-allow-origin") == ORIGIN

    wrong = client.get("/health", headers={"X-Pry-Token": "nope"})
    assert wrong.status_code == 403

    ok = client.get("/health", headers={"X-Pry-Token": "s3cret"})
    assert ok.status_code == 200

    post = client.post("/unload", json={"preset_id": "gpt2-small"})
    assert post.status_code == 403


def test_options_preflight_exempt(client, monkeypatch):
    monkeypatch.setenv("PRY_TOKEN", "s3cret")
    resp = client.options(
        "/generate",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-pry-token",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == ORIGIN


def test_rejects_text_plain(client, no_auth_env):
    resp = client.post(
        "/unload",
        content=json.dumps({"preset_id": "gpt2-small"}),
        headers={"Content-Type": "text/plain"},
    )
    assert resp.status_code == 415
    # JSON with a charset parameter is fine.
    ok = client.post(
        "/unload",
        content=json.dumps({"preset_id": "gemma-2-9b"}),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert ok.status_code == 200


def test_disable_auth_ignored_when_token_set(client, monkeypatch):
    monkeypatch.setenv("PRY_TOKEN", "s3cret")
    monkeypatch.setenv("PRY_DISABLE_AUTH", "1")
    assert client.get("/health").status_code == 403
    assert client.get("/health", headers={"X-Pry-Token": "s3cret"}).status_code == 200


def test_no_token_allows_and_warns_once(client, no_auth_env, caplog):
    import logging

    # The warn-once flag lives on the middleware instance, so use a fresh app.
    fresh = type(main.app)(routes=main.routes, middleware=main.middleware)
    with TestClient(fresh) as c, caplog.at_level(logging.WARNING, logger="pry_sidecar"):
        assert c.get("/health").status_code == 200
        assert c.get("/health").status_code == 200
    warnings = [r for r in caplog.records if "PRY_TOKEN is not set" in r.getMessage()]
    assert len(warnings) == 1


def test_disable_auth_without_token_is_silent(no_auth_env, monkeypatch, caplog):
    import logging

    monkeypatch.setenv("PRY_DISABLE_AUTH", "1")
    fresh = type(main.app)(routes=main.routes, middleware=main.middleware)
    with TestClient(fresh) as c, caplog.at_level(logging.WARNING, logger="pry_sidecar"):
        assert c.get("/health").status_code == 200
    assert not [r for r in caplog.records if "PRY_TOKEN is not set" in r.getMessage()]


# ---------------------------------------------------------------------------
# T15/T17: /health
# ---------------------------------------------------------------------------


def _fake_registry(device: str | None = None, preset_id: str = "gpt2-small") -> ModelRegistry:
    reg = ModelRegistry()
    if device is not None:
        reg._loaded[preset_id] = LoadedModel(preset_id, object(), object(), 8, device)
        reg._last_loaded = preset_id
    return reg


def test_health_reports_device(client, no_auth_env, monkeypatch):
    monkeypatch.setattr(main, "REGISTRY", _fake_registry())
    body = client.get("/health").json()
    for key in ("status", "version", "device", "gpu_name", "torch", "cuda",
                "loaded_preset", "sae_layer", "hf_token_present"):
        assert key in body
    assert body["status"] == "ok"
    assert body["device"] is None and body["loaded_preset"] is None and body["sae_layer"] is None
    assert isinstance(body["torch"], str) and body["torch"]

    monkeypatch.setattr(main, "REGISTRY", _fake_registry("cpu"))
    body = client.get("/health").json()
    assert body["device"] == "cpu"
    assert body["gpu_name"] is None
    assert body["loaded_preset"] == "gpt2-small"
    assert body["sae_layer"] == 8


@pytest.mark.inference
def test_health_reports_real_device(gpt2_client, gpt2_loaded, no_auth_env, monkeypatch):
    body = gpt2_client.get("/health").json()
    import torch

    assert body["torch"] == torch.__version__
    if body["loaded_preset"] == "gpt2-small":
        assert body["device"] == gpt2_loaded.device


def test_health_hf_token_present(client, no_auth_env, monkeypatch):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert client.get("/health").json()["hf_token_present"] is False
    monkeypatch.setenv("HF_TOKEN", "hf_dummy")
    assert client.get("/health").json()["hf_token_present"] is True


# ---------------------------------------------------------------------------
# T15: /load progress
# ---------------------------------------------------------------------------


class _FakeLoadRegistry(ModelRegistry):
    """Registry whose load() replays the real callback order without weights."""

    def __init__(self, cpu_fallback: bool = False) -> None:
        super().__init__()
        self.cpu_fallback = cpu_fallback

    def load(self, preset_id, manifest, on_stage=None):
        if self.cpu_fallback:
            on_stage("cpu_fallback", "cpu")
        on_stage("model_loaded", "cpu")
        loaded = LoadedModel(preset_id, object(), object(), manifest.sae.layer, "cpu")
        self._loaded[preset_id] = loaded
        self._last_loaded = preset_id
        return loaded


def _stub_prefetch(monkeypatch, cached: bool = False):
    from pry_sidecar import prefetch

    monkeypatch.setattr(prefetch, "list_repo_files", lambda repo, token=None, folder=None: (
        {f"{folder}/cfg.json": 100, f"{folder}/sae_weights.safetensors": 4000}
        if folder else {"config.json": 10, "model.safetensors": 9000, "tf_model.h5": 1}
    ))
    monkeypatch.setattr(prefetch, "sae_repo_and_folder", lambda release, sae_id: ("org/sae", "8-x"))
    monkeypatch.setattr(prefetch, "missing_files", lambda repo, files: {} if cached else dict(files))
    downloaded: dict[str, dict] = {}

    def fake_download(repo_id, files, on_bytes, token=None):
        downloaded[repo_id] = files
        total = sum(files.values())
        on_bytes(0, total)
        on_bytes(total // 2, total)
        on_bytes(total, total)

    monkeypatch.setattr(prefetch, "download_files", fake_download)
    return downloaded


def _sse_events(resp) -> list[dict]:
    return [json.loads(line[len("data: "):]) for line in resp.text.splitlines() if line.startswith("data: ")]


def test_load_progress_ordering(client, no_auth_env, monkeypatch):
    monkeypatch.setattr(main, "REGISTRY", _FakeLoadRegistry())
    downloaded = _stub_prefetch(monkeypatch)

    resp = client.post("/load", json={"preset_id": "gpt2-small"})
    assert resp.status_code == 200
    events = _sse_events(resp)
    stages = [e["stage"] for e in events]
    messages = [e["message"] for e in events]

    # Only the transformers files are fetched, not the TF export.
    assert set(downloaded["gpt2"]) == {"config.json", "model.safetensors"}
    assert set(downloaded["org/sae"]) == {"8-x/cfg.json", "8-x/sae_weights.safetensors"}

    byte_events = [e for e in events if "bytes_total" in e]
    assert {e["stage"] for e in byte_events} == {"download_model", "download_sae"}
    assert byte_events[-1]["bytes_downloaded"] == byte_events[-1]["bytes_total"] == 4100

    first = {s: stages.index(s) for s in dict.fromkeys(stages)}
    # The heavy imports are their own first stage, then honest file checks.
    assert stages[0] == "warmup" and messages[0] == "Starting the math libraries…"
    assert first["warmup"] < first["check_files"] < first["download_model"]
    assert first["download_model"] < first["download_sae"] < first["load_model"] < first["load_sae"]
    assert "Checking feature map files…" not in messages
    preparing = messages.index("Loading the feature dictionary…")
    assert stages[preparing] == "load_sae"
    assert messages.index("Loading the model into memory…") < preparing
    # Long steps carry how long they've been running.
    assert all("elapsed_s" in e for e in events if e["stage"] == "warmup")
    assert any(m.startswith("Features ready") for m in messages[preparing + 1:])
    assert stages[-1] == "ready"

    progress = [e["progress"] for e in events]
    assert progress == sorted(progress), "progress must never go backwards"
    for e in events:
        assert "bytes_total" in e or "bytes_downloaded" not in e


def test_load_skips_download_when_cached(client, no_auth_env, monkeypatch):
    monkeypatch.setattr(main, "REGISTRY", _FakeLoadRegistry())
    downloaded = _stub_prefetch(monkeypatch, cached=True)
    events = _sse_events(client.post("/load", json={"preset_id": "pythia-70m"}))
    assert downloaded == {}
    assert not [e for e in events if "bytes_total" in e]
    assert events[-1]["stage"] == "ready"


def test_load_reports_cpu_fallback(client, no_auth_env, monkeypatch):
    monkeypatch.setattr(main, "REGISTRY", _FakeLoadRegistry(cpu_fallback=True))
    _stub_prefetch(monkeypatch, cached=True)
    events = _sse_events(client.post("/load", json={"preset_id": "gpt2-small"}))
    assert main.CPU_FALLBACK_MESSAGE in [e["message"] for e in events]
    assert events[-1]["stage"] == "ready"


def test_load_prefetch_listing_failure_still_loads(client, no_auth_env, monkeypatch):
    from pry_sidecar import prefetch

    monkeypatch.setattr(main, "REGISTRY", _FakeLoadRegistry())

    def offline(*a, **k):
        raise OSError("offline")

    monkeypatch.setattr(prefetch, "list_repo_files", offline)
    monkeypatch.setattr(prefetch, "sae_repo_and_folder", offline)
    events = _sse_events(client.post("/load", json={"preset_id": "gpt2-small"}))
    assert events[-1]["stage"] == "ready"


# ---------------------------------------------------------------------------
# T15: prefetch internals
# ---------------------------------------------------------------------------


def test_select_model_files_prefers_safetensors():
    from pry_sidecar.prefetch import select_model_files

    gpt2_like = {
        "config.json": 1, "generation_config.json": 1, "merges.txt": 1, "vocab.json": 1,
        "tokenizer.json": 1, "tokenizer_config.json": 1, "model.safetensors": 5,
        "pytorch_model.bin": 5, "tf_model.h5": 5, "flax_model.msgpack": 5, "64.tflite": 5,
        "rust_model.ot": 5, "onnx/decoder_model.onnx": 5, "onnx/config.json": 1,
        "README.md": 1, ".gitattributes": 1,
    }
    assert set(select_model_files(gpt2_like)) == {
        "config.json", "generation_config.json", "merges.txt", "vocab.json",
        "tokenizer.json", "tokenizer_config.json", "model.safetensors",
    }
    assert set(select_model_files({"config.json": 1, "pytorch_model.bin": 5})) == {
        "config.json", "pytorch_model.bin",
    }


def test_download_files_reports_bytes_and_disables_hf_transfer(tmp_path, monkeypatch):
    import huggingface_hub
    from huggingface_hub import constants
    from huggingface_hub.file_download import repo_folder_name

    from pry_sidecar import prefetch

    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(tmp_path))
    monkeypatch.setattr(constants, "HF_HUB_ENABLE_HF_TRANSFER", True)
    monkeypatch.setattr(prefetch, "POLL_SECONDS", 0.05)
    blobs = tmp_path / repo_folder_name(repo_id="org/m", repo_type="model") / "blobs"
    seen_flags = []

    def fake_hf_hub_download(repo_id, path, token=None):
        seen_flags.append((constants.HF_HUB_ENABLE_HF_TRANSFER, constants.HF_HUB_DISABLE_XET))
        blobs.mkdir(parents=True, exist_ok=True)
        part = blobs / f"{path}.incomplete"
        with part.open("wb") as f:
            for _ in range(5):
                f.write(b"x" * 200)
                f.flush()
                time.sleep(0.06)
        part.unlink()  # degraded (no-symlink) cache mode: the blob moves away

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", fake_hf_hub_download)
    calls: list[tuple[int, int]] = []
    lock = threading.Lock()

    def on_bytes(done, total):
        with lock:
            calls.append((done, total))

    prefetch.download_files("org/m", {"a.bin": 1000, "b.json": 1000}, on_bytes)

    assert seen_flags == [(False, True), (False, True)]
    assert constants.HF_HUB_ENABLE_HF_TRANSFER is True  # restored
    assert calls[0] == (0, 2000) and calls[-1] == (2000, 2000)
    assert any(0 < d < 2000 for d, _ in calls), calls
    assert [d for d, _ in calls] == sorted(d for d, _ in calls)


# ---------------------------------------------------------------------------
# Rust-lane request: CUDA OOM falls back to CPU
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("oom_on", ["model", "sae"])
def test_registry_oom_falls_back_to_cpu(oom_on, monkeypatch):
    import torch
    from sae_lens import SAE
    from transformer_lens import HookedTransformer

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "empty_cache", lambda: None)
    model_devices: list[str] = []
    sae_devices: list[str] = []

    class FakeModel:
        def __init__(self, device):
            self.cfg = SimpleNamespace(use_attn_result=False, device=device)

        def to(self, device):
            self.cfg.device = device
            return self

    def fake_model(name, device, **kw):
        model_devices.append(device)
        if oom_on == "model" and device == "cuda":
            raise torch.cuda.OutOfMemoryError("CUDA out of memory")
        return FakeModel(device)

    def fake_sae(release, sae_id, device, **kw):
        sae_devices.append(device)
        if oom_on == "sae" and device == "cuda":
            raise torch.cuda.OutOfMemoryError("CUDA out of memory")
        return SimpleNamespace(device=device), {}, None

    monkeypatch.setattr(HookedTransformer, "from_pretrained", fake_model)
    monkeypatch.setattr(SAE, "from_pretrained", fake_sae)

    events: list[tuple[str, str]] = []
    reg = ModelRegistry()
    loaded = reg.load("gpt2-small", PRESETS["gpt2-small"], on_stage=lambda e, d: events.append((e, d)))

    assert loaded.device == "cpu"
    assert loaded.model.cfg.device == "cpu"
    assert loaded.sae.device == "cpu"
    if oom_on == "model":
        assert events == [("cpu_fallback", "cpu"), ("model_loaded", "cpu")]
        assert model_devices == ["cuda", "cpu"] and sae_devices == ["cpu"]
    else:
        assert events == [("model_loaded", "cuda"), ("cpu_fallback", "cpu")]
        assert model_devices == ["cuda"] and sae_devices == ["cuda", "cpu"]

    # /health reports the device actually used.
    monkeypatch.setattr(main, "REGISTRY", reg)
    monkeypatch.delenv("PRY_TOKEN", raising=False)
    with TestClient(main.app) as c:
        assert c.get("/health").json()["device"] == "cpu"


# ---------------------------------------------------------------------------
# T14 validation + T18 endpoints (real GPT-2)
# ---------------------------------------------------------------------------


@pytest.mark.inference
def test_validation_400(gpt2_client, no_auth_env):
    c = gpt2_client
    r = c.post("/dla", json={"preset_id": "gpt2-small", "prompt": "Hello world", "target_token_index": 99})
    assert r.status_code == 400
    assert "out of range" in r.json()["error"]

    r = c.post("/patch", json={
        "preset_id": "gpt2-small", "clean_prompt": IOI_ORIGINAL,
        "corrupted_prompt": IOI_CHANGED, "target_token_index": 99,
    })
    assert r.status_code == 400
    assert "out of range" in r.json()["error"]

    r = c.post("/ablate-head", json={
        "preset_id": "gpt2-small", "prompt": "Hi", "ablations": [{"layer": 0, "head": 40}],
    })
    assert r.status_code == 400 and "Head 40" in r.json()["error"]

    r = c.post("/ablate-head", json={
        "preset_id": "gpt2-small", "prompt": "Hi", "ablations": [{"layer": 30, "head": 0}],
    })
    assert r.status_code == 400 and "Layer 30" in r.json()["error"]

    r = c.post("/steer", json={
        "preset_id": "gpt2-small", "prompt": "Hi", "feature_id": 10_000_000, "sae_layer": 8,
    })
    assert r.status_code == 400 and "out of range" in r.json()["error"]

    # In range still works.
    r = c.post("/dla", json={"preset_id": "gpt2-small", "prompt": "Hello world", "target_token_index": 1})
    assert r.status_code == 200 and r.json()["target_token_index"] == 1


@pytest.mark.inference
def test_tokenize_endpoint(gpt2_client, gpt2_loaded, no_auth_env):
    r = gpt2_client.post("/tokenize", json={"preset_id": "gpt2-small", "text": "Hello world"})
    assert r.status_code == 200
    body = r.json()
    assert body["tokens"] == ["<|endoftext|>", "Hello", " world"]
    assert body["count"] == 3 == gpt2_loaded.model.to_tokens("Hello world").shape[1]

    assert gpt2_client.post("/tokenize", json={"preset_id": "nope", "text": "x"}).status_code == 400
    assert gpt2_client.post("/tokenize", json={"preset_id": "pythia-70m", "text": "x"}).status_code in (200, 409)


@pytest.mark.inference
def test_ioi_default_pair_same_length(gpt2_client, no_auth_env):
    counts = [
        gpt2_client.post("/tokenize", json={"preset_id": "gpt2-small", "text": t}).json()["count"]
        for t in (IOI_ORIGINAL, IOI_CHANGED)
    ]
    assert counts[0] == counts[1]


@pytest.mark.inference
def test_steer_returns_continuation_only(gpt2_client, gpt2_loaded, no_auth_env):
    prompt = "The capital of France is"
    r = gpt2_client.post("/steer", json={
        "preset_id": "gpt2-small", "prompt": prompt, "feature_id": 100,
        "sae_layer": 8, "alpha": 5.0, "max_new_tokens": 6,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["prompt"] == prompt
    for key in ("original_generation", "steered_generation"):
        text = body[key]
        assert text, key
        assert not text.startswith(prompt), key
        assert "<|endoftext|>" not in text, key

    # The continuation is exactly what greedy generation appends to the prompt.
    model = gpt2_loaded.model
    toks = model.to_tokens(prompt)
    full = model.generate(toks, max_new_tokens=6, temperature=0.0, verbose=False)
    assert body["original_generation"] == model.to_string(full[0, toks.shape[1]:])
