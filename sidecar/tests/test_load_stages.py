"""Heartbeat keeps long /load steps visibly alive (no frozen progress)."""

from __future__ import annotations

import time

from pry_sidecar.load_stages import Heartbeat


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
