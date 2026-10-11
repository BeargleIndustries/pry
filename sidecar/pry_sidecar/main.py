"""Pry sidecar — Starlette HTTP server.

Endpoints: see sidecar/README.md (full list in `routes` below).

Startup: prints "READY {port}" to stdout so the Tauri launcher knows we're up.

Run standalone (dev):
    uv run uvicorn pry_sidecar.main:app --reload

Or directly:
    uv run python -m pry_sidecar.main
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import sys
from contextlib import asynccontextmanager

import uvicorn
from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

# M4 fix: configure a module-level logger so exceptions leave a trail.
logger = logging.getLogger("pry_sidecar")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)

from pry_sidecar import __version__
from pry_sidecar.presets import PRESETS
from pry_sidecar.registry import REGISTRY
from pry_sidecar.schemas import (
    AblateFeatureRequest,
    AblateHeadRequest,
    ActivatingSnippet,
    CircuitRequest,
    DLARequest,
    FeatureResponse,
    GenerateRequest,
    HeadScoresRequest,
    LoadProgressEvent,
    LoadRequest,
    LogitLensRequest,
    PatchRequest,
    SAEFeaturesRequest,
    SteerRequest,
    TokenizeRequest,
    UnloadRequest,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _json(data: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(content=data, status_code=status)


def _error(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse(content={"error": msg}, status_code=status)


def _hf_downloaded(hf_id: str) -> bool:
    """True if the model's config.json is already in the local HF cache."""
    try:
        from huggingface_hub import try_to_load_from_cache

        return isinstance(try_to_load_from_cache(hf_id, "config.json"), str)
    except Exception:
        return False


CPU_FALLBACK_MESSAGE = (
    "Your graphics card is too small for this model; running it on the CPU instead (slower)."
)


def _device_label(device: str) -> str:
    return "GPU" if device == "cuda" else "CPU"


def _prefetch_preset(manifest, push) -> None:
    """Download the preset's model + SAE files with byte progress (T15).

    If the file listing fails (offline, Hub down) the pre-fetch is skipped and
    the load proceeds from whatever is cached; a failure mid-download raises.
    """
    from pry_sidecar import prefetch

    token = os.environ.get("HF_TOKEN") if manifest.license_gate else None

    def fetch(stage: str, lo: float, hi: float, label: str, repo_id: str, files: dict) -> None:
        missing = prefetch.missing_files(repo_id, files)
        if not missing:
            push(stage, hi, f"{label} already downloaded.")
            return

        def on_bytes(done: int, total: int) -> None:
            frac = done / total if total else 1.0
            push(
                stage,
                lo + (hi - lo) * frac,
                f"Downloading {label.lower()}… {done / 1e6:.0f} of {total / 1e6:.0f} MB",
                done,
                total,
            )

        prefetch.download_files(repo_id, missing, on_bytes, token=token)

    push("download_model", 0.02, f"Checking model files for {manifest.display.name}…")
    try:
        model_files = prefetch.select_model_files(
            prefetch.list_repo_files(manifest.model.hf_id, token=token)
        )
    except Exception as exc:
        logger.warning("model pre-fetch skipped for %s: %s", manifest.model.hf_id, exc)
    else:
        fetch("download_model", 0.02, 0.40, "Model", manifest.model.hf_id, model_files)

    sae_id = f"blocks.{manifest.sae.layer}.{manifest.sae.hook}"
    push("download_sae", 0.40, "Checking feature map files…")
    try:
        repo_id, folder = prefetch.sae_repo_and_folder(manifest.sae.release, sae_id)
        sae_files = prefetch.list_repo_files(repo_id, token=token, folder=folder)
    except Exception as exc:
        logger.warning("SAE pre-fetch skipped for %s@%s: %s", manifest.sae.release, sae_id, exc)
    else:
        fetch("download_sae", 0.40, 0.55, "Feature map", repo_id, sae_files)


def _check_layer(loaded, layer: int) -> str | None:
    """Plain-language error if ``layer`` is outside the loaded model."""
    n_layers = int(getattr(loaded.model.cfg, "n_layers", 0)) if loaded.model is not None else 0
    if not 0 <= layer < n_layers:
        return f"Layer {layer} is out of range; this model has layers 0-{n_layers - 1}."
    return None


def _check_sae_feature(loaded, layer: int, feature_id: int) -> str | None:
    """Plain-language error if the feature can't be used with the loaded SAE.

    The loaded SAE is trained for ``loaded.sae_layer`` only, so a feature
    from any other layer would be decoded with the wrong dictionary.
    """
    err = _check_layer(loaded, layer)
    if err:
        return err
    if layer != loaded.sae_layer:
        from pry_sidecar.inference import _layer_mismatch_msg

        return _layer_mismatch_msg(layer, loaded.sae_layer)
    d_sae = int(loaded.sae.cfg.d_sae) if loaded.sae is not None else 0
    if not 0 <= feature_id < d_sae:
        return f"Feature {feature_id} is out of range; this feature map has features 0-{d_sae - 1}."
    return None


# ---------------------------------------------------------------------------
# Endpoint handlers
# ---------------------------------------------------------------------------


def _torch_version() -> str | None:
    """Installed torch version, read from package metadata (no import)."""
    try:
        from importlib.metadata import version

        return version("torch")
    except Exception:
        return None


async def health(request: Request) -> JSONResponse:
    """GET /health — liveness probe plus engine status (contract §4).

    Stays instant at startup: torch is only consulted if something already
    imported it (i.e. a model has been loaded), never imported here.
    """
    preset_id = REGISTRY.last_loaded
    loaded = REGISTRY.get(preset_id) if preset_id is not None else None
    torch = sys.modules.get("torch")

    device = loaded.device if loaded is not None else None
    gpu_name = None
    if device == "cuda" and torch is not None:
        try:
            gpu_name = torch.cuda.get_device_name(0)
        except Exception:
            gpu_name = None
    cuda = getattr(getattr(torch, "version", None), "cuda", None) if torch is not None else None

    return _json({
        "status": "ok",
        "version": __version__,
        "device": device,
        "gpu_name": gpu_name,
        "torch": torch.__version__ if torch is not None else _torch_version(),
        "cuda": cuda,
        "loaded_preset": preset_id if loaded is not None else None,
        "sae_layer": loaded.sae_layer if loaded is not None else None,
        "hf_token_present": bool(os.environ.get("HF_TOKEN")),
    })


async def models(request: Request) -> JSONResponse:
    """GET /models — loaded models + available presets."""
    loaded = REGISTRY.get_loaded()
    available = [
        {
            "id": p.id,
            "tier": p.tier,
            "enabled": p.enabled,
            "downloaded": _hf_downloaded(p.model.hf_id),
            "total_download_mb": p.total_download_mb,
            "vram_estimate_mb": p.vram_estimate_mb,
            "license_gate": p.license_gate,
            "available_sae_layers": p.available_sae_layers,
            "default_sae_layer": p.sae.layer,
            "display": p.display.model_dump(),
            "cpu_ok": p.cpu_ok,
        }
        for p in PRESETS.values()
    ]
    return _json({
        "loaded": loaded,
        "active": REGISTRY.last_loaded,
        "available": available,
    })


async def load(request: Request) -> Response:
    """POST /load — load a preset, stream SSE progress events.

    Loads model + SAE synchronously in a worker thread so the event loop
    stays responsive. Emits stage events before/after each step.
    """
    try:
        body_bytes = await request.body()
        req = LoadRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return JSONResponse(
            {"error": "validation_error", "detail": f"Unknown preset: {req.preset_id!r}"},
            status_code=400,
        )

    manifest = PRESETS[req.preset_id]

    # Raw SSE via Starlette's StreamingResponse, with no SSE helper library.
    # The earlier attempts to use EventSourceResponse (both the
    # naive yield-before-await pattern AND a queue-based worker refactor)
    # both resulted in the frontend hanging on the first request even
    # though the load completed server-side. Cutting out the middleware
    # gives us deterministic byte-level control over the response stream.

    def sse_line(
        stage: str,
        progress: float,
        message: str,
        bytes_downloaded: int | None = None,
        bytes_total: int | None = None,
    ) -> bytes:
        data = LoadProgressEvent(
            stage=stage,  # type: ignore[arg-type]
            progress=progress,
            message=message,
            bytes_downloaded=bytes_downloaded,
            bytes_total=bytes_total,
        ).model_dump_json(exclude_none=True)
        return f"data: {data}\n\n".encode("utf-8")

    async def byte_stream():
        # Fast-path: preset already loaded.
        if REGISTRY.is_loaded(req.preset_id):
            yield sse_line("already_loaded", 1.0, f"Preset '{req.preset_id}' already loaded.")
            return

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def push(
            stage: str,
            progress: float,
            message: str,
            bytes_downloaded: int | None = None,
            bytes_total: int | None = None,
        ) -> None:
            loop.call_soon_threadsafe(
                queue.put_nowait, (stage, progress, message, bytes_downloaded, bytes_total)
            )

        def on_stage(event: str, device: str) -> None:
            if event == "cpu_fallback":
                push("load_model", 0.6, CPU_FALLBACK_MESSAGE)
            elif event == "model_loaded":
                push("load_model", 0.8, f"Model loaded ({_device_label(device)}).")
                push("load_sae", 0.82, "Preparing features…")

        def worker() -> None:
            try:
                _prefetch_preset(manifest, push)
                push("load_model", 0.58, "Loading model weights…")
                loaded = REGISTRY.load(req.preset_id, manifest, on_stage=on_stage)
                push("load_sae", 0.97, f"Features ready (layer {loaded.sae_layer}).")
                push("ready", 1.0, f"Preset '{req.preset_id}' ready.")
            except Exception as exc:
                logger.exception("load failed for preset %r", req.preset_id)
                push("error", 0.0, f"Load failed: {exc}")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

        task = asyncio.create_task(asyncio.to_thread(worker))

        try:
            # Keep-alive comment right away so the client sees SOME bytes
            # and confirms the stream is open. This also forces the
            # framework to flush the response headers before we start
            # waiting on the queue.
            yield b": open\n\n"
            while True:
                item = await queue.get()
                if item is None:
                    break
                stage = item[0]
                yield sse_line(*item)
                if stage in ("ready", "error"):
                    break
        finally:
            if not task.done():
                try:
                    await asyncio.wait_for(task, timeout=1.0)
                except asyncio.TimeoutError:
                    pass

    return StreamingResponse(
        byte_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Tell intermediaries not to buffer (belt-and-suspenders; we
            # bypass uvicorn's default response buffering below).
            "X-Accel-Buffering": "no",
        },
    )


async def unload(request: Request) -> JSONResponse:
    """POST /unload — free a preset's model + SAE from memory.

    Returns {preset_id, unloaded}. `unloaded` is True iff the preset was
    actually resident and was popped (race-free: computed inside the
    per-preset lock via REGISTRY.unload's new bool return value).
    Clients switching models are expected to call /unload before /load.
    """
    try:
        body_bytes = await request.body()
        req = UnloadRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return JSONResponse(
            {"error": "validation_error", "detail": f"Unknown preset: {req.preset_id!r}"},
            status_code=400,
        )

    try:
        was_loaded = await asyncio.to_thread(REGISTRY.unload, req.preset_id)
    except Exception as e:
        logger.exception("unload failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "unload_error", "detail": str(e)},
            status_code=500,
        )

    return _json({"preset_id": req.preset_id, "unloaded": was_loaded})


async def generate(request: Request) -> JSONResponse:
    """POST /generate — run real inference on a loaded preset."""
    try:
        # H2 fix: use model_validate_json (Pydantic v2 API) consistent with
        # the /load handler. This ensures model_validators(mode="before") on
        # GenerateRequest are applied and avoids double JSON decoding.
        body_bytes = await request.body()
        req = GenerateRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    # H1 fix: fetch LoadedModel once here and pass it directly to run_generate,
    # eliminating the second REGISTRY.get() call inside run_generate. The old
    # pattern had a TOCTOU window where a concurrent unload between the two
    # independent get() calls could produce an AttributeError instead of a 409.
    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    if req.sae_layer is not None:
        err = _check_layer(loaded, req.sae_layer)
        if err:
            return _error(err, status=400)

    try:
        from pry_sidecar.inference import run_generate

        response = await asyncio.to_thread(run_generate, req, loaded)
        return _json(response.model_dump())
    except ValueError as e:
        # SAE layer differs from the loaded feature map
        return _error(str(e), status=400)
    except Exception as e:
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def sae_features(request: Request) -> JSONResponse:
    """POST /sae-features -- re-run SAE at a different layer.
    Returns 409 if preset not loaded (match /generate pattern).
    Returns 400 if layer not in available_sae_layers."""
    try:
        body_bytes = await request.body()
        req = SAEFeaturesRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    manifest = PRESETS[req.preset_id]

    # Validate layer is available for this preset
    if req.sae_layer not in manifest.available_sae_layers:
        return _error(
            f"Layer {req.sae_layer} not available for preset {req.preset_id!r}. "
            f"Available layers: {manifest.available_sae_layers}",
            status=400,
        )

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    try:
        from pry_sidecar.inference import run_sae_features

        response = await asyncio.to_thread(run_sae_features, req, REGISTRY, manifest)
        return _json(response.model_dump())
    except Exception as e:
        logger.exception("sae_features failed for preset %r layer %d", req.preset_id, req.sae_layer)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def logit_lens(request: Request) -> JSONResponse:
    """POST /logit-lens -- run logit lens across all layers."""
    try:
        body_bytes = await request.body()
        req = LogitLensRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    try:
        from pry_sidecar.inference import run_logit_lens

        response = await asyncio.to_thread(run_logit_lens, req, loaded)
        return _json(response.model_dump())
    except Exception as e:
        logger.exception("logit_lens failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def dla(request: Request) -> JSONResponse:
    """POST /dla -- direct logit attribution."""
    try:
        body_bytes = await request.body()
        req = DLARequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    try:
        from pry_sidecar.inference import run_dla

        response = await asyncio.to_thread(run_dla, req, loaded)
        return _json(response.model_dump())
    except ValueError as e:
        # Token position past the end of the prompt
        return _error(str(e), status=400)
    except Exception as e:
        logger.exception("dla failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def steer(request: Request) -> JSONResponse:
    """POST /steer -- feature steering: compare original vs steered generation."""
    try:
        body_bytes = await request.body()
        req = SteerRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    err = _check_sae_feature(loaded, req.sae_layer, req.feature_id)
    if err:
        return _error(err, status=400)

    try:
        from pry_sidecar.inference import run_steer

        response = await asyncio.to_thread(run_steer, req, loaded)
        return _json(response.model_dump())
    except ValueError as e:
        # Layer changed between the check above and taking the lock
        return _error(str(e), status=400)
    except Exception as e:
        logger.exception("steer failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def ablate_head(request: Request) -> JSONResponse:
    """POST /ablate-head -- zero out attention heads and compare predictions."""
    try:
        body_bytes = await request.body()
        req = AblateHeadRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    n_heads = int(getattr(loaded.model.cfg, "n_heads", 0)) if loaded.model is not None else 0
    for abl in req.ablations:
        err = _check_layer(loaded, abl.layer)
        if err:
            return _error(err, status=400)
        if abl.head >= n_heads:
            return _error(
                f"Head {abl.head} is out of range; this model has heads 0-{n_heads - 1}.",
                status=400,
            )

    try:
        from pry_sidecar.inference import run_ablate_heads

        response = await asyncio.to_thread(run_ablate_heads, req, loaded)
        return _json(response.model_dump())
    except Exception as e:
        logger.exception("ablate_head failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def ablate_feature(request: Request) -> JSONResponse:
    """POST /ablate-feature -- zero out SAE features and compare predictions."""
    try:
        body_bytes = await request.body()
        req = AblateFeatureRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    for abl in req.feature_ablations:
        err = _check_sae_feature(loaded, abl.layer, abl.feature_index)
        if err:
            return _error(err, status=400)

    try:
        from pry_sidecar.inference import run_ablate_features

        response = await asyncio.to_thread(run_ablate_features, req, loaded)
        return _json(response.model_dump())
    except ValueError as e:
        # Layer changed between the check above and taking the lock
        return _error(str(e), status=400)
    except Exception as e:
        logger.exception("ablate_feature failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def patch(request: Request) -> JSONResponse:
    """POST /patch -- activation patching between clean and corrupted prompts."""
    try:
        body_bytes = await request.body()
        req = PatchRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    try:
        from pry_sidecar.inference import run_patching

        response = await asyncio.to_thread(run_patching, req, loaded)
        return _json(response.model_dump())
    except ValueError as e:
        # Sequence length mismatch or other validation errors → 400
        return _error(str(e), status=400)
    except Exception as e:
        logger.exception("patch failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def tokenize(request: Request) -> JSONResponse:
    """POST /tokenize -- token strings + count (incl. BOS) for live counters."""
    try:
        req = TokenizeRequest.model_validate_json(await request.body())
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    try:
        from pry_sidecar.inference import run_tokenize

        response = await asyncio.to_thread(run_tokenize, req, loaded)
        return _json(response.model_dump())
    except Exception as e:
        logger.exception("tokenize failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def head_scores(request: Request) -> JSONResponse:
    """POST /head-scores -- score every head as an induction ("copying") head
    and as a previous-token head (T20)."""
    try:
        body_bytes = await request.body()
        req = HeadScoresRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    try:
        from pry_sidecar.inference import run_head_scores

        response = await asyncio.to_thread(run_head_scores, req, loaded)
        return _json(response.model_dump())
    except ValueError as e:
        # Prompt too short to score previous-token heads
        return _error(str(e), status=400)
    except Exception as e:
        logger.exception("head_scores failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def circuit(request: Request) -> JSONResponse:
    """POST /circuit -- build circuit subgraph from DLA or patching results."""
    try:
        body_bytes = await request.body()
        req = CircuitRequest.model_validate_json(body_bytes)
    except ValidationError as e:
        return JSONResponse(
            {"error": "validation_error", "detail": e.errors()},
            status_code=400,
        )
    except Exception as e:
        return JSONResponse(
            {"error": "internal_error", "detail": str(e)},
            status_code=500,
        )

    if req.preset_id not in PRESETS:
        return _error(f"Unknown preset: {req.preset_id!r}", status=400)

    loaded = REGISTRY.get(req.preset_id)
    if loaded is None:
        return _error(f"preset {req.preset_id!r} not loaded; POST /load first", status=409)

    try:
        from pry_sidecar.inference import run_circuit

        response = await asyncio.to_thread(run_circuit, req, loaded)
        return _json(response.model_dump())
    except NotImplementedError as e:
        # source="patching" not yet implemented → 501
        return JSONResponse(
            {"error": "not_implemented", "detail": str(e)},
            status_code=501,
        )
    except Exception as e:
        logger.exception("circuit failed for preset %r", req.preset_id)
        return JSONResponse(
            {"error": "inference_error", "detail": str(e)},
            status_code=500,
        )


async def feature_info(request: Request) -> JSONResponse:
    """GET /feature/{feature_id} — fetch feature description + snippets
    from Neuronpedia using the currently loaded preset's SAE release."""
    try:
        feature_id = int(request.path_params["feature_id"])
    except (KeyError, ValueError):
        return _error("Invalid feature_id")

    # M2 fix: use the most-recently-loaded preset instead of arbitrarily picking
    # loaded_ids[0]. When multiple presets are loaded, loaded_ids[0] is dict
    # insertion order (CPython 3.7+) which may not match the active preset,
    # producing wrong Neuronpedia lookups. last_loaded tracks the most recent
    # successful load(), which is the semantically correct choice here.
    preset_id = REGISTRY.last_loaded
    if preset_id is None or not REGISTRY.is_loaded(preset_id):
        return _error("no preset loaded; POST /load first", status=409)
    manifest = PRESETS[preset_id]
    # N1 fix: skip is_loaded() pre-check to avoid TOCTOU — just get() directly
    # and fall back to manifest layer if the model was concurrently unloaded.
    loaded = REGISTRY.get(preset_id)
    sae_layer = loaded.sae_layer if loaded is not None else manifest.sae.layer

    from pry_sidecar.inference import (
        LABEL_DETAIL,
        fetch_feature_description,
        fetch_top_activating_snippets,
    )

    # H2 fix: derive Neuronpedia ids from preset manifest instead of hardcoding.
    # Returns None for non-GPT-2 presets (pythia, gemma) that have no coverage.
    neuronpedia_model_id = manifest.neuronpedia_model_id
    release_id = manifest.neuronpedia_release_id(sae_layer)

    if neuronpedia_model_id is None or release_id is None:
        # Preset has no Neuronpedia coverage — return empty rather than garbage.
        return _json(
            FeatureResponse(
                feature_id=feature_id,
                description=None,
                confidence="none",
                top_activating_snippets=[],
                status="no_coverage",
            ).model_dump()
        )

    desc, bucket = await asyncio.to_thread(
        fetch_feature_description, neuronpedia_model_id, release_id, feature_id
    )
    snippets = await asyncio.to_thread(
        fetch_top_activating_snippets, neuronpedia_model_id, release_id, feature_id
    )

    resp = FeatureResponse(
        feature_id=feature_id,
        description=desc,
        label_detail=LABEL_DETAIL.get(bucket, "none"),  # type: ignore[arg-type]
        confidence=bucket,  # type: ignore[arg-type]  # deprecated alias
        top_activating_snippets=[
            ActivatingSnippet(snippet=s, activation=0.0) for s in snippets
        ],
        status="ok",
    )
    return _json(resp.model_dump())


# ---------------------------------------------------------------------------
# App + routing
# ---------------------------------------------------------------------------

routes = [
    Route("/health", health, methods=["GET"]),
    Route("/models", models, methods=["GET"]),
    Route("/load", load, methods=["POST"]),
    Route("/unload", unload, methods=["POST"]),
    Route("/generate", generate, methods=["POST"]),
    Route("/sae-features", sae_features, methods=["POST"]),
    Route("/logit-lens", logit_lens, methods=["POST"]),
    Route("/dla", dla, methods=["POST"]),
    Route("/steer", steer, methods=["POST"]),
    Route("/ablate-head", ablate_head, methods=["POST"]),
    Route("/ablate-feature", ablate_feature, methods=["POST"]),
    Route("/patch", patch, methods=["POST"]),
    Route("/tokenize", tokenize, methods=["POST"]),
    Route("/circuit", circuit, methods=["POST"]),
    Route("/head-scores", head_scores, methods=["POST"]),
    Route("/feature/{feature_id:int}", feature_info, methods=["GET"]),
]

@asynccontextmanager
async def lifespan(app):
    """Uvicorn lifespan hook — no-op. The READY sentinel is emitted from
    `PryServer.startup()` below, which runs AFTER the listening socket has
    actually been bound (C1 fix).
    """
    yield


# CORS middleware — the Tauri webview loads from `http://tauri.localhost`
# (custom protocol) while the sidecar listens on `http://127.0.0.1:<random>`.
# Cross-origin fetches from the webview hit a preflight that needs explicit
# allow headers. Loopback-only so wildcard origin is safe.
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

BAD_TOKEN_MESSAGE = "Pry's engine rejected the request (bad token)."


class TokenAuthMiddleware:
    """Local auth token + content-type gate (contract §3), as pure ASGI.

    Registered after CORSMiddleware, so it runs *inside* it and CORS headers
    are still added to its 403/415 responses.

    - OPTIONS (CORS preflight) is always let through.
    - With ``PRY_TOKEN`` set, every other request needs a matching
      ``X-Pry-Token`` header, else 403. ``PRY_DISABLE_AUTH`` is ignored.
    - Without ``PRY_TOKEN`` (tests, ``npm run dev``) requests are allowed;
      a warning is logged once unless ``PRY_DISABLE_AUTH=1`` says it's intended.
    - A POST whose content type isn't ``application/json`` gets 415.

    The env is read per request so tests can monkeypatch it.
    """

    def __init__(self, app) -> None:
        self.app = app
        self._warned = False

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        expected = os.environ.get("PRY_TOKEN")
        if expected:
            given = headers.get(b"x-pry-token", b"").decode("latin-1")
            if not hmac.compare_digest(given.encode(), expected.encode()):
                await JSONResponse({"error": BAD_TOKEN_MESSAGE}, status_code=403)(scope, receive, send)
                return
        elif os.environ.get("PRY_DISABLE_AUTH") != "1" and not self._warned:
            self._warned = True
            logger.warning(
                "PRY_TOKEN is not set: the sidecar is accepting requests without a token. "
                "Set PRY_DISABLE_AUTH=1 to acknowledge this for local development."
            )

        if scope["method"] == "POST":
            content_type = headers.get(b"content-type", b"").decode("latin-1")
            if content_type.split(";")[0].strip().lower() != "application/json":
                await JSONResponse(
                    {"error": "Pry's engine only accepts JSON requests (Content-Type: application/json)."},
                    status_code=415,
                )(scope, receive, send)
                return

        await self.app(scope, receive, send)


middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=[
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    ),
    # Listed after CORS, so it sits inside it (403s keep their CORS headers).
    Middleware(TokenAuthMiddleware),
]

app = Starlette(routes=routes, lifespan=lifespan, middleware=middleware)

# ---------------------------------------------------------------------------
# Direct run
# ---------------------------------------------------------------------------


def _silence_proactor_connection_reset(loop, context):
    """Asyncio exception handler that drops the specific ConnectionResetError
    that fires on every closed proactor transport on Windows.

    The Rust-side heartbeat polls /health every 2 seconds with a fresh
    reqwest::Client, so each ping opens and closes a new TCP connection.
    Python's ProactorBasePipeTransport._call_connection_lost then calls
    `socket.shutdown(SHUT_RDWR)` on an already-closed socket and logs a
    traceback via the default asyncio exception handler — hundreds of times
    per minute. The event loop gets buried running the handler for each of
    those, which starves every other coroutine (including the /load SSE
    generator that yields `ready` events back to the frontend). Result:
    frontend hangs forever on "Starting download..." while the model is
    actually already loaded in memory.

    We filter ONLY the specific `_call_connection_lost` + ConnectionResetError
    pair — everything else falls through to the default handler.
    """
    exc = context.get("exception")
    if isinstance(exc, ConnectionResetError):
        msg = context.get("message", "")
        if "_call_connection_lost" in msg or "connection_lost" in msg:
            return
    loop.default_exception_handler(context)


class PryServer(uvicorn.Server):
    """C1 fix: Uvicorn's Starlette lifespan startup phase runs BEFORE the
    listening socket is opened, so a READY sentinel emitted from `lifespan`
    can race the Tauri launcher into `ECONNREFUSED`. Subclassing `Server`
    and overriding `startup` lets us print READY only after
    `super().startup()` returns — at which point `self.servers` exists and
    the socket is accepting connections.
    """

    async def startup(self, sockets=None):  # type: ignore[override]
        await super().startup(sockets=sockets)
        # Install the asyncio exception filter AFTER uvicorn has set up the
        # default handler. Filters the heartbeat connection-reset storm that
        # would otherwise starve the event loop.
        import asyncio
        asyncio.get_running_loop().set_exception_handler(
            _silence_proactor_connection_reset
        )
        port = int(os.environ.get("PRY_PORT", "8765"))
        # Stdout, not logging, so the Tauri parent reads it reliably.
        print(f"READY {port}", flush=True)


def _run() -> None:
    port = int(os.environ.get("PRY_PORT", "8765"))
    # M4 fix: pass app object directly instead of string import path to avoid
    # double-import of the module (which re-runs _load_presets() and the logger
    # setup block). The string form is only needed for uvicorn --reload mode;
    # in production/managed runtime we never use --reload.
    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=port,
        log_level="info",
    )
    server = PryServer(config=config)
    server.run()


if __name__ == "__main__":
    _run()
