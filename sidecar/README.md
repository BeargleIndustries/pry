# Pry Sidecar

Python HTTP sidecar for the Pry interpretability app. Spawned by the Tauri shell; exposes TransformerLens + SAELens endpoints on localhost.

## Dev usage

```bash
uv sync
uv run uvicorn pry_sidecar.main:app --reload
```

## Smoketests (run these first)

```bash
# Bet 1 — TransformerLens + GPT-2 small attention extraction
uv run python scripts/smoketest_bet1_tl_gpt2.py

# Force CPU (no GPU)
uv run python scripts/smoketest_bet1_tl_gpt2.py --cpu

# Bet 2 — SAELens + Joseph Bloom GPT-2 SAE + Neuronpedia
uv run python scripts/smoketest_bet2_saelens_gpt2.py
```

**First run downloads GPT-2 small (~500MB) and the Bloom SAE (~100MB) from HuggingFace.**

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRY_PORT` | `8765` | Port the sidecar listens on |
| `HF_HUB_ENABLE_HF_TRANSFER` | — | Set to `1` to enable fast transfers |

## Startup sentinel

On startup the sidecar prints `READY {port}` to stdout and flushes. The Tauri launcher waits for this line before allowing the frontend to make requests.

## Endpoints

- `GET /health` — liveness check
- `GET /models` — loaded models + available presets
- `POST /load` — load a preset (SSE progress stream)
- `POST /generate` — run inference (stub in Phase 1)
- `POST /feature/{feature_id}` — fetch feature info (stub in Phase 1)
