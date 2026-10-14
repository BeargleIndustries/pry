// Pry target / apply / snapshot / memoContext (plan T2b). Stubs until T2b.

import { z } from 'zod';
import { notImplemented, type ToolActionSet } from './contract';
import type { PryViewState } from './pry-state.svelte';

type PrySet = ToolActionSet<PryViewState>;

// TODO(pry-learning T2b): the full baseline and :::enter overlay schemas
// (the overlay includes dla_target {answer, contrast?} and reset).
export const pryBaselineSchema = z.record(z.string(), z.unknown());
export const pryOverlaySchema = z.record(z.string(), z.unknown());

export const pryTarget: PrySet['target'] = () => notImplemented();
export const pryApply: PrySet['apply'] = async () => notImplemented();
export const prySnapshot: PrySet['snapshot'] = () => notImplemented();
export const pryMemoContext: PrySet['memoContext'] = () => notImplemented();
