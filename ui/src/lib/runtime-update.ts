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

/** "~3.5 GB" / "~420 MB" for the prompt. */
export function formatDownload(mb: number): string {
  return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`;
}

/**
 * Prompt copy from the current -> target variant. A CPU engine moving to a
 * GPU build is "faster"; a cu124 engine moving to cu128 happens only because
 * the card (Blackwell) can't run cu124; anything else is just an update.
 */
export function promptCopy(currentVariant: string | null, targetVariant: string, downloadMb: number): string {
  const size = formatDownload(downloadMb);
  if (targetVariant === 'cpu') return `Engine update (${size}).`;
  const cpuNow = currentVariant === 'cpu' || currentVariant === 'unknown-cpu';
  if (cpuNow) return `A faster engine is available for your graphics card (one-time ${size} download).`;
  if (currentVariant === 'cu124' && targetVariant === 'cu128') {
    return `Your graphics card needs a newer engine (one-time ${size} download).`;
  }
  return `An engine update is available (one-time ${size} download).`;
}

/** KEEP IN SYNC: src-tauri/src/bootstrap/mod.rs `RuntimeUpdateError`. */
export type RuntimeUpdateFailureKind = 'busy' | 'not_started' | 'rolled_back' | 'restart_required';

export interface RuntimeUpdateError {
  kind: RuntimeUpdateFailureKind;
  message: string;
  log_path: string | null;
}

/**
 * Plain headline for a failed update. "Still works" only when the previous
 * engine is known to be running: it was never stopped (not_started / busy) or
 * the rollback relaunched it (rolled_back).
 */
export function failureHeadline(kind: RuntimeUpdateFailureKind | 'unknown'): string {
  switch (kind) {
    case 'busy':
      return 'An engine install or update is already running.';
    case 'not_started':
    case 'rolled_back':
      return "The engine update didn't finish. Your current engine still works.";
    default:
      return "The engine update didn't finish and the engine isn't running. Please restart Pry.";
  }
}

/** Whether to show the prompt for this status, given what "Later" has hidden. */
export function shouldPrompt(
  s: RuntimeUpdateStatus | null,
  isDeferred: (key: string) => boolean,
): boolean {
  if (!s || s.state !== 'update_available' || !s.target_variant) return false;
  return !isDeferred(laterKey(s.schema, s.target_variant));
}
