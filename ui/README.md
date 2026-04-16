# pry-ui

SvelteKit frontend for [Pry](../README.md) — a local-first interpretability desktop app.

## Standalone dev

```sh
npm install
npm run dev
```

Opens at http://localhost:5173. Expects the Python sidecar at `http://127.0.0.1:8765`.
Override the sidecar URL with the env var:

```sh
VITE_PRY_SIDECAR=http://127.0.0.1:9000 npm run dev
```

## Tauri dev (recommended)

From the project root:

```sh
cargo tauri dev
```

Tauri spawns the sidecar and injects the correct port via `VITE_PRY_SIDECAR` automatically.

## Build

```sh
npm run build   # outputs to build/
```

The build is static (`adapter-static`, SPA mode) — `build/index.html` is the entry point
Tauri serves from its webview.

## Checks

```sh
npm run check   # svelte-check + TypeScript
npm run lint    # prettier --check
```
