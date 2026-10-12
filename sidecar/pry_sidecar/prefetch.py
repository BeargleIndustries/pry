"""Pre-fetch a preset's model and SAE files into the HF cache with byte progress.

``/load`` calls this before ``REGISTRY.load``. TransformerLens and SAELens then
resolve everything from the local cache, so the user sees a real MB counter
instead of a frozen bar.

Why poll the disk instead of passing a ``tqdm_class``: at huggingface_hub
0.36.2, ``snapshot_download(tqdm_class=...)`` only drives the "Fetching N
files" counter. The class is not passed to the per-file downloads, so it never
sees bytes. Each file is instead downloaded with ``hf_hub_download`` while a
monitor thread sums the sizes of the ``*.incomplete`` blobs in the repo's cache
folder. That works for every backend (plain HTTP, hf_transfer, hf_xet) and in
both cache modes (symlinked blobs, or Windows' degraded mode, where finished
blobs are moved into ``snapshots/``). See sidecar/README.md, "Load progress".
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Optional

logger = logging.getLogger("pry_sidecar")

# (bytes_downloaded, bytes_total)
ByteCallback = Callable[[int, int], None]

POLL_SECONDS = 0.5

# hf_transfer / xet toggles are process globals, so pre-fetches run one at a time.
_PREFETCH_LOCK = threading.Lock()

_TOKENIZER_AND_CONFIG_SUFFIXES = (".json", ".txt", ".model", ".tiktoken")


def select_model_files(files: dict[str, int]) -> dict[str, int]:
    """Pick the top-level files ``transformers.from_pretrained`` reads.

    Config + tokenizer files, plus safetensors weights when the repo has them
    (transformers prefers them), else the ``.bin`` weights. Skips the TF, Flax,
    ONNX, tflite and rust exports that repos like ``gpt2`` also carry.
    """
    top = {p: s for p, s in files.items() if "/" not in p}
    picked = {p: s for p, s in top.items() if p.endswith(_TOKENIZER_AND_CONFIG_SUFFIXES)}
    safetensors = {p: s for p, s in top.items() if p.endswith(".safetensors")}
    weights = safetensors or {p: s for p, s in top.items() if p.endswith(".bin")}
    picked.update(weights)
    return picked


def sae_repo_and_folder(release: str, sae_id: str) -> tuple[str, str]:
    """Map a SAELens pretrained ``(release, sae_id)`` to ``(repo_id, folder)``.

    Raises KeyError if the release or SAE id isn't in SAELens' directory.
    """
    from sae_lens.toolkit.pretrained_saes_directory import get_pretrained_saes_directory

    entry = get_pretrained_saes_directory()[release]
    return entry.repo_id, entry.saes_map[sae_id]


def list_repo_files(repo_id: str, token: Optional[str] = None, folder: Optional[str] = None) -> dict[str, int]:
    """``{path: size_bytes}`` for every file in the repo (or under ``folder``)."""
    from huggingface_hub import HfApi

    entries = HfApi().list_repo_tree(repo_id, path_in_repo=folder, recursive=True, token=token)
    return {e.path: int(e.size) for e in entries if getattr(e, "size", None) is not None}


def missing_files(repo_id: str, files: dict[str, int]) -> dict[str, int]:
    """The subset of ``files`` that isn't in the local HF cache yet."""
    from huggingface_hub import try_to_load_from_cache

    return {p: s for p, s in files.items() if not isinstance(try_to_load_from_cache(repo_id, p), str)}


def _blobs_dir(repo_id: str) -> Path:
    from huggingface_hub import constants
    from huggingface_hub.file_download import repo_folder_name

    return Path(constants.HF_HUB_CACHE) / repo_folder_name(repo_id=repo_id, repo_type="model") / "blobs"


def _incomplete_bytes(blobs: Path) -> int:
    total = 0
    try:
        for f in blobs.glob("*.incomplete"):
            try:
                total += f.stat().st_size
            except OSError:
                pass  # finished and moved between glob and stat
    except OSError:
        pass
    return total


@contextmanager
def _plain_http_downloads() -> Iterator[None]:
    """Turn hf_transfer and hf_xet off for the pre-fetch, then restore them.

    hf_transfer deletes partial files instead of resuming; both bypass
    huggingface_hub's own progress plumbing. Plain HTTP streams into the
    ``.incomplete`` blob that the monitor watches.
    """
    from huggingface_hub import constants

    saved = (constants.HF_HUB_ENABLE_HF_TRANSFER, constants.HF_HUB_DISABLE_XET)
    constants.HF_HUB_ENABLE_HF_TRANSFER = False
    constants.HF_HUB_DISABLE_XET = True
    try:
        yield
    finally:
        constants.HF_HUB_ENABLE_HF_TRANSFER, constants.HF_HUB_DISABLE_XET = saved


def download_files(
    repo_id: str,
    files: dict[str, int],
    on_bytes: ByteCallback,
    token: Optional[str] = None,
) -> None:
    """Download ``files`` into the HF cache, reporting bytes via ``on_bytes``.

    ``on_bytes`` is called from a monitor thread about every ``POLL_SECONDS``
    while bytes move, and once more with ``(total, total)`` at the end.
    """
    from huggingface_hub import hf_hub_download

    total = sum(files.values())
    blobs = _blobs_dir(repo_id)
    done = 0
    stop = threading.Event()

    def monitor() -> None:
        last = 0
        while not stop.wait(POLL_SECONDS):
            # max(): a file's .incomplete can vanish just before ``done`` is
            # bumped; never let the counter step backwards.
            current = max(last, min(total, done + _incomplete_bytes(blobs)))
            if current != last:
                last = current
                on_bytes(current, total)

    with _PREFETCH_LOCK, _plain_http_downloads():
        on_bytes(0, total)
        watcher = threading.Thread(target=monitor, name=f"prefetch-{repo_id}", daemon=True)
        watcher.start()
        try:
            # Largest last, so the small config/tokenizer files land first.
            for path, size in sorted(files.items(), key=lambda kv: kv[1]):
                hf_hub_download(repo_id, path, token=token)
                done += size
        finally:
            stop.set()
            watcher.join(timeout=2.0)
    on_bytes(total, total)
