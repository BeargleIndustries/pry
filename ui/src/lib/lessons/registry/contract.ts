// The runner contract (plan "The runner contract"): what a tool hands the
// Lessons runner, and the runner <-> presenter interface both presenters
// implement. Tool-neutral: nothing here imports Pry code.

import type { ZodType } from 'zod';
import type { RenderedStep } from '../render';

/**
 * What an action touches. `view` and `compute` run freely; every other effect
 * is permission-gated for user lessons. `cost` is unused by Pry and reserved
 * so a paid-API tool needs no format change.
 */
export type Effect = 'view' | 'compute' | 'download' | 'network' | 'external' | 'cost';

export const EFFECTS: readonly Effect[] = ['view', 'compute', 'download', 'network', 'external', 'cost'];

/** Effects that replay (section fold) and run without a grant. */
export const FREE_EFFECTS: readonly Effect[] = ['view', 'compute'];

/** Context handed to `apply` and to each action's `run`. */
export interface ActionContext {
  signal: AbortSignal;
  /** Shows a waiting message while slow work runs. */
  wait(msg: string): void;
}

export interface ActionDef {
  args: ZodType;
  doc: string;
  effect: Effect;
  /** Grant scope for gated effects (e.g. a host for `network` / `external`). */
  scope?(args: any): string;
  /** Commit-on-complete: an abort stops later actions, never this one's result. */
  stateful?: boolean;
  run(args: any, ctx: ActionContext): Promise<void>;
}

export type ReadoutType = 'number' | 'string' | 'boolean' | 'list' | 'record' | 'prose';
export type ReadoutUnit = 'probability' | 'logit' | 'count' | 'layer' | 'activation' | 'nats';

export interface ReadoutDef {
  args?: ZodType;
  type: ReadoutType;
  unit?: ReadoutUnit;
  /** A record's field types, so a check's `field` gets its operator checked (lint). */
  fields?: Record<string, ReadoutType>;
  /** Reads the learner's settings, not a run's result, so a task checks it before each run (C5-1). */
  state?: true;
  doc: string;
  read(args?: any): unknown | undefined;
}

export interface AnchorDef {
  doc: string;
  label: string;
  args?: ZodType;
  locate(args?: any): HTMLElement | null;
  reveal?: { action: string; args: unknown };
  /** Hide-until-predict (TN-2 / N2). Present on hideable regions only. */
  hide?(on: boolean): void;
  large?: boolean;
  focus?: [number, number];
}

export interface ViewDef {
  doc: string;
  args: ZodType;
  component: unknown;
}

export interface PickerDef {
  doc: string;
  start(signal: AbortSignal): Promise<unknown>;
}

export interface ToolActionSet<VS> {
  tool: string;
  version: string;
  /** Pry: 'pry.' */
  idPrefix: string;
  /** Folder under $APPDATA; Pry: 'lessons'. */
  lessonDir: string;
  /** Legal values for front matter `model`. */
  models: string[];
  /** Legal `network` scopes. */
  services: Record<string, { doc: string; host: string }>;
  /** The spine strip, in order. */
  spine: { id: string; label: string }[];
  /** Front matter `baseline`, opaque to the format. */
  baselineSchema: ZodType;
  /** `:::enter` body, opaque to the format. */
  overlaySchema: ZodType;
  /** Overlay applied on top of `from` (default: baseline state). */
  target(baseline: unknown, overlay: unknown, from?: VS): VS;
  apply(target: VS, ctx: ActionContext): Promise<void>;
  snapshot(): VS;
  actions: Record<string, ActionDef>;
  readouts: Record<string, ReadoutDef>;
  anchors: Record<string, AnchorDef>;
  /** Tool renderers mounted in compare / observe steps. */
  views: Record<string, ViewDef>;
  /** The learner picks a token, a head, ... */
  pickers: Record<string, PickerDef>;
  /** Engine state not in request bodies (Pry: the loaded SAE layer). */
  memoContext(): string;
}

/**
 * A step as the runner hands it to a presenter: one section with each step's
 * state resolved. Its shape belongs to the runner's renderer (`lessons/render.ts`).
 */
export type { RenderedStep };

/** A tool anchor, or a runner target (`lesson:spine` with `args.box`, `lesson:step:<id>`, `lesson:image:<id>`). */
export type PointerTarget = { anchor: string; args?: unknown } | { runner: string; args?: unknown };

export type PresenterCommand = 'next' | 'back' | 'skip' | 'exit' | { commit: unknown };

/** Runner <-> presenter interface (R4-11); the sidebar and the overlay both implement it. */
export interface Presenter {
  show(step: RenderedStep, nav: { index: number; total: number; canBack: boolean }): void;
  point(target: PointerTarget, seq?: number): void;
  clearPointer(): void;
  onCommand(cb: (c: PresenterCommand) => void): void;
}

/** Error every T2a stub throws until T2b fills it in. */
export function notImplemented(): never {
  throw new Error('not implemented (T2b)');
}
