/**
 * Returns true when running inside the Tauri webview (with __TAURI__ injected).
 * Returns false during plain `npm run dev` / vite standalone.
 *
 * Checks both __TAURI__ (Tauri 1/2) and __TAURI_INTERNALS__ (Tauri 2 some builds).
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}
