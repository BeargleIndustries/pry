"""Pry sidecar — Starlette HTTP server.

Endpoints:
    GET  /health
    GET  /models
    POST /load          (SSE progress stream)
    POST /generate
    GET  /feature/{feature_id}

Startup: prints "READY {port}" to stdout so the Tauri launcher knows we're up.

Run standalone (dev):
    uv run uvicorn pry_sidecar.main:app --reload

Or directly:
    uv run python -m pry_sidecar.main
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from pydantic import ValidationError
from sse_starlette.sse import EventSourceResponse
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
    LoadProgressEvent,
    LoadRequest,
    LogitLensRequest,
    PatchRequest,
    SAEFeaturesRequest,
    SteerRequest,
    UnloadRequest,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _json(data: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(content=data, status_code=status)


def _error(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse(content={"error": msg}, status_code=status)


# ---------------------------------------------------------------------------
# Endpoint handlers
# ---------------------------------------------------------------------------


async def health(request: Request) -> JSONResponse:
    """GET /health — liveness probe."""
    return _json({"status": "ok", "version": __version__})


async def models(request: Request) -> JSONResponse:
    """GET /models — loaded models + available presets."""
    loaded = REGISTRY.get_loaded()
    available = [
        {
            "id": p.id,
            "tier": p.tier,
            "enabled": p.enabled,
            "downloaded": False,  # TODO: check HF cache
            "total_download_mb": p.total_download_mb,
            "vram_estimate_mb": p.vram_estimate_mb,
            "license_gate": p.license_gate,
            "available_sae_layers": p.available_sae_layers,
            "default_sae_layer": p.sae.layer,
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

    # Raw SSE via Starlette's StreamingResponse — bypasses sse-starlette
    # entirely. The earlier attempts to use EventSourceResponse (both the
    # naive yield-before-await pattern AND a queue-based worker refactor)
    # both resulted in the frontend hanging on the first request even
    # though the load completed server-side. Cutting out the middleware
    # gives us deterministic byte-level control over the response stream.

    def sse_line(stage: str, progress: float, message: str) -> bytes:
        data = LoadProgressEvent(
            stage=stage,  # type: ignore[arg-type]
            progress=progress,
            message=message,
        ).model_dump_json()
        return f"data: {data}\n\n".encode("utf-8")

    async def byte_stream():
        # Fast-path: preset already loaded.
        if REGISTRY.is_loaded(req.preset_id):
            yield sse_line("already_loaded", 1.0, f"Preset '{req.preset_id}' already loaded.")
            return

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def push(stage: str, progress: float, message: str) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, (stage, progress, message))

        def worker() -> None:
            try:
                push("download_model", 0.05, f"Preparing model {manifest.model.tl_name}...")
                push("load_model", 0.25, "Loading model weights (this may take a while)...")
                loaded = REGISTRY.load(req.preset_id, manifest)
                push("load_model", 0.55, f"Model on device: {loaded.device}")
                push("download_sae", 0.65, f"Preparing SAE {manifest.sae.release}...")
                push("load_sae", 0.85, f"SAE loaded at layer {loaded.sae_layer}.")
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
                stage, progress, message = item
                yield sse_line(stage, progress, message)
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

    try:
        from pry_sidecar.inference import run_generate

        response = await asyncio.to_thread(run_generate, req, loaded)
        return _json(response.model_dump())
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

    try:
        from pry_sidecar.inference import run_steer

        response = await asyncio.to_thread(run_steer, req, loaded)
        return _json(response.model_dump())
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

    try:
        from pry_sidecar.inference import run_ablate_features

        response = await asyncio.to_thread(run_ablate_features, req, loaded)
        return _json(response.model_dump())
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

    desc, conf = await asyncio.to_thread(
        fetch_feature_description, neuronpedia_model_id, release_id, feature_id
    )
    snippets = await asyncio.to_thread(
        fetch_top_activating_snippets, neuronpedia_model_id, release_id, feature_id
    )

    resp = FeatureResponse(
        feature_id=feature_id,
        description=desc,
        confidence=conf,  # type: ignore[arg-type]
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
    Route("/circuit", circuit, methods=["POST"]),
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
