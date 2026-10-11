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
| `PRY_TOKEN` | — | Auth token. Set by the Tauri launcher (a new random token on every launch). When set, every request except `OPTIONS` must send it as `X-Pry-Token` |
| `PRY_DISABLE_AUTH` | — | `1` acknowledges running without a token (`npm run dev`). It only silences the startup warning; it is **ignored** when `PRY_TOKEN` is set |
| `HF_TOKEN` | — | Hugging Face token for gated presets (Gemma). Set in the child env by the launcher; `/health` reports only whether it is present |
| `HF_HUB_ENABLE_HF_TRANSFER` | — | `1` enables hf_transfer for downloads made by SAELens/TransformerLens. The `/load` pre-fetch always turns it off (see below) |

## Auth and request rules

The token check is a pure ASGI middleware inside `CORSMiddleware`, so its 403 and 415 responses still carry CORS headers and the UI can read them.

- `OPTIONS` (CORS preflight) is always allowed.
- With `PRY_TOKEN` set, a missing or wrong `X-Pry-Token` gets 403 `{"error": "Pry's engine rejected the request (bad token)."}`. This includes `GET /health`.
- Without `PRY_TOKEN` (tests, a sidecar started by hand) requests are allowed and a warning is logged once, unless `PRY_DISABLE_AUTH=1`.
- A `POST` whose `Content-Type` isn't `application/json` gets 415.

To run against the dev UI: `PRY_DISABLE_AUTH=1 python -m pry_sidecar.main`.

## Startup sentinel

Once the socket is listening, the sidecar prints `READY {port}` to stdout and flushes. The Tauri launcher waits for this line before the frontend makes requests.

## Load progress

`POST /load` first pre-fetches the preset's files into the HF cache, then loads from the cache. The SSE events, in order:

1. `download_model`: model config, tokenizer and weights files. Only the files `transformers` reads are fetched: safetensors if the repo has them, else `.bin`. The TF, Flax, ONNX and tflite exports are skipped.
2. `download_sae`: the SAE folder. The SAELens pretrained directory maps `(release, sae_id)` to a repo and folder, e.g. `ctigges/pythia-70m-deduped__res-sm_processed` + `3-res-sm/`.
3. `load_model` "Loading model weights…", then "Model loaded (GPU|CPU)."
4. `load_sae` "Preparing features…" (before the SAE loads), then "Features ready (layer N)."
5. `ready`.

While files are downloading, `download_*` events also carry `bytes_downloaded` and `bytes_total`; other events omit both fields. If everything is already cached, no byte events are sent. If the file listing fails (offline, Hub down), the pre-fetch is skipped and the load continues from whatever is cached.

If loading on CUDA runs out of memory (a GPU smaller than the preset needs), the load retries on the CPU and emits `load_model` "Your graphics card is too small for this model; running it on the CPU instead (slower)." `/health` then reports `device: "cpu"`.

**How bytes are measured (checked 2026-10-11, huggingface_hub 0.36.2):**
- `snapshot_download(tqdm_class=...)` does **not** report bytes. The class only drives the "Fetching N files" counter and isn't passed to the per-file downloads (see the docstring in `_snapshot_download.py`). Instead, the pre-fetch downloads each file with `hf_hub_download` and polls the size of the repo's `blobs/*.incomplete` files every 0.5 s, plus the sizes of finished files. This works for every download backend, and for Windows' no-symlink cache mode, where finished blobs move into `snapshots/`.
- hf_transfer is installed in the runtime. During the pre-fetch `constants.HF_HUB_ENABLE_HF_TRANSFER` is set to `False` (it doesn't resume, and it deletes partial files) and restored afterwards.
- **Xet:** all four repos are Xet-backed: `gpt2`, `EleutherAI/pythia-70m-deduped`, `jbloom/GPT2-Small-SAEs-Reformatted` and `ctigges/pythia-70m-deduped__res-sm_processed` (`get_hf_file_metadata(...).xet_file_data` is set for each weights file). `hf_xet` is **not** in the runtime constraints, so these downloads fall back to plain HTTP anyway. The pre-fetch also sets `constants.HF_HUB_DISABLE_XET = True` for its duration, so behaviour stays the same if `hf_xet` is installed later, and it silences the "hf_xet not installed" warning.
- Measured with an empty scratch `HF_HOME` and the Pythia layer-3 SAE (134 MB), with `HF_HUB_ENABLE_HF_TRANSFER=1` in the env: 6 byte events in 2.8 s, with the longest gap between events 1.0 s. The counter advanced on a Xet-backed repo over plain HTTP.

## Endpoints

- `GET /health`: `{status, version, device, gpu_name, torch, cuda, loaded_preset, sae_layer, hf_token_present}`. `device` is `"cuda"`, `"cpu"` or `null` (nothing loaded) and reflects the device actually in use. Health never imports torch: before a model loads, `torch` comes from package metadata and `cuda`/`gpu_name` are `null`.
- `GET /models`: loaded presets, plus every preset with its download/VRAM size, SAE layers, whether the model is already in the HF cache, its `display` block and `cpu_ok`.
- `POST /load`: load a preset's model and SAE. Streams progress as server-sent events (see "Load progress").
- `POST /tokenize`: `{preset_id, text}` → `{tokens, count}`. `count` includes the BOS token, so it is the same length `/patch` compares. The preset must be loaded.
- `POST /unload`: free a preset's model and SAE from memory.
- `POST /generate`: run a prompt. Returns tokens, attention for every layer, the top SAE features per token, next-token predictions, and optionally a continuation.
- `POST /sae-features`: switch the SAE to another layer and re-encode the prompt.
- `POST /logit-lens`: the model's best next-token guess at every layer and position.
- `POST /dla`: direct logit attribution, i.e. how much each head and MLP pushes the predicted token.
- `POST /steer`: compare generation with and without adding a feature's direction. The feature must come from the loaded SAE layer. `original_generation` and `steered_generation` hold only the continuation (the prompt is cut at the token level); the response echoes the prompt in `prompt`.
- `POST /ablate-head`: zero attention heads and compare the predictions.
- `POST /ablate-feature`: remove SAE features from the residual stream and compare the predictions. The features must come from the loaded SAE layer.
- `POST /patch`: activation patching from a clean prompt into a corrupted one, per head, MLP, or residual layer.
- `POST /circuit`: the components with the largest DLA scores. Returns no edges (`edges_method: "none"`).
- `POST /head-scores`: `{preset_id, prompt?, top_k=8}` → every head's induction and previous-token score (0-1), plus the top `top_k` of each. The induction score runs a fixed test sequence: 25 seeded random tokens, then the same 25 again (`sequence_tokens`, no BOS). It is the mean attention from each second-copy token to the token that followed its first occurrence. The previous-token score is the mean attention to the token just before, over positions 2 onward of `prompt` or, if omitted, the test sequence. A prompt shorter than two tokens returns 400.
- `GET /feature/{id}`: a feature's Neuronpedia label and top-activating snippets. Covers presets whose `display.neuronpedia_model_id` is set (GPT-2 small and Pythia-70M); the rest return `status: "no_coverage"`.
- `POST /concept-search`: `{query, preset_id?}` → features of the loaded SAE whose Neuronpedia label matches `query` (`feature_id`, `description`, `similarity`, `top_boosted_tokens`), one row per feature. **Sends `query` to neuronpedia.org** via `POST /api/explanation/search` (documented in Neuronpedia's OpenAPI at https://www.neuronpedia.org/api-doc). `query` needs at least 3 characters (400 otherwise). Neuronpedia unreachable → 502 `{"error": "neuronpedia_unavailable", "detail": "<sentence>"}`. Presets without Neuronpedia coverage return `status: "no_coverage"`. Any returned `feature_id` can be passed to `/steer`, which accepts any `0 <= feature_id < d_sae`.

Bad input returns 400 with a plain-language `error` message: a feature from a different layer than the loaded SAE; a feature, layer, or head outside the model; or a `target_token_index` past the end of the prompt (`/dla`, `/patch`). A preset that isn't loaded returns 409.

## Preset metadata

Each preset in `presets.json` has a `display` block (name, blurb, params, size label, layer/head counts, Neuronpedia ids, recommended) and `cpu_ok`. The UI and Rust read these instead of keeping their own maps. Neuronpedia URLs are `https://www.neuronpedia.org/{neuronpedia_model_id}/{layer}-{neuronpedia_release_suffix}/{feature}`.

Neuronpedia ids (checked against the live API on 2026-10-11, and against SAELens' `neuronpedia_id` for each SAE by `test_neuronpedia_ids_match_saelens_directory`):

| Preset | `neuronpedia_model_id` | suffix | Example |
|---|---|---|---|
| gpt2-small | `gpt2-small` | `res-jb` | `gpt2-small/8-res-jb/100` (200) |
| pythia-70m | `pythia-70m-deduped` | `res-sm` | `pythia-70m-deduped/3-res-sm/2` (200, labelled). `pythia-70m/…` returns 404 |
| gemma-2-2b, gemma-2-9b | `null` | `null` | Not set until T31 picks the Gemma Scope SAE width |
