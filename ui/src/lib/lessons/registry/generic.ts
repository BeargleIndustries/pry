// Runner-level names every tool maps onto (plan "The runner contract").
// A tool's ToolActionSet declares each of these as an action or readout key
// (Pry declares them as aliases of its own names, e.g. set_input = set_prompt).
// The model-mismatch banner calls the generic `switch_model`.

export const GENERIC_ACTIONS = [
  'set_input',
  'run',
  'open_view',
  'focus_item',
  'reset',
  'highlight',
  'switch_model',
] as const;

export const GENERIC_READOUTS = ['result'] as const;
