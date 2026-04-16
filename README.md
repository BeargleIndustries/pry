# Pry

Pry open the black box. A local-first desktop app for exploring what small transformer LLMs are doing inside -- no code required.

![Pry screenshot](docs/screenshot.png)

## Features

- **Attention visualization** -- per-head heatmaps with automatic pattern detection
- **SAE feature explorer** -- top-activating examples, feature search, layer selection
- **Logit lens** -- layer-by-layer token predictions showing how the model refines its output
- **Direct Logit Attribution (DLA)** -- decompose each component's contribution to the final logits
- **Activation steering** -- inject scaled direction vectors and see how outputs change
- **Ablation** -- zero or mean ablation per head or layer to test what matters
- **Activation patching** -- causal interventions to isolate which components carry specific information
- **Circuit discovery** -- automated path tracing to find computational subgraphs
- **Driven tutorial** -- guided walkthrough of interpretability concepts built right into the app
- **Contextual tooltips** -- hover help throughout so you're never lost

## Supported Models

- GPT-2 Small
- Pythia-70M

Gemma-2B and Gemma-9B support is planned.

## System Requirements

- Windows 10 or later
- NVIDIA GPU with 4+ GB VRAM recommended
- 8+ GB RAM
- ~2 GB disk for model runtime (auto-downloaded on first launch)

## Install

Download the latest `Pry_x.x.x_x64-setup.exe` from [Releases](https://github.com/beargleindustries/pry/releases), run the installer, and launch Pry from the Start Menu.

First launch downloads the Python runtime and model weights automatically. No terminal required.

## Build from Source

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 20+
- Python 3.11 or 3.12
- CUDA toolkit (matching your GPU driver)
- [uv](https://docs.astral.sh/uv/) (Python package manager)

### Steps

```bash
git clone https://github.com/beargleindustries/pry.git
cd pry

# Install frontend dependencies (beforeBuildCommand in tauri.conf.json
# runs from the ui/ directory, so this must be done first if building
# without cargo tauri dev)
cd ui && npm install && cd ..

# Run in dev mode (handles frontend + sidecar automatically)
cargo tauri dev
```

**Note:** The `pry-cli` binary in `src-tauri/src/cli.rs` is a dev/debug tool for running the sidecar standalone. It is not required for normal use.

## Built With

- [Tauri 2](https://v2.tauri.app/) -- desktop shell
- [SvelteKit](https://kit.svelte.dev/) -- frontend
- [TransformerLens](https://github.com/TransformerLensOrg/TransformerLens) -- model hooks and interpretability
- [SAELens](https://github.com/jbloomAus/SAELens) -- sparse autoencoder features
- [PyTorch](https://pytorch.org/) -- tensor compute
- [Tailwind CSS](https://tailwindcss.com/) -- styling

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built by Brad at [Beargle Industries](https://beargle.com).
