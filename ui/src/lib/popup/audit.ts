// Popup audit (dev-only). Mounted from +page.svelte §P-popups when
// POPUP_AUDIT is on and the URL has ?popupAudit=1; driven at several window
// sizes by scripts/dev/popup-audit.mjs.
//
// It walks every quick-tour step (the overlay lesson `pry.quick-tour` on the
// Lessons runner), forces every first-time tip (without marking it seen),
// opens glossary tooltips and cell hover tooltips, and checks each popup
// against the pass bar in .omc/plans/pry-clarity-2026-10-12.md (T3).
// Seen-state and tour progress are snapshotted first and restored at the end.
//
// Output: one console line `POPUP AUDIT PASS n / FAIL m / SKIP k @ WxH` and
// the full report on window.__popupAudit.

import { tipsRegistry } from '$lib/tips/tips-registry';
import { anchorState } from '$lib/tutorial/anchors';
import {
  DEFAULT_EDGE_PAD,
  DEFAULT_GAP,
  DEFAULT_SHEET_BELOW,
  jumped,
  MAX_ARROW,
  placementFlags,
  type PlaceMode,
  type Point,
  type RectLike,
  type Side,
} from './place';
import { rectOf } from './measure';
import { occupied, OCCUPIED } from './occupied.svelte';
import { popupDevHooks } from './dev';

/** What the learning-mode pass drives (plan T3 harness; +page.svelte passes it). */
export interface AuditLessons {
  open(side: 'left' | 'right'): Promise<void>;
  close(): void;
  openLesson(id: string, sectionId?: string | null): Promise<boolean>;
  sectionCount(): number;
  goto(i: number): Promise<void>;
  /** True when the current section shows an explain-result. */
  hasExplainResult(): boolean;
  railed(): boolean;
}

/** The page moves the audit makes to put a tip's target on screen. */
export interface AuditActions {
  setPrompt(text: string): void;
  runGenerate(): Promise<unknown>;
  response(): { prompt: string } | null;
  openLeftTab(tab: string): void;
  openRightTab(tab: string): void;
  setCompareMode(on: boolean): void;
  showCopyingHeads(): void;
  hideCopyingHeads(): void;
  setHeadAblation(on: boolean): void;
}

/** The quick tour, as the tour pass drives it (+page.svelte's auditTour). */
export interface AuditTour {
  start(sectionId?: string): Promise<void>;
  close(): void;
  next(): void;
  open(): boolean;
  stepId(): string | null;
  stepIds(): string[];
  /** How many anchors the current step points at. */
  pointerCount(): number;
}

export interface AuditDeps {
  actions: AuditActions;
  lessons?: AuditLessons;
  tour?: AuditTour;
  loadState(): string;
  /** Load GPT-2 small if nothing is loaded. */
  ensureModel(): Promise<void>;
  setCustomModelDialog(open: boolean): void;
}

type Phase = 'main' | 'lessons-right' | 'lessons-left';
type Kind = 'tour' | 'tip' | 'term' | 'hover' | 'lesson';

export interface AuditRecord {
  phase: Phase;
  kind: Kind;
  id: string;
  pass: boolean;
  mode: PlaceMode | null;
  side: Side | null;
  inViewport: boolean;
  overlapsTarget: boolean;
  coversFocus: boolean;
  overlapsAvoid: boolean;
  avoidHit: string[];
  arrowLen: number | null;
  arrowExempt: boolean;
  /** placePopup counted the target as too large to sit beside (inset allowed). */
  largeTarget: boolean;
  /** Whether the popup drew its arrow (null: the popup has no arrow to draw). */
  arrowShown?: boolean | null;
  /** Point the arrow aims at (inset and sheet). */
  focus?: Point | null;
  waiting: boolean;
  jumped: boolean;
  skipped?: string;
  failures: string[];
  rect?: RectLike;
  target?: RectLike | null;
  notes?: string[];
}

const IOI = 'When Mary and John went to the store, John gave a drink to';
const SEEN_KEYS = /^pry:(tip_seen:|tutorial_seen|tour_progress|lesson_progress)/;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined | false, timeout = 15000, every = 100): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(every);
  }
}

function same(a: RectLike | null, b: RectLike | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/** Wait until `get()`'s rect holds still for 2 frames, then 300ms more (and still holds). */
async function settle(get: () => Element | null, timeout = 8000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const a = rectOf(get());
    await frame();
    const b = rectOf(get());
    await frame();
    const c = rectOf(get());
    if (same(a, b) && same(b, c)) {
      await sleep(300);
      if (same(c, rectOf(get()))) return;
    }
  }
}

function visibleIn(el: Element | null): boolean {
  const r = rectOf(el);
  if (!r) return false;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
}

/** Where the audit is right now (read by the driver when a size times out). */
function progress(what: string) {
  (window as unknown as { __popupAuditProgress?: string }).__popupAuditProgress = what;
}

function vp() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function readFocus(el: Element): Point | null {
  const f = el.getAttribute('data-popup-focus');
  if (!f) return null;
  const [x, y] = f.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function overlapping(box: RectLike, exclude: string[]): string[] {
  return occupied
    .entries()
    .filter(([id]) => !exclude.includes(id))
    .filter(([, r]) => placementFlags(box, vp(), null, null, [r]).overlapsAvoid)
    .map(([id]) => id);
}

/** Measure a placed popup element (it carries data-popup-* attributes). */
function measure(
  phase: Phase,
  kind: Kind,
  id: string,
  el: Element | null,
  target: RectLike | null,
  selfIds: string[],
): AuditRecord {
  const rec: AuditRecord = {
    phase, kind, id, pass: false, mode: null, side: null, inViewport: false, overlapsTarget: false,
    coversFocus: false, overlapsAvoid: false, avoidHit: [], arrowLen: null, arrowExempt: false,
    largeTarget: false, waiting: false, jumped: false, failures: [], target,
  };
  const box = rectOf(el);
  if (!el || !box) {
    rec.skipped = 'popup not on screen';
    rec.failures.push(rec.skipped);
    return rec;
  }
  rec.rect = box;
  rec.mode = (el.getAttribute('data-popup-mode') || null) as PlaceMode | null;
  rec.side = (el.getAttribute('data-popup-side') || null) as Side | null;
  const len = el.getAttribute('data-popup-arrow-len');
  rec.arrowLen = len ? Number(len) : null;
  rec.arrowExempt = el.getAttribute('data-popup-arrow-exempt') === 'true';
  rec.largeTarget = el.getAttribute('data-popup-large-target') === 'true';
  const shown = el.getAttribute('data-popup-arrow-shown');
  rec.arrowShown = shown === null ? null : shown === 'true';
  const focus = rec.mode === 'inset' || rec.mode === 'sheet' ? readFocus(el) : null;
  rec.focus = focus;
  const avoid = occupied.entries().filter(([k]) => !selfIds.includes(k)).map(([, r]) => r);
  const flags = placementFlags(box, vp(), target, focus, avoid);
  Object.assign(rec, flags);
  rec.avoidHit = flags.overlapsAvoid ? overlapping(box, selfIds) : [];
  return rec;
}

/** Apply the pass bar (T3) to a measured record. */
function judge(rec: AuditRecord, opts: { tour?: boolean; allowFallback?: boolean } = {}): AuditRecord {
  const f = rec.failures;
  if (rec.skipped) {
    rec.pass = false;
    return rec;
  }
  if (!rec.inViewport) f.push('outside the viewport');
  if (rec.overlapsAvoid) f.push(`covers occupied: ${rec.avoidHit.join(', ')}`);
  // Arrows (tour card and tips): a drawn arrow is never longer than MAX_ARROW.
  // A longer one may only be hidden (ring kept) in the bottom sheet; the inset
  // far-corner fallback has no arrow at all (arrowExempt).
  const arrowed = rec.kind === 'tour' || rec.kind === 'tip';
  const longArrow = (rec.arrowLen ?? 0) > MAX_ARROW;
  if (arrowed && longArrow && rec.arrowShown === true) f.push(`drawn arrow ${rec.arrowLen}px > ${MAX_ARROW}`);
  switch (rec.mode) {
    case 'anchored':
      if (rec.overlapsTarget) f.push('anchored popup overlaps its target');
      if (arrowed && longArrow && rec.arrowShown !== true) f.push(`arrow ${rec.arrowLen}px > ${MAX_ARROW} (hidden)`);
      break;
    case 'inset':
      // Inset is only for targets too large to sit beside (user decision).
      if (!rec.largeTarget) f.push('inset on a small target');
      if (rec.coversFocus) f.push('inset popup covers the focus point');
      if (!rec.arrowExempt && (rec.arrowLen ?? Infinity) > MAX_ARROW) f.push(`inset arrow ${rec.arrowLen}px > ${MAX_ARROW}`);
      break;
    case 'sheet':
      if (window.innerWidth >= DEFAULT_SHEET_BELOW) f.push('sheet at a wide viewport');
      if (rec.target && rec.rect) {
        // The target is scrolled above the sheet: wholly when it fits in the
        // scroller's visible area there, else with its focus point above it.
        const fit = card()?.getAttribute('data-popup-sheet-fit');
        const room = rec.rect.top - DEFAULT_GAP - DEFAULT_EDGE_PAD;
        if (fit === 'whole' || (!fit && rec.target.height <= room)) {
          if (rec.overlapsTarget) f.push('sheet covers its target');
        } else if (rec.coversFocus) {
          f.push('sheet covers the focus point of a tall target');
        }
      }
      break;
    case 'fallback':
      if (!opts.allowFallback) f.push('fallback placement not allowed here');
      break;
    default:
      f.push('no placement mode');
  }
  if (opts.tour && rec.jumped) f.push('jumped');
  rec.pass = f.length === 0;
  return rec;
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

const card = () => document.querySelector('[data-testid="overlay-card"]');
const activeTarget = () => document.querySelector('[data-tour-active="true"]');

function snapshot(el: Element | null, target: RectLike | null) {
  return {
    box: rectOf(el) ?? { left: 0, top: 0, width: 0, height: 0 },
    side: ((el?.getAttribute('data-popup-side') || null) as Side | null),
    mode: ((el?.getAttribute('data-popup-mode') || 'fallback') as PlaceMode),
    target,
  };
}

/** A pass/fail record for a check that isn't a placed popup. */
function checkRecord(phase: Phase, kind: Kind, id: string, ok: boolean, failure: string, notes: string[] = []): AuditRecord {
  return {
    phase, kind, id, pass: ok, mode: null, side: null, inViewport: true, overlapsTarget: false, coversFocus: false,
    overlapsAvoid: false, avoidHit: [], arrowLen: null, arrowExempt: false, largeTarget: false, waiting: false,
    jumped: false, failures: ok ? [] : [failure], notes,
  };
}

async function measureTourStep(tour: AuditTour, stepId: string, phase: Phase): Promise<AuditRecord> {
  progress(`${phase} tour ${stepId}`);
  // Wait for the card to show this step and the anchor to be found.
  await waitFor(() => card()?.getAttribute('data-step-id') === stepId, 5000);
  const pointed = tour.pointerCount() > 0;
  if (pointed) {
    const found = await waitFor(() => activeTarget() ?? null, 20000);
    if (!found) {
      const rec = measure(phase, 'tour', stepId, card(), null, [OCCUPIED.tourCard]);
      rec.skipped = 'pointed anchor never appeared';
      rec.failures.push(rec.skipped);
      return judge(rec, { tour: true });
    }
  }
  await settle(card);
  const t1 = rectOf(activeTarget());
  const first = snapshot(card(), t1);
  const rec = measure(phase, 'tour', stepId, card(), t1, [OCCUPIED.tourCard]);
  // The tour is view-only: a second measurement 1s later must not have moved.
  await sleep(1000);
  const t2 = rectOf(activeTarget());
  const second = snapshot(card(), t2);
  rec.jumped = jumped(first, second);
  const rec2 = measure(phase, 'tour', stepId, card(), t2, [OCCUPIED.tourCard]);
  rec.failures.push(...judge(rec2, { tour: true, allowFallback: !pointed }).failures.map((f) => `after: ${f}`));
  return judge(rec, { tour: true, allowFallback: !pointed });
}

async function tourPass(deps: AuditDeps, out: AuditRecord[]) {
  const tour = deps.tour;
  if (!tour) {
    out.push({ ...checkRecord('main', 'tour', 'tour', false, 'tour hook missing'), skipped: 'tour hook missing' });
    return;
  }
  const prompt = deps.actions.response()?.prompt ?? null;
  await tour.start('step-1');
  if (!(await waitFor(() => tour.open(), 10000))) {
    out.push({ ...checkRecord('main', 'tour', 'tour', false, 'the quick tour never opened'), skipped: 'the quick tour never opened' });
    return;
  }
  const ids = tour.stepIds();
  for (let i = 0; i < ids.length; i++) {
    out.push(await measureTourStep(tour, ids[i], 'main'));
    if (i < ids.length - 1) {
      tour.next();
      await frame();
    }
  }
  tour.close();
  // R4-8: walking the tour never resets the run.
  const after = deps.actions.response()?.prompt ?? null;
  out.push(checkRecord('main', 'tour', 'tour-keeps-run', after === prompt && ids.length === 12, `run after the tour: ${after} (was ${prompt}), ${ids.length} steps`, [`${ids.length} steps`]));
}

/** The plain Attention panel in its Expert (grid) view, as a user would open it. */
async function openExpert(deps: AuditDeps) {
  const a = deps.actions;
  a.setCompareMode(false);
  a.hideCopyingHeads();
  a.setHeadAblation(false);
  a.openLeftTab('attention');
  // The tour's view request only applies while the tour is open, so press the button.
  const btn = await waitFor(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => /^Expert\b/.test(b.textContent?.trim() ?? '')),
  );
  if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
  await waitFor(() => document.querySelector('[data-tip="panel-a-heatmap"]'), 10000);
}

/** Put the screen in the state a tip's target needs. */
async function setupFor(tipId: string, deps: AuditDeps): Promise<() => void> {
  const a = deps.actions;
  const plainAttention = () => {
    a.setCompareMode(false);
    a.hideCopyingHeads();
    a.setHeadAblation(false);
    a.openLeftTab('attention');
  };
  const expert = () => openExpert(deps);
  a.setCompareMode(false);
  switch (tipId) {
    case 'panel-a-heatmap':
    case 'panel-a-agg-selector':
    case 'panel-a-from-selector':
    case 'panel-a-to-selector':
    case 'ablation-head-toggle':
    case 'panel-a-copying-heads':
      await expert();
      break;
    case 'panel-a-head-detail': {
      await expert();
      const cell = await waitFor(() => document.querySelector<SVGElement>('[data-tip="panel-a-heatmap"] [role="gridcell"]'));
      cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return () => {
        // Close the single-head view again so later passes see the grid.
        const detail = document.querySelector('[data-tip="panel-a-head-detail"]');
        const btn = [...(detail?.querySelectorAll('button') ?? [])].find((b) => /back|close|grid|×/i.test(b.textContent ?? '') || /back|close/i.test(b.getAttribute('aria-label') ?? ''));
        (btn as HTMLButtonElement | undefined)?.click();
      };
    }
    case 'panel-a-copying-sequence':
      plainAttention();
      a.showCopyingHeads();
      return () => a.hideCopyingHeads();
    case 'panel-b-feature-row':
    case 'feature-histogram':
    case 'neuronpedia-link':
    case 'ablation-feature-toggle':
    case 'panel-b-layer-selector':
      a.openRightTab('features');
      break;
    case 'predictions-panel':
    case 'watch-it-write':
      a.openRightTab('predictions');
      break;
    case 'steering-panel':
    case 'concept-search':
      a.openRightTab('steering');
      break;
    case 'logit-lens-heatmap':
      a.openLeftTab('logit-lens');
      break;
    case 'dla-waterfall':
      a.openLeftTab('dla');
      break;
    case 'patching-panel':
      a.openLeftTab('patching');
      break;
    case 'circuit-graph':
      a.openLeftTab('circuit');
      break;
    case 'compare-panel':
      a.setCompareMode(true);
      return () => a.setCompareMode(false);
    case 'custom-model-verdict':
      deps.setCustomModelDialog(true);
      return () => deps.setCustomModelDialog(false);
  }
  return () => {};
}

async function measureTip(tipId: string, target: string, deps: AuditDeps, phase: Phase): Promise<AuditRecord> {
  const blank = (why: string): AuditRecord => ({
    phase, kind: 'tip', id: tipId, pass: false, mode: null, side: null, inViewport: false, overlapsTarget: false,
    coversFocus: false, overlapsAvoid: false, avoidHit: [], arrowLen: null, arrowExempt: false, largeTarget: false, waiting: false,
    jumped: false, skipped: why, failures: [why],
  });
  progress(`${phase} tip ${tipId}`);
  const cleanup = await setupFor(tipId, deps);
  try {
    const el = await waitFor(() => {
      const e = document.querySelector<HTMLElement>(target);
      return e && rectOf(e) ? e : null;
    }, 30000);
    if (!el) return blank('target never appeared');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await settle(() => el);
    const force = popupDevHooks.forceTip;
    if (!force) return blank('forceTip hook missing');
    let res = await force(tipId);
    const t = rectOf(el);
    const tipEl = () => document.querySelector(`[data-popup="tip"][data-tip-id="${CSS.escape(tipId)}"]`);
    if (res.shown) {
      await settle(tipEl);
      // The tip released itself while settling: its target became unusable.
      if (!tipEl()) {
        const state = anchorState(el);
        res = { id: tipId, shown: false, waiting: state === 'covered', reason: `released: target ${state}` };
      }
    }
    if (!res.shown && res.heldByLessons) {
      // A tip about opening Lessons (TipDef.whileLessonsClosed) must stay away
      // while the sidebar is open: the check is that it did.
      const declared = tipsRegistry.find((x) => x.id === tipId)?.whileLessonsClosed === true;
      const open = !!document.querySelector('[data-lesson-sidebar]');
      const ok = declared && open;
      return {
        ...blank(''), skipped: undefined, mode: null, inViewport: true, target: t, pass: ok,
        failures: ok ? [] : ['held for Lessons without declaring whileLessonsClosed, or with the sidebar closed'],
        notes: ['not shown while Lessons is open (whileLessonsClosed)'],
      };
    }
    if (!res.shown) {
      // Nothing in the app covers a tip's target any more (the experiment
      // guide is gone), so a waiting tip is a failure too.
      const rec = blank(`not shown: ${res.reason ?? 'unknown'}`);
      if (res.waiting) {
        rec.skipped = undefined;
        rec.waiting = true;
        rec.target = t;
        rec.failures = [`tip waiting: ${res.reason ?? 'target covered'}`];
        rec.pass = false;
      }
      return rec;
    }
    const rec = measure(phase, 'tip', tipId, tipEl(), rectOf(el), [OCCUPIED.tip]);
    return judge(rec);
  } finally {
    popupDevHooks.clearForcedTip?.();
    cleanup();
    await frame();
  }
}

async function tipPass(deps: AuditDeps, out: AuditRecord[], phase: Phase, only?: Set<string>) {
  for (const tip of tipsRegistry) {
    if (only && !only.has(tip.id)) continue;
    out.push(await measureTip(tip.id, tip.target, deps, phase));
  }
}

async function termPass(deps: AuditDeps, out: AuditRecord[]) {
  const visibleTerms = () => [...document.querySelectorAll<HTMLElement>('[data-tour="glossary-term"]')].filter(visibleIn);
  // Narrow windows show one panel at a time: try views until some terms show.
  const views: (() => unknown)[] = [
    () => {},
    () => deps.actions.openRightTab('predictions'),
    () => deps.actions.openLeftTab('attention'),
    () => deps.actions.openLeftTab('dla'),
    () => deps.actions.openLeftTab('logit-lens'),
    () => deps.actions.openRightTab('features'),
  ];
  let terms: HTMLElement[] = [];
  for (const open of views) {
    await open();
    terms = (await waitFor(() => (visibleTerms().length ? visibleTerms() : null), 3000)) ?? [];
    if (terms.length) break;
  }
  if (terms.length === 0) {
    out.push({ ...judge(measure('main', 'term', 'any', null, null, [])), skipped: 'no glossary term on screen' });
    return;
  }
  const by = (f: (r: RectLike) => number) => terms.slice().sort((a, b) => f(rectOf(a)!) - f(rectOf(b)!))[0];
  const picks = new Map<string, HTMLElement>([
    ['top', by((r) => r.top)],
    ['bottom', by((r) => -(r.top + r.height))],
    ['left', by((r) => r.left)],
    ['right', by((r) => -(r.left + r.width))],
    ['panel-body', terms[Math.floor(terms.length / 2)]],
  ]);
  for (const [where, el] of picks) {
    el.dispatchEvent(new MouseEvent('mouseenter'));
    const tipId = el.getAttribute('aria-describedby');
    const tip = () => (tipId ? document.getElementById(tipId) : null);
    await waitFor(() => tip()?.getAttribute('data-popup-mode'), 2000, 16);
    await settle(tip, 2000);
    out.push(judge(measure('main', 'term', `term-${where}`, tip(), rectOf(el), [])));
    el.dispatchEvent(new MouseEvent('mouseleave'));
    await frame();
  }
}

async function hoverPass(deps: AuditDeps, out: AuditRecord[]) {
  const grids: [string, () => unknown, string][] = [
    ['expert', () => openExpert(deps), '[data-tip="panel-a-heatmap"] [role="gridcell"]'],
    ['logit-lens', () => deps.actions.openLeftTab('logit-lens'), '[data-tip="logit-lens-heatmap"] [role="gridcell"]'],
  ];
  for (const [name, open, sel] of grids) {
    await open();
    const cells = await waitFor(() => {
      const c = [...document.querySelectorAll<HTMLElement>(sel)];
      return c.length ? c : null;
    }, 30000);
    if (!cells) {
      out.push({ ...judge(measure('main', 'hover', name, null, null, [])), skipped: `${name} grid never appeared` });
      continue;
    }
    const rows = cells.map((c) => Number(c.dataset.row));
    const cols = cells.map((c) => Number(c.dataset.col));
    const maxR = Math.max(...rows);
    const maxC = Math.max(...cols);
    const corners: [string, number, number][] = [['tl', 0, 0], ['tr', 0, maxC], ['bl', maxR, 0], ['br', maxR, maxC]];
    for (const [corner, r, c] of corners) {
      const cell = cells.find((x) => Number(x.dataset.row) === r && Number(x.dataset.col) === c);
      if (!cell) {
        out.push({ ...judge(measure('main', 'hover', `${name}-${corner}`, null, null, [])), skipped: 'cell missing' });
        continue;
      }
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await settle(() => cell, 2000);
      cell.dispatchEvent(new MouseEvent('mouseenter'));
      const tip = () => document.querySelector('[data-popup="hover"]');
      await waitFor(() => tip()?.getAttribute('data-popup-mode'), 2000, 16);
      await settle(tip, 2000);
      out.push(judge(measure('main', 'hover', `${name}-${corner}`, tip(), rectOf(cell), [])));
      cell.dispatchEvent(new MouseEvent('mouseleave'));
      await frame();
    }
  }
}

// ---------------------------------------------------------------------------
// Learning mode (plan T3): the Lessons sidebar open beside the app
// ---------------------------------------------------------------------------

export const AUDIT_LESSON = 'pry.p1-1';

function lessonRecord(phase: Phase, id: string, failures: string[], notes: string[] = [], rect?: RectLike): AuditRecord {
  return {
    phase, kind: 'lesson', id, pass: failures.length === 0, mode: null, side: null, inViewport: true, overlapsTarget: false,
    coversFocus: false, overlapsAvoid: false, avoidHit: [], arrowLen: null, arrowExempt: false, largeTarget: false,
    waiting: false, jumped: false, failures, notes, rect,
  };
}

const sidebarEl = () => document.querySelector<HTMLElement>('[data-lesson-sidebar]');

/** Lengths of the arrows the Lessons pointers draw now. */
function drawnArrows(): number[] {
  return [...document.querySelectorAll('[data-popup-pointer] line')].map((l) => {
    const n = (k: string) => Number(l.getAttribute(k) ?? 0);
    return Math.hypot(n('x2') - n('x1'), n('y2') - n('y1'));
  });
}

async function lessonsPass(deps: AuditDeps, out: AuditRecord[], side: 'left' | 'right') {
  const L = deps.lessons;
  const phase: Phase = side === 'left' ? 'lessons-left' : 'lessons-right';
  if (!L) {
    out.push({ ...lessonRecord(phase, 'lessons', ['lessons hook missing']), skipped: 'lessons hook missing' });
    return;
  }
  progress(`${phase} open`);
  await L.open(side);
  const opened = await L.openLesson(AUDIT_LESSON);
  const sb = await waitFor(() => sidebarEl(), 15000);
  if (!opened || !sb) {
    out.push(lessonRecord(phase, 'open', [`couldn't open ${AUDIT_LESSON}`]));
    L.close();
    return;
  }
  await settle(sidebarEl);
  // Beside the app, never over it.
  const s = rectOf(sb);
  const main = rectOf(document.querySelector('[data-lessons-main]'));
  const header = rectOf(document.querySelector('header'));
  const beside: string[] = [];
  if (!s || !main) beside.push('sidebar or workspace missing');
  else {
    if (placementFlags(s, vp(), null, null, [main]).overlapsAvoid) beside.push('sidebar overlaps the workspace');
    if (header && s.top < header.top + header.height - 0.5) beside.push('sidebar overlaps the header');
    if (side === 'right' && s.left < main.left) beside.push('right sidebar sits left of the workspace');
    if (side === 'left' && s.left > main.left) beside.push('left sidebar sits right of the workspace');
  }
  out.push(lessonRecord(phase, 'beside', beside, [`sidebar ${s ? Math.round(s.width) : '?'}px${L.railed() ? ' (rail)' : ''}`], s ?? undefined));

  // Every section: the honesty box in view on explain-result steps; no drawn arrow over MAX_ARROW.
  const n = L.sectionCount();
  for (let i = 0; i < n; i++) {
    progress(`${phase} section ${i + 1}/${n}`);
    await L.goto(i);
    await waitFor(() => !document.querySelector('[data-lesson-sidebar] [role="status"]')?.textContent?.includes('Setting up'), 15000);
    await settle(sidebarEl);
    await sleep(300);
    const arrows = drawnArrows();
    const long = arrows.filter((a) => a > MAX_ARROW);
    const f: string[] = long.map((a) => `drawn arrow ${Math.round(a)}px > ${MAX_ARROW}`);
    const notes = [`${arrows.length} arrow(s)`];
    if (L.hasExplainResult() && !L.railed()) {
      const box = rectOf(document.querySelector('[data-testid="honesty-box"]'));
      if (!box) f.push('honesty box missing on an explain-result step');
      else if (box.top < 0 || box.left < 0 || box.top + box.height > window.innerHeight + 0.5 || box.left + box.width > window.innerWidth + 0.5) f.push('honesty box outside the viewport');
      notes.push('explain-result');
    }
    out.push(lessonRecord(phase, `section-${i + 1}`, f, notes));
  }

  // Tips with the sidebar open: none may cover it (occupied: lesson-sidebar).
  await tipPass(deps, out, phase);
  L.close();
  await waitFor(() => !sidebarEl(), 5000);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runPopupAudit(
  deps: AuditDeps,
  opts: { skipTour?: boolean; lessons?: ('left' | 'right')[] } = {},
) {
  const w = window as unknown as { __popupAudit?: unknown };
  const size = `${window.innerWidth}x${window.innerHeight}`;
  const records: AuditRecord[] = [];
  const saved = snapshotSeen();
  const started = Date.now();
  let error: string | null = null;
  try {
    // Natural tips stay quiet while the audit forces them one at a time.
    for (const tip of tipsRegistry) localStorage.setItem(`pry:tip_seen:${tip.id}`, 'true');
    deps.tour?.close();

    if (deps.loadState() !== 'loaded') {
      await waitFor(() => deps.loadState() === 'loading' || deps.loadState() === 'loaded', 15000);
      if (deps.loadState() !== 'loaded' && deps.loadState() !== 'loading') await deps.ensureModel();
    }
    if (!(await waitFor(() => deps.loadState() === 'loaded', 600000, 500))) throw new Error(`model never loaded (${deps.loadState()})`);

    deps.actions.setCompareMode(false);
    deps.actions.setPrompt(IOI);
    await deps.actions.runGenerate();
    if (!(await waitFor(() => deps.actions.response()?.prompt === IOI, 120000, 250))) throw new Error('fixed prompt never ran');
    await sleep(500);

    if (!opts.skipTour) await tourPass(deps, records);
    // Back to the fixed prompt for tips and tooltips.
    deps.actions.setCompareMode(false);
    if (deps.actions.response()?.prompt !== IOI) {
      deps.actions.setPrompt(IOI);
      await deps.actions.runGenerate();
    }
    await tipPass(deps, records, 'main');
    await termPass(deps, records);
    await hoverPass(deps, records);
    for (const side of opts.lessons ?? []) await lessonsPass(deps, records, side);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    restoreSeen(saved);
  }

  const skip = records.filter((r) => r.skipped).length;
  const fail = records.filter((r) => !r.pass && !r.skipped).length + (error ? 1 : 0);
  const pass = records.filter((r) => r.pass).length;
  const line = `POPUP AUDIT PASS ${pass} / FAIL ${fail} / SKIP ${skip} @ ${size}`;
  w.__popupAudit = {
    line,
    error,
    viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
    tips: tipsRegistry.length,
    tourSteps: records.filter((r) => r.kind === 'tour' && r.id.startsWith('step-')).length,
    seconds: Math.round((Date.now() - started) / 1000),
    records,
  };
  console.log(line);
  (window as unknown as { __popupAuditShow?: unknown }).__popupAuditShow = (id: string | null) => showStep(deps, id);
  return line;
}

/** Driver helper for evidence screenshots: open the tour at `stepId` (null closes it). */
async function showStep(deps: AuditDeps, stepId: string | null): Promise<boolean> {
  const tour = deps.tour;
  if (!tour) return false;
  const saved = snapshotSeen();
  try {
    if (!stepId) {
      tour.close();
      return true;
    }
    await tour.start(stepId);
    if (!(await waitFor(() => card()?.getAttribute('data-step-id') === stepId, 5000))) return false;
    if (tour.pointerCount() > 0) await waitFor(() => activeTarget(), 10000);
    await settle(card);
    await sleep(400);
    return true;
  } finally {
    restoreSeen(saved);
  }
}

function snapshotSeen(): [string, string][] {
  const saved: [string, string][] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && SEEN_KEYS.test(k)) saved.push([k, localStorage.getItem(k) ?? '']);
  }
  return saved;
}

function restoreSeen(saved: [string, string][]) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && SEEN_KEYS.test(k)) localStorage.removeItem(k);
  }
  for (const [k, v] of saved) localStorage.setItem(k, v);
}
