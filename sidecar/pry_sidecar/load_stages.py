"""Honest, never-frozen /load progress.

Most of a load is two long steps that report no progress of their own:
importing PyTorch + TransformerLens (12-40 s; the first load after a reboot is
the slow one) and reading the model's weights (~14 s for Gemma 2 2B). A
``Heartbeat`` re-sends the current stage once a second with the elapsed time,
so the UI can show that work is happening and animate an estimate instead of
sitting on one number.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, Optional

# push(stage, progress, message, bytes_downloaded, bytes_total, elapsed_s)
Push = Callable[..., None]

HEARTBEAT_SECONDS = 1.0


class Heartbeat:
    """Send ``stage`` now and then every ``interval`` s until stopped."""

    def __init__(
        self,
        push: Push,
        stage: str,
        progress: float,
        message: str,
        interval: float = HEARTBEAT_SECONDS,
    ) -> None:
        self._push = push
        self._stage = stage
        self._progress = progress
        self._message = message
        self._interval = interval
        self._stop = threading.Event()
        self._start = time.perf_counter()
        self._thread: Optional[threading.Thread] = None

    def elapsed(self) -> float:
        return round(time.perf_counter() - self._start, 1)

    def _beat(self) -> None:
        self._push(self._stage, self._progress, self._message, None, None, self.elapsed())

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            self._beat()

    def start(self) -> "Heartbeat":
        self._start = time.perf_counter()
        self._beat()
        self._thread = threading.Thread(target=self._run, name=f"heartbeat-{self._stage}", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=2)

    def __enter__(self) -> "Heartbeat":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()


def warm_imports() -> None:
    """Import the heavy libraries a load needs, so that cost is its own stage."""
    import torch  # noqa: F401
    import transformer_lens  # noqa: F401
    import sae_lens  # noqa: F401
