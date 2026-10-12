// Turn engine/server error text into a plain-language sentence for the UI.
// Known messages map to a friendly line; anything else keeps the server text.
// `details` carries the raw text for a "Details" disclosure.

import { gateStepMissing } from './hf-gate';

export interface FriendlyError {
  /** What to show the user. */
  message: string;
  /** Raw server text, for a "Details" disclosure. Null when it adds nothing. */
  details: string | null;
}

/** Shown when the error has no text at all. */
export const GENERIC_ERROR =
  'Something went wrong in Pry. Press Retry, or restart the engine from the chip at the top.';

interface Rule {
  test: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    test: /bad token|rejected the request|\b403\b/i,
    message:
      "Pry's engine didn't accept the request. Restart the engine from the status chip at the top, then try again.",
  },
  {
    test: /engine isn't running|unreachable|failed to fetch|networkerror|load failed: network|econnrefused/i,
    message:
      "Pry's engine isn't running. Use Restart engine at the top of the window to start it again.",
  },
  {
    test: /(different|same|mismatch\w*)\b.*\b(length|number of tokens|token count)|(length|token count)s? (differ|mismatch|must match)/i,
    message:
      'The two prompts need the same number of tokens (word pieces). Change one so they line up word for word, then run it again.',
  },
  {
    test: /(sae|feature)?\s*layer\b.*\b(mismatch|not loaded|isn't loaded|not available|no sae)|(no sae|sae not loaded)\b.*\blayer/i,
    message:
      "That feature layer isn't available for this model. Pick a layer from the layer menu and try again.",
  },
  {
    test: /out of range|must be (between|less than|at most|<)|index \d+ is (too|out)|exceeds .*(layers|heads|features|tokens)/i,
    message:
      "One of the values (layer, head, feature or token position) is outside what this model supports. Pick a value from the menus and try again.",
  },
  {
    test: /not loaded|no model (is )?loaded|load (the|a) (model|preset) first|preset .* is not active/i,
    message:
      'No model is loaded yet. Pick a model from the menu at the top and wait for it to finish loading.',
  },
];

export function friendlyError(raw: unknown): FriendlyError {
  const text = (raw instanceof Error ? raw.message : String(raw ?? '')).trim();
  if (!text) return { message: GENERIC_ERROR, details: null };
  // A license-gate message already names the missing step in plain words.
  if (gateStepMissing(text)) return { message: text, details: null };
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return { message: rule.message, details: text === rule.message ? null : text };
    }
  }
  // Unknown: keep the server's words, with the full text under "Details".
  const message = text.length > 160 ? `${text.slice(0, 157)}…` : text;
  return { message, details: text };
}
