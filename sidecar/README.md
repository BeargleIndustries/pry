# Pry Sidecar

Python HTTP sidecar for the Pry interpretability app. Spawned by the Tauri shell; exposes TransformerLens + SAELens endpoints on localhost.

## Dev setup (pip + CPU torch)

```bash
cd sidecar
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[dev]"
```

Install CPU torch first, from the CPU index, so the second step doesn't pull a CUDA build. Use the CUDA index instead if you want GPU inference.

Run the server:

```bash
python -m pry_sidecar.main                      # listens on PRY_PORT (default 8765)
uvicorn pry_sidecar.main:app --reload           # auto-reload while editing
```

## Tests

```bash
python -m pytest -q -W ignore                   # everything
python -m pytest -q -W ignore -m inference      # only tests that run real models on CPU
python -m pytest -q -W ignore -m "not inference"  # fast schema-only tests
```

Inference tests load real weights from the local Hugging Face cache and skip when a model isn't cached. GPT-2 small plus the `gpt2-small-res-jb` SAE cover most tests. The Pythia tests also need `pythia-70m-deduped` and its `pythia-70m-deduped-res-sm` SAEs (about 150 MB). Loading the Pythia preset once caches them.

## Smoketests

```bash
python scripts/smoketest_bet1_tl_gpt2.py        # TransformerLens + GPT-2 attention (add --cpu to force CPU)
python scripts/smoketest_bet2_saelens_gpt2.py   # SAELens + GPT-2 SAE + Neuronpedia
```

The first run downloads GPT-2 small (~500 MB) and its SAE (~100 MB) from Hugging Face.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRY_PORT` | `8765` | Port the sidecar listens on |
| `PRY_PRESETS_PATH` | — | Explicit path to `presets.json` |
| `HF_HUB_ENABLE_HF_TRANSFER` | — | Set to `1` to enable fast transfers |

## Startup sentinel

Once the socket is listening, the sidecar prints `READY {port}` to stdout and flushes. The Tauri launcher waits for this line before the frontend makes requests.

## Endpoints

- `GET /health`: liveness check and sidecar version.
- `GET /models`: loaded presets, plus every preset with its download/VRAM size, SAE layers, and whether the model is already in the HF cache.
- `POST /load`: load a preset's model and SAE. Streams progress as server-sent events.
- `POST /unload`: free a preset's model and SAE from memory.
- `POST /generate`: run a prompt. Returns tokens, attention for every layer, the top SAE features per token, next-token predictions, and optionally a continuation.
- `POST /sae-features`: switch the SAE to another layer and re-encode the prompt.
- `POST /logit-lens`: the model's best next-token guess at every layer and position.
- `POST /dla`: direct logit attribution, i.e. how much each head and MLP pushes the predicted token.
- `POST /steer`: compare generation with and without adding a feature's direction. The feature must come from the loaded SAE layer.
- `POST /ablate-head`: zero attention heads and compare the predictions.
- `POST /ablate-feature`: remove SAE features from the residual stream and compare the predictions. The features must come from the loaded SAE layer.
- `POST /patch`: activation patching from a clean prompt into a corrupted one, per head, MLP, or residual layer.
- `POST /circuit`: the components with the largest DLA scores. Returns no edges (`edges_method: "none"`).
- `GET /feature/{id}`: a feature's Neuronpedia label and top-activating snippets (GPT-2 only).

Bad input returns 400 with a plain-language `error` message: a feature from a different layer than the loaded SAE, or a feature, layer, or head outside the model. A preset that isn't loaded returns 409.
