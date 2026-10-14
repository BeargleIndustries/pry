// Pry's ToolActionSet: the names T2a declares, assembled for the runner.

import type { ToolActionSet } from './contract';
import type { PryViewState } from './pry-state.svelte';
import { pryActions } from './pry-actions';
import { pryReadouts } from './pry-readouts';
import { pryAnchors } from './pry-anchors';
import { pryViews } from './pry-views';
import { pryPickers } from './pry-pickers';
import { PRY_MODELS, PRY_SERVICES, PRY_SPINE } from './pry-models';
import { pryApply, pryBaselineSchema, pryMemoContext, pryOverlaySchema, prySnapshot, pryTarget } from './pry-apply';

export const pryToolSet: ToolActionSet<PryViewState> = {
  tool: 'pry',
  version: '1',
  idPrefix: 'pry.',
  lessonDir: 'lessons',
  models: [...PRY_MODELS],
  services: PRY_SERVICES,
  spine: PRY_SPINE,
  baselineSchema: pryBaselineSchema,
  overlaySchema: pryOverlaySchema,
  target: pryTarget,
  apply: pryApply,
  snapshot: prySnapshot,
  actions: pryActions,
  readouts: pryReadouts,
  anchors: pryAnchors,
  views: pryViews,
  pickers: pryPickers,
  memoContext: pryMemoContext,
};
