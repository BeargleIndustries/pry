// Popup audit (dev-only). Mounted from +page.svelte §P-popups when
// POPUP_AUDIT is on and the URL has ?popupAudit=1; driven at several window
// sizes by scripts/dev/popup-audit.mjs.
//
// It drives every tour step (enter actions, plus run work where a step has
// it), forces every first-time tip (without marking it seen), opens glossary
// tooltips and cell hover tooltips, and checks each popup against the pass
// bar in .omc/plans/pry-clarity-2026-10-12.md (T3). Seen-state and tour
// progress are snapshotted first and restored at the end.
//
// Output: one console line `POPUP AUDIT PASS n / FAIL m / SKIP k @ WxH` and
// the full report on window.__popupAudit.

import { tutorialState } from '$lib/tutorial/tutorial-store.svelte';
import { tourChapters, type TourStep } from '$lib/tutorial/tour-steps';
import type { TourContext, TutorialActions } from '$lib/tutorial/actions';
import { tipsRegistry } from '$lib/tips/tips-registry';
import { anchorState } from '$lib/tutorial/anchors';
import { jumped, MAX_ARROW, placementFlags, type PlaceMode, type Point, type RectLike, type Side } from './place';
import { rectOf } from './measure';
import { occupied, OCCUPIED } from './occupied.svelte';
import { popupDevHooks } from './dev';

export interface AuditDeps {
  actions: TutorialActions;
  loadState(): string;
  /** Load GPT-2 small if nothing is loaded. */
  ensureModel(): Promise<void>;
  startExperiment(id: string): Promise<void>;
  closeExperiment(): void;
  setCustomModelDialog(open: boolean): void;
}

type Phase = 'main' | 'guide-open' | 'guide-closed' | 'tour-with-guide';
type Kind = 'tour' | 'tip' | 'term' | 'hover';

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
  waiting: boolean;
  jumped: boolean;
  skipped?: string;
  failures: string[];
  rect?: RectLike;
  target?: RectLike | null;
  notes?: string[];
}

const IOI = 'When Mary and John went to the store, John gave a drink to';
const SEEN_KEYS = /^pry:(tip_seen:|tutorial_seen|tour_progress)/;

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
    waiting: false, jumped: false, failures: [], target,
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
  const focus = rec.mode === 'inset' ? readFocus(el) : null;
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
  switch (rec.mode) {
    case 'anchored':
      if (rec.overlapsTarget) f.push('anchored popup overlaps its target');
      if (opts.tour && (rec.arrowLen ?? 0) > MAX_ARROW) f.push(`arrow ${rec.arrowLen}px > ${MAX_ARROW}`);
      break;
    case 'inset':
      if (rec.coversFocus) f.push('inset popup covers the focus point');
      if (!rec.arrowExempt && (rec.arrowLen ?? Infinity) > MAX_ARROW) f.push(`inset arrow ${rec.arrowLen}px > ${MAX_ARROW}`);
      break;
    case 'sheet':
      if (window.innerWidth >= 760) f.push('sheet at a wide viewport');
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

function tourCtx(deps: AuditDeps): TourContext {
  return { ...deps.actions, setAttentionView: (view) => tutorialState.requestAttentionView(view) };
}

const card = () => document.querySelector('[data-testid="tour-card"]');
const activeTarget = () => document.querySelector('[data-tour-active="true"]');

function snapshot(el: Element | null, target: RectLike | null) {
  return {
    box: rectOf(el) ?? { left: 0, top: 0, width: 0, height: 0 },
    side: ((el?.getAttribute('data-popup-side') || null) as Side | null),
    mode: ((el?.getAttribute('data-popup-mode') || 'fallback') as PlaceMode),
    target,
  };
}

async function measureTourStep(deps: AuditDeps, step: TourStep, phase: Phase): Promise<AuditRecord> {
  const ctx = tourCtx(deps);
  progress(`${phase} tour ${step.id}`);
  // Wait for the card to show this step and the anchor to be found.
  await waitFor(() => card()?.getAttribute('data-step-id') === step.id, 5000);
  if (step.target) {
    const found = await waitFor(() => activeTarget() ?? null, 20000);
    if (!found) {
      const rec = measure(phase, 'tour', step.id, card(), null, [OCCUPIED.tourCard]);
      rec.skipped = `anchor "${step.target}" never appeared`;
      rec.failures.push(rec.skipped);
      return judge(rec, { tour: true });
    }
  }
  await settle(card);
  const t1 = rectOf(activeTarget());
  const first = snapshot(card(), t1);
  const rec = measure(phase, 'tour', step.id, card(), t1, [OCCUPIED.tourCard]);

  // Second measurement: after the step's run work settles, or 1s later.
  if (step.run && !step.run.skipIf?.(ctx)) {
    try {
      await step.run.act(ctx);
    } catch (e) {
      (rec.notes ??= []).push(`run threw: ${String(e)}`);
    }
    await sleep(500);
    await settle(activeTarget);
    await settle(card);
  } else {
    await sleep(1000);
  }
  const t2 = rectOf(activeTarget());
  const second = snapshot(card(), t2);
  rec.jumped = jumped(first, second);
  // Judge the later state too: the step has to look right after its work as well.
  const rec2 = measure(phase, 'tour', step.id, card(), t2, [OCCUPIED.tourCard]);
  rec.failures.push(...judge(rec2, { tour: true }).failures.map((f) => `after: ${f}`));
  return judge(rec, { tour: true, allowFallback: step.target === null });
}

async function tourPass(deps: AuditDeps, out: AuditRecord[]) {
  tutorialState.start();
  tutorialState.modelOfferDismissed = true;
  for (;;) {
    const step = tutorialState.currentStep;
    if (!step) break;
    out.push(await measureTourStep(deps, step, 'main'));
    if (tutorialState.isFinal) break;
    tutorialState.next();
    await frame();
  }
  tutorialState.close();
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

function guideRect(): RectLike | null {
  return occupied.entries().find(([k]) => k === OCCUPIED.guide)?.[1] ?? null;
}

async function measureTip(tipId: string, target: string, deps: AuditDeps, phase: Phase): Promise<AuditRecord> {
  const blank = (why: string): AuditRecord => ({
    phase, kind: 'tip', id: tipId, pass: false, mode: null, side: null, inViewport: false, overlapsTarget: false,
    coversFocus: false, overlapsAvoid: false, avoidHit: [], arrowLen: null, arrowExempt: false, waiting: false,
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
      // The tip released itself while settling: its target became unusable
      // (e.g. the guide covers it), which is the waiting case.
      if (!tipEl()) {
        const state = anchorState(el);
        res = { id: tipId, shown: false, waiting: state === 'covered', reason: `released: target ${state}` };
      }
    }
    if (!res.shown) {
      const rec = blank(`not shown: ${res.reason ?? 'unknown'}`);
      if (res.waiting) {
        rec.skipped = undefined;
        rec.failures = [];
        rec.waiting = true;
        rec.mode = 'fallback';
        rec.target = t;
        rec.inViewport = true;
        const g = guideRect();
        // The centre of the target's on-screen part (what anchorState probes).
        const c = t && {
          x: (Math.max(t.left, 0) + Math.min(t.left + t.width, window.innerWidth)) / 2,
          y: (Math.max(t.top, 0) + Math.min(t.top + t.height, window.innerHeight)) / 2,
        };
        const inGuide = !!(g && c && placementFlags(g, vp(), null, null, [{ left: c.x - 0.5, top: c.y - 0.5, width: 1, height: 1 }]).overlapsAvoid);
        if (phase !== 'guide-open') rec.failures.push('tip waiting outside the guide-open pass');
        else if (!inGuide) rec.failures.push('tip waiting but its target centre is not under the guide');
        rec.pass = rec.failures.length === 0;
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

async function guidePasses(deps: AuditDeps, out: AuditRecord[]) {
  await deps.startExperiment('induction');
  const g = await waitFor(() => guideRect(), 10000);
  if (!g) {
    out.push({ ...judge(measure('guide-open', 'tip', 'guide', null, null, [])), skipped: 'experiment guide never opened' });
    return;
  }
  const open: AuditRecord[] = [];
  await tipPass(deps, open, 'guide-open');
  out.push(...open);
  deps.closeExperiment();
  await waitFor(() => !guideRect(), 5000);
  const waiting = new Set(open.filter((r) => r.waiting).map((r) => r.id));
  if (waiting.size) await tipPass(deps, out, 'guide-closed', waiting);
}

/**
 * Tour with an experiment running (arch:R2-3): opening the tour collapses the
 * guide to its header, the card never covers that header, and starting an
 * experiment ends the tour.
 */
async function tourWithGuidePass(deps: AuditDeps, out: AuditRecord[]) {
  const record = (id: string, ok: boolean, failure: string, notes: string[] = []): AuditRecord => ({
    phase: 'tour-with-guide', kind: 'tour', id, pass: ok, mode: null, side: null, inViewport: true,
    overlapsTarget: false, coversFocus: false, overlapsAvoid: false, avoidHit: [], arrowLen: null,
    arrowExempt: false, waiting: false, jumped: false, failures: ok ? [] : [failure], notes,
  });
  await deps.startExperiment('induction');
  const full = await waitFor(() => guideRect(), 10000);
  if (!full) {
    out.push({ ...record('guide', false, 'experiment guide never opened'), skipped: 'experiment guide never opened' });
    return;
  }
  tutorialState.start();
  tutorialState.modelOfferDismissed = true;
  const collapsed = await waitFor(() => {
    const g = guideRect();
    return g && g.height < full.height - 1 ? g : null;
  }, 5000);
  out.push(record('guide-collapses', !!collapsed, 'guide did not collapse to its header when the tour opened', [
    `guide ${Math.round(full.height)}px -> ${collapsed ? Math.round(collapsed.height) : '?'}px`,
  ]));
  // The first few steps: header targets, a run button, a large panel.
  for (let i = 0; i < 5; i++) {
    const step = tutorialState.currentStep;
    if (!step) break;
    progress(`tour-with-guide ${step.id}`);
    await waitFor(() => card()?.getAttribute('data-step-id') === step.id, 5000);
    if (step.target) await waitFor(() => activeTarget(), 10000);
    await settle(card);
    out.push(judge(measure('tour-with-guide', 'tour', step.id, card(), rectOf(activeTarget()), [OCCUPIED.tourCard]), { tour: true }));
    tutorialState.next();
    await frame();
  }
  // Starting an experiment ends the tour.
  await deps.startExperiment('induction');
  const ended = await waitFor(() => !tutorialState.open, 5000);
  out.push(record('experiment-ends-tour', !!ended, 'starting an experiment left the tour open'));
  tutorialState.close();
  deps.closeExperiment();
  await waitFor(() => !guideRect(), 5000);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runPopupAudit(deps: AuditDeps, opts: { guideTour?: boolean } = {}) {
  const w = window as unknown as { __popupAudit?: unknown };
  const size = `${window.innerWidth}x${window.innerHeight}`;
  const records: AuditRecord[] = [];
  const saved = snapshotSeen();
  const started = Date.now();
  let error: string | null = null;
  try {
    // Natural tips stay quiet while the audit forces them one at a time.
    for (const tip of tipsRegistry) localStorage.setItem(`pry:tip_seen:${tip.id}`, 'true');
    if (tutorialState.open) tutorialState.close();

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

    await tourPass(deps, records);
    // Back to the fixed prompt for tips and tooltips.
    deps.actions.setCompareMode(false);
    if (deps.actions.response()?.prompt !== IOI) {
      deps.actions.setPrompt(IOI);
      await deps.actions.runGenerate();
    }
    await tipPass(deps, records, 'main');
    await termPass(deps, records);
    await hoverPass(deps, records);
    await guidePasses(deps, records);
    if (opts.guideTour) await tourWithGuidePass(deps, records);
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
    tourSteps: tourChapters.reduce((n, c) => n + c.steps.length, 0),
    seconds: Math.round((Date.now() - started) / 1000),
    records,
  };
  console.log(line);
  (window as unknown as { __popupAuditShow?: unknown }).__popupAuditShow = showStep;
  return line;
}

/** Driver helper for evidence screenshots: open the tour at `stepId` (null closes it). */
async function showStep(stepId: string | null): Promise<boolean> {
  const saved = snapshotSeen();
  try {
    if (!stepId) {
      tutorialState.close();
      return true;
    }
    const ci = tourChapters.findIndex((c) => c.steps.some((s) => s.id === stepId));
    if (ci < 0) return false;
    const si = tourChapters[ci].steps.findIndex((s) => s.id === stepId);
    tutorialState.goToChapter(ci);
    tutorialState.modelOfferDismissed = true;
    for (let i = 0; i < si; i++) {
      await frame();
      tutorialState.next();
    }
    await waitFor(() => card()?.getAttribute('data-step-id') === stepId, 5000);
    await waitFor(() => activeTarget(), 10000);
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
