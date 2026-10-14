// Pry scene state (plan T2b): the source of truth per lifted field. T2a only
// declares the view-state type the ToolActionSet is generic over.

// TODO(pry-learning T2b): replace with the lifted state fields.
export type PryViewState = Record<string, unknown>;
