# Third-Party Notices

Pry includes or depends on the following third-party packages. Each is distributed
under its own license. Full license texts are available in each package's repository.

## Rust Crates

| Crate | License | Copyright |
|-------|---------|-----------|
| tauri | MIT OR Apache-2.0 | The Tauri Programme within The Commons Conservancy |
| tauri-build | MIT OR Apache-2.0 | The Tauri Programme within The Commons Conservancy |
| tauri-plugin-dialog | MIT OR Apache-2.0 | The Tauri Programme within The Commons Conservancy |
| tauri-plugin-fs | MIT OR Apache-2.0 | The Tauri Programme within The Commons Conservancy |
| tauri-plugin-shell | MIT OR Apache-2.0 | The Tauri Programme within The Commons Conservancy |
| serde | MIT OR Apache-2.0 | The serde Authors |
| serde_json | MIT OR Apache-2.0 | The serde_json Authors |
| tokio | MIT | The Tokio Authors |
| tokio-util | MIT | The Tokio Authors |
| reqwest | MIT OR Apache-2.0 | The reqwest Authors |
| anyhow | MIT OR Apache-2.0 | David Tolnay |
| thiserror | MIT OR Apache-2.0 | David Tolnay |
| tracing | MIT | The tracing Authors |
| tracing-subscriber | MIT | The tracing Authors |
| portpicker | MIT OR Apache-2.0 | The portpicker Authors |
| which | MIT | The which Authors |
| dirs | MIT OR Apache-2.0 | The dirs Authors |
| chrono | MIT OR Apache-2.0 | The chrono Authors |
| futures-util | MIT OR Apache-2.0 | The futures-util Authors |
| clap | MIT OR Apache-2.0 | The clap Authors |
| eventsource-stream | MIT | The eventsource-stream Authors |
| sha2 | MIT OR Apache-2.0 | The RustCrypto Authors |
| tar | MIT OR Apache-2.0 | Alex Crichton |
| flate2 | MIT OR Apache-2.0 | Alex Crichton and Josh Triplett |
| once_cell | MIT OR Apache-2.0 | The once_cell Authors |
| os_info | MIT | The os_info Authors |
| regex | MIT OR Apache-2.0 | The regex Authors |
| windows | MIT OR Apache-2.0 | Microsoft |
| nvml-wrapper | MIT | The nvml-wrapper Authors |
| libc | MIT OR Apache-2.0 | The libc Authors |

## npm Packages

| Package | License | Copyright |
|---------|---------|-----------|
| @tauri-apps/api | MIT | The Tauri Programme within The Commons Conservancy |
| @tauri-apps/plugin-shell | MIT | The Tauri Programme within The Commons Conservancy |
| @tauri-apps/plugin-dialog | MIT | The Tauri Programme within The Commons Conservancy |
| @tauri-apps/plugin-fs | MIT | The Tauri Programme within The Commons Conservancy |
| d3-interpolate | ISC | Mike Bostock |
| d3-scale | ISC | Mike Bostock |
| @types/d3-interpolate | MIT | DefinitelyTyped Contributors |
| @types/d3-scale | MIT | DefinitelyTyped Contributors |
| lucide-svelte | ISC | The Lucide Authors |
| @sveltejs/adapter-static | MIT | The Svelte Authors |
| @sveltejs/kit | MIT | The Svelte Authors |
| @sveltejs/vite-plugin-svelte | MIT | The Svelte Authors |
| svelte | MIT | The Svelte Authors |
| svelte-check | MIT | The Svelte Authors |
| vite | MIT | Evan You |
| tailwindcss | MIT | Tailwind Labs, Inc. |
| postcss | MIT | Andrey Sitnik |
| autoprefixer | MIT | Andrey Sitnik |
| prettier | MIT | James Long and Contributors |
| prettier-plugin-svelte | MIT | The prettier-plugin-svelte Authors |
| typescript | Apache-2.0 | Microsoft |
| tslib | Apache-2.0 | Microsoft |

## Python Packages

| Package | License | Copyright |
|---------|---------|-----------|
| torch | BSD-3-Clause | Meta Platforms, Inc. |
| transformer-lens | MIT | Neel Nanda |
| sae-lens | MIT | Joseph Bloom |
| starlette | BSD-3-Clause | Encode OSS Ltd. |
| uvicorn | BSD-3-Clause | Encode OSS Ltd. |
| pydantic | MIT | Samuel Colvin and Pydantic Services, Inc. |
| safetensors | Apache-2.0 | Hugging Face, Inc. |
| huggingface_hub | Apache-2.0 | Hugging Face, Inc. |
| hf_transfer | Apache-2.0 | Hugging Face, Inc. |
| sse-starlette | BSD-3-Clause | The sse-starlette Authors |
| numpy | BSD-3-Clause | NumPy Developers |
| requests | Apache-2.0 | Kenneth Reitz and Contributors |

## Intentional Exclusions

The following packages appear in project configuration but are **not** bundled with
the distributed application and are therefore excluded from this notice:

- **hatchling** -- build-only backend for pyproject.toml; not included at runtime
- **ruff** -- optional dev-only linter
- **pytest** -- optional dev-only test runner
- **ipykernel** / **jupyter** -- optional dev-only notebook tools
