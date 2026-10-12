"""Heartbeat keeps long /load steps visibly alive (no frozen progress)."""

from __future__ import annotations

import json
import threading
import time

import pytest
from starlette.testclient import TestClient

from pry_sidecar import main
from pry_sidecar import registry as registry_mod
from pry_sidecar.load_stages import Heartbeat
from pry_sidecar.registry import LoadedModel, ModelRegistry


def test_heartbeat_sends_now_then_repeats_with_elapsed_until_stopped():
    events: list[tuple] = []

    def push(stage, progress, message, b=None, t=None, elapsed_s=None):
        events.append((stage, progress, message, elapsed_s))

    with Heartbeat(push, "warmup", 0.05, "Starting the math libraries…", interval=0.05):
        time.sleep(0.23)
    count = len(events)
    time.sleep(0.15)

    assert events[0][:3] == ("warmup", 0.05, "Starting the math libraries…")
    assert count >= 3, events
    assert len(events) == count, "kept beating after stop"
    elapsed = [e[3] for e in events]
    assert elapsed == sorted(elapsed) and elapsed[-1] > 0


def test_heartbeat_stop_from_another_callback_is_safe():
    events: list = []
    beat = Heartbeat(lambda *a: events.append(a), "load_model", 0.58, "Reading…", interval=0.05).start()
    time.sleep(0.12)
    beat.stop()
    beat.stop()  # idempotent
    n = len(events)
    time.sleep(0.12)
    assert len(events) == n


# ---------------------------------------------------------------------------
# /load worker: heartbeat cleanup (code:D2) and one load per preset (code:D3)
# ---------------------------------------------------------------------------


class _QuietLoadRegistry(ModelRegistry):
    """load() returns like the "already loaded" fast path: no on_stage calls."""

    def __init__(self, quiet: bool = True) -> None:
        super().__init__()
        self.quiet = quiet
        self.is_loaded_calls = 0

    def is_loaded(self, preset_id):  # the /load fast path never fires
        self.is_loaded_calls += 1
        return False

    def load(self, preset_id, manifest, on_stage=None):
        if not self.quiet:
            on_stage("model_loaded", "cpu")
        loaded = LoadedModel(preset_id, object(), object(), manifest.sae.layer, "cpu")
        self._loaded[preset_id] = loaded
        return loaded


def _events(resp) -> list[dict]:
    return [json.loads(line[len("data: "):]) for line in resp.text.splitlines() if line.startswith("data: ")]


def _heartbeats_alive() -> list[str]:
    return [t.name for t in threading.enumerate() if t.name.startswith("heartbeat-") and t.is_alive()]


@pytest.fixture
def load_client(monkeypatch):
    monkeypatch.delenv("PRY_TOKEN", raising=False)
    monkeypatch.delenv("PRY_DISABLE_AUTH", raising=False)
    monkeypatch.setattr(main, "warm_imports", lambda: None)
    monkeypatch.setattr(registry_mod, "hf_token_for", lambda manifest: None)
    with TestClient(main.app) as c:
        yield c


def test_heartbeat_stopped_after_already_loaded(load_client, monkeypatch):
    monkeypatch.setattr(main, "REGISTRY", _QuietLoadRegistry())
    monkeypatch.setattr(main, "_prefetch_preset", lambda manifest, push: None)

    for _ in range(2):
        r = load_client.post("/load", json={"preset_id": "gpt2-small"})
        assert _events(r)[-1]["stage"] == "ready"

    deadline = time.monotonic() + 3.0
    while _heartbeats_alive() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert _heartbeats_alive() == []


def test_concurrent_load_prefetches_once(load_client, monkeypatch):
    reg = _QuietLoadRegistry(quiet=False)
    monkeypatch.setattr(main, "REGISTRY", reg)
    prefetches: list[str] = []

    def slow_prefetch(manifest, push):
        prefetches.append(manifest.model.tl_name)
        # Hold the first load open until the second request has arrived.
        deadline = time.monotonic() + 5.0
        while reg.is_loaded_calls < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(0.3)

    monkeypatch.setattr(main, "_prefetch_preset", slow_prefetch)

    results: list[list[dict]] = []

    def go():
        results.append(_events(load_client.post("/load", json={"preset_id": "gpt2-small"})))

    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)

    assert len(results) == 2
    assert all(ev[-1]["stage"] == "ready" for ev in results), results
    assert len(prefetches) == 1


def test_failed_load_does_not_block_next_load(load_client, monkeypatch):
    monkeypatch.setattr(main, "REGISTRY", _QuietLoadRegistry(quiet=False))
    calls = {"n": 0}

    def flaky_prefetch(manifest, push):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("simulated network failure")

    monkeypatch.setattr(main, "_prefetch_preset", flaky_prefetch)

    first = _events(load_client.post("/load", json={"preset_id": "gpt2-small"}))
    assert first[-1]["stage"] == "error"
    second = _events(load_client.post("/load", json={"preset_id": "gpt2-small"}))
    assert second[-1]["stage"] == "ready"
    assert calls["n"] == 2
