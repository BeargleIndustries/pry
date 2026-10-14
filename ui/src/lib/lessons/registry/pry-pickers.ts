// Pry pickers (plan T2): the learner picks something in the app. Each `start`
// resolves with the learner's next pick and rejects when the signal aborts.
// The panels report picks through pry-state's notifyPick: the token strip
// with `{index, text}`, the attention grid with `{layer, head}`.

import type { PickerDef } from './contract';
import { waitForPick } from './pry-state.svelte';

export const pryPickers: Record<string, PickerDef> = {
  token: { doc: 'The learner clicks a token in the strip.', start: (signal) => waitForPick('token', signal) },
  head: {
    doc: 'The learner clicks a cell in the attention grid; resolves to its layer and head.',
    start: (signal) => waitForPick('head', signal),
  },
};
