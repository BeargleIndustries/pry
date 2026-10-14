// Pry pickers (plan T2): the learner picks something in the app. T2a ships the
// names; `start` is a stub until T2b fills it in place.

import { notImplemented, type PickerDef } from './contract';

const start = notImplemented as PickerDef['start'];

export const pryPickers: Record<string, PickerDef> = {
  token: { doc: 'The learner clicks a token in the strip.', start },
  head: { doc: 'The learner clicks a cell in the attention grid; resolves to its layer and head.', start },
};
