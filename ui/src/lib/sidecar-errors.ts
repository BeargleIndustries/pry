// Turn a sidecar error response body into the most useful human message.
//
// The sidecar answers errors in two shapes:
//   {"error": "<plain sentence>"}                      (_error helper)
//   {"error": "<code>", "detail": "<sentence>" | [...]} (validation/inference)
// Prefer a plain sentence; fall back to null so callers can use a generic line.
export function sidecarErrorMessage(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { error, detail } = parsed as { error?: unknown; detail?: unknown };
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  // A bare code like "validation_error" isn't a sentence worth showing.
  if (typeof error === 'string' && /\s/.test(error.trim())) return error.trim();
  return null;
}
