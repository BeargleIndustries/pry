// Engine (runtime venv) update prompt helpers.
// KEEP IN SYNC: src-tauri/src/bootstrap/layout.rs `RuntimeUpdateStatus`.

export type RuntimeUpdateState = 'ok' | 'update_available' | 'missing' | 'broken' | 'updating';

export interface RuntimeUpdateStatus {
  state: RuntimeUpdateState;
  current_variant: string | null;
  /** null until the background GPU probe has finished. */
  target_variant: string | null;
  download_mb: number;
  required_free_gb: number;
  schema: number;
  reason: string;
}

/** localStorage key for "Later", scoped per (schema, target variant). */
export function laterKey(schema: number, variant: string): string {
  return `pry:runtime_update_later:${schema}:${variant}`;
}

/** Prompt copy for the target variant. */
export function promptCopy(targetVariant: string): string {
  return targetVariant === 'cu124'
    ? 'A faster engine is available for your graphics card (one-time ~2.7 GB download).'
    : 'Engine update (~400 MB).';
}

/** Whether to show the prompt for this status, given what "Later" has hidden. */
export function shouldPrompt(
  s: RuntimeUpdateStatus | null,
  isDeferred: (key: string) => boolean,
): boolean {
  if (!s || s.state !== 'update_available' || !s.target_variant) return false;
  return !isDeferred(laterKey(s.schema, s.target_variant));
}
