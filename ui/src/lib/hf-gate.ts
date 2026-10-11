// T31: the Hugging Face license gate for Gemma.
//
// Google only lets people download Gemma after they accept its license on
// huggingface.co (in their own browser) and give Pry a read token. Pry never
// accepts the license for them; it only links to the page.

/** Where the user accepts Google's Gemma license. */
export const GEMMA_LICENSE_URL = 'https://huggingface.co/google/gemma-2-2b';
/** Where the user creates a read token. */
export const HF_TOKENS_URL = 'https://huggingface.co/settings/tokens';

/** The two setup steps a gated model needs. */
export type GateStep = 'license' | 'token';

/**
 * Which setup step a load error says is missing, or null when the error isn't
 * about the license gate. Matches the plain messages the sidecar sends
 * (registry.license_gate_error / hf_token_for).
 */
export function gateStepMissing(message: string | null | undefined): GateStep | null {
  if (!message) return null;
  if (!/needs one more setup step/i.test(message)) return null;
  if (/hasn't accepted .*license/i.test(message)) return 'license';
  if (/hugging face token step/i.test(message)) return 'token';
  return null;
}

/** Open a link in the user's own browser (Tauri shell plugin, else a new tab). */
export async function openExternal(url: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Remembered once a gated preset has loaded, so the explainer isn't shown every switch. */
export function gatePassedKey(presetId: string): string {
  return `pry:gate_ok:${presetId}`;
}
