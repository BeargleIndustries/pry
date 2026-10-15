// The Lessons runner (plan T3 "Runner"): one state machine, two presenters
// (LessonSidebar, OverlayPresenter), tool-agnostic. It reaches the tool only
// through its ToolActionSet and the dispatcher, the journal only through
// RunnerJournal, and never imports app code.
//
// On entry to a section: a new navigation (generation counter, abort the one
// before), then the section-by-section fold (section-state.ts), memoised, with
// `$earlier` bound from the journal. The current section's own do steps wait
// for the learner (predict first). "Setting up the app..." shows only past
// 300ms. A stateful action in flight (a model download) is never cancelled:
// the next entry waits for it ("Waiting for the model").

import type { Lesson, Section, Step, CheckItem, Slot } from '../format/schema';
import type { PointerTarget, Presenter, PresenterCommand, ToolActionSet } from '../registry/contract';
import type { RequestMemo } from '../registry/memo';
import { createDispatcher, resolveBindings, type BindingSources, type Dispatcher, type LessonSource } from '../registry/dispatcher';
import { allSteps } from '../format/normalise';
import { evaluateAssert, formatValue, renderSlot, slotFormat, slotValue, type SlotSource } from '../slots';
import { lessonsCopy } from '../copy';
import {
  looksIn,
  plainText,
  renderInline,
  renderProse,
  spineMasks,
  type CheckView,
  type RenderContext,
  type RenderedBlock,
  type RenderedStep,
  type RNode,
} from '../render';
import type { Progress } from '../progress';
import { NavControl, isAbort, type NavTicket } from './nav';
import { foldTo, applyContext } from './section-state';
import { CaptureStore, captureNames, readFrom, takeCapture } from './captures';
import { evaluateCheck, evaluateChecks, formatReading, predictionValue, type CheckEnv, type CheckOutcome } from './checks';
import { gateRun, judgeTask, newTaskState, runActions, type TaskFields, type TaskState } from './tasks';
import { HideControl } from './hide';
import { earlierText, earlierValue, earlierWords } from './earlier';
import type { RunnerJournal, RunnerJournalEntry, RunnerJournalKind } from './types';

export const SETUP_DELAY_MS = 300;

export interface RunnerDeps<VS> {
  set: ToolActionSet<VS>;
  memo: RequestMemo;
  journal: RunnerJournal;
  progress?: Progress;
  /** rows.json values for one row id (`$row.<id>.<field>`, `{row: ...}` slots). */
  rows?(id: string): unknown;
  /** The model the tool holds now. */
  currentModel?(): string | null;
  /** A model id as the learner reads it ("GPT-2 small"). */
  modelName?(id: string): string;
  log?(e: { lessonId?: string; stepId?: string; message: string; effect?: string; scope?: string }): void;
  now?(): Date;
  setupDelayMs?: number;
  /** Debug builds reconcile snapshot() after each replayed step. */
  debug?: boolean;
  authorMode?(): boolean;
  /** A `lesson:<id>#<section>` link to another lesson. */
  openOther?(lessonId: string, sectionId: string | null): void;
}

export interface OpenOptions {
  source: LessonSource;
  sourceKind?: 'bundled' | 'user';
  sectionId?: string | null;
  /** Lesson-relative image path -> URL. */
  images?: Record<string, string>;
}

/** Commands a presenter sends inside `{ commit }`. */
export type RunnerCommand =
  | { type: 'answer'; step: string; choice?: number; text?: string }
  | { type: 'skip'; step: string }
  | { type: 'pick'; step: string }
  | { type: 'do'; step: string }
  | { type: 'show'; step: string }
  | { type: 'note'; step: string; text: string }
  | { type: 'chain'; step: string; text: string }
  | { type: 'chain-skip'; step: string }
  | { type: 'same'; step: string; text: string }
  | { type: 'task-predict'; step: string; text: string }
  | { type: 'task-args'; step: string; args: Record<string, unknown> }
  | { type: 'task-run'; step: string }
  | { type: 'task-check'; step: string }
  | { type: 'task-reset'; step: string }
  | { type: 'goto'; section: number | string }
  | { type: 'switch-model' }
  | { type: 'fix-drift' }
  | { type: 'rerun-setup' }
  | { type: 'link'; href: string }
  | { type: 'look'; at: PointerTarget[] };

interface StepState {
  choice: number | null;
  text: string;
  pick: unknown;
  locked: boolean;
  skipped: boolean;
  picking: boolean;
  // do
  doState: 'ready' | 'running' | 'done' | 'failed' | 'blocked';
  doMessage: string | null;
  // observe
  revealed: boolean;
  result: CheckOutcome | null;
  note: string | null;
  // explain-chain
  chainText: string;
  written: boolean;
  nudging: boolean;
  nudged: boolean;
  // compare
  same: string | null;
  task: TaskState | null;
  taskRan: boolean;
}

function blankState(): StepState {
  return {
    choice: null,
    text: '',
    pick: undefined,
    locked: false,
    skipped: false,
    picking: false,
    doState: 'ready',
    doMessage: null,
    revealed: false,
    result: null,
    note: null,
    chainText: '',
    written: false,
    nudging: false,
    nudged: false,
    same: null,
    task: null,
    taskRan: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : typeof v === 'string' ? [v] : []);
const pickField = (v: unknown, f?: string) => (f && isObj(v) ? v[f] : v);

export class LessonRunner<VS = unknown> {
  readonly deps: RunnerDeps<VS>;
  readonly set: ToolActionSet<VS>;

  lesson = $state.raw<Lesson | null>(null);
  index = $state(0);
  busy = $state<string | null>(null);
  banner = $state<{ model: string } | null>(null);
  error = $state<string | null>(null);
  entering = $state(false);
  /** Bumped on every internal change, so a derived view recomputes. */
  rev = $state(0);

  #source: LessonSource = { kind: 'bundled' };
  #sourceKind: 'bundled' | 'user' = 'bundled';
  #images: Record<string, string> = {};
  #nav = new NavControl();
  #visit: NavTicket | null = null;
  #dispatcher: Dispatcher | null = null;
  #states = new Map<string, StepState>();
  #visited = new Set<string>();
  #expected: string | null = null;
  #before: unknown = undefined;
  #baseline: unknown = undefined;
  #stateful: Promise<unknown> | null = null;
  /** Runner-issued work still in flight (folds, do steps, task runs). */
  #pending = new Set<Promise<unknown>>();
  #presenters: Presenter[] = [];
  #notes: string[] = [];
  #looks: PointerTarget[] = [];
  readonly captures: CaptureStore;
  readonly hide: HideControl;
  readonly journal: RunnerJournal;

  constructor(deps: RunnerDeps<VS>) {
    this.deps = deps;
    this.set = deps.set;
    const j = deps.journal;
    const id = () => this.lesson?.meta.id ?? '';
    // Remember keys are written as `<lesson id>.<key>`; a bare key reads this lesson's.
    this.journal = {
      earlier: (key) => j.earlier(key) ?? (id() && !key.startsWith(`${id()}.`) ? j.earlier(`${id()}.${key}`) : null),
      capture: (lessonId, name) => j.capture(lessonId, name),
      last: (lessonId, stepId) => j.last?.(lessonId, stepId) ?? null,
      write: (e) => j.write(e),
    };
    this.captures = new CaptureStore(this.journal, id);
    this.hide = new HideControl(() => this.set.anchors);
  }

  // -------------------------------------------------------------------------
  // Presenters
  // -------------------------------------------------------------------------

  attach(p: Presenter): () => void {
    this.#presenters.push(p);
    p.onCommand((c) => void this.command(c));
    if (this.lesson) this.refresh();
    return () => {
      this.#presenters = this.#presenters.filter((x) => x !== p);
    };
  }

  /** Re-renders and hands the presenters the current step and its pointers. */
  refresh(): void {
    this.rev++;
    if (!this.lesson) return;
    const step = this.render();
    const nav = { index: this.index, total: this.lesson.sections.length, canBack: this.index > 0 };
    for (const p of this.#presenters) p.show(step, nav);
    const looks = this.activeLooks(step);
    if (JSON.stringify(looks) !== JSON.stringify(this.#looks)) {
      this.#looks = looks;
      for (const p of this.#presenters) {
        p.clearPointer();
        if (looks.length === 1) p.point(looks[0]);
        else looks.forEach((t, i) => p.point(t, i));
      }
    }
  }

  async command(c: PresenterCommand): Promise<void> {
    if (c === 'next') return this.next();
    if (c === 'back') return this.back();
    if (c === 'exit') return this.close();
    if (c === 'skip') return this.close();
    const r = c.commit as RunnerCommand;
    switch (r.type) {
      case 'answer':
        return this.answer(r.step, { choice: r.choice, text: r.text });
      case 'skip':
        return this.skipStep(r.step);
      case 'pick':
        return this.startPick(r.step);
      case 'do':
        return this.doStep(r.step);
      case 'show':
        return this.showObserve(r.step);
      case 'note':
        return this.observeNote(r.step, r.text);
      case 'chain':
        return this.writeChain(r.step, r.text);
      case 'chain-skip':
        return this.skipChain(r.step);
      case 'same':
        return this.answerSame(r.step, r.text);
      case 'task-predict':
        return this.taskPredict(r.step, r.text);
      case 'task-args':
        return this.taskArgs(r.step, r.args);
      case 'task-run':
        return this.taskRun(r.step);
      case 'task-check':
        return this.taskCheck(r.step);
      case 'task-reset':
        return this.taskReset(r.step);
      case 'goto':
        return this.goto(typeof r.section === 'number' ? r.section : this.sectionIndex(r.section));
      case 'switch-model':
        return this.switchModel();
      case 'fix-drift':
      case 'rerun-setup':
        return this.goto(this.index);
      case 'link':
        return this.openLink(r.href);
      case 'look':
        this.#looks = r.at;
        for (const p of this.#presenters) {
          p.clearPointer();
          if (r.at.length === 1) p.point(r.at[0]);
          else r.at.forEach((t, i) => p.point(t, i));
        }
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Lesson lifecycle and navigation
  // -------------------------------------------------------------------------

  get section(): Section | null {
    return this.lesson?.sections[this.index] ?? null;
  }

  sectionIndex(id: string): number {
    return Math.max(0, this.lesson?.sections.findIndex((s) => s.id === id) ?? 0);
  }

  async open(lesson: Lesson, opts: OpenOptions): Promise<void> {
    this.close();
    this.lesson = lesson;
    this.#source = opts.source;
    this.#sourceKind = opts.sourceKind ?? (opts.source.kind === 'user' ? 'user' : 'bundled');
    this.#images = opts.images ?? {};
    this.#dispatcher = createDispatcher(this.set, this.deps.memo, opts.source);
    this.#states.clear();
    this.#visited.clear();
    this.captures.clear();
    this.#notes = [...lesson.authorNotes];
    const start = opts.sectionId ? this.sectionIndex(opts.sectionId) : this.resumeIndex(lesson);
    await this.goto(start);
  }

  private resumeIndex(lesson: Lesson): number {
    const last = this.deps.progress?.of(lesson.meta.id)?.last;
    const i = last ? lesson.sections.findIndex((s) => s.id === last) : -1;
    return i < 0 ? 0 : i;
  }

  close(): void {
    if (this.lesson) this.leaveSection();
    this.#nav.cancel();
    this.#visit = null;
    this.hide.reveal();
    for (const p of this.#presenters) p.clearPointer();
    this.#looks = [];
    this.lesson = null;
    this.busy = null;
    this.banner = null;
    this.error = null;
    this.entering = false;
    this.rev++;
  }

  /** Sections the learner's committed skip_check answers skip (test-out). */
  skippedSections(): Set<string> {
    const out = new Set<string>();
    const lesson = this.lesson;
    if (!lesson) return out;
    for (const sec of lesson.sections) {
      for (const st of allSteps(sec.steps)) {
        const sc = st.fields.skip_check;
        if (st.kind !== 'predict' || !isObj(sc)) continue;
        const conds = (sc.when as { step: string; choice: number | string }[]) ?? [];
        const all = conds.every((w) => this.choiceMatches(w.step, w.choice));
        if (all) for (const s of list(sc.skip)) out.add(s);
      }
    }
    return out;
  }

  private choiceMatches(stepId: string, choice: number | string): boolean {
    const found = this.findStep(stepId);
    if (!found) return false;
    const st = this.#states.get(this.keyOf(found.section, found.step));
    if (!st?.locked || st.skipped || st.choice === null) return false;
    const choices = (found.step.fields.choices ?? []) as { text: string }[];
    const text = choices[st.choice]?.text;
    if (text !== undefined && text === String(choice)) return true;
    if (typeof choice === 'number' && !choices.some((c) => c.text === String(choice))) return st.choice + 1 === choice;
    return false;
  }

  async next(): Promise<void> {
    const lesson = this.lesson;
    if (!lesson) return;
    const skip = this.skippedSections();
    let i = this.index + 1;
    while (i < lesson.sections.length && skip.has(lesson.sections[i].id)) i++;
    if (i >= lesson.sections.length) {
      this.leaveSection();
      this.deps.progress?.finish(lesson.meta.id);
      this.refresh();
      return;
    }
    return this.goto(i);
  }

  async back(): Promise<void> {
    const lesson = this.lesson;
    if (!lesson || this.index === 0) return;
    const skip = this.skippedSections();
    let i = this.index - 1;
    while (i > 0 && skip.has(lesson.sections[i].id)) i--;
    return this.goto(i);
  }

  /** Writes a task's remember / capture when the learner moves on after running it. */
  private leaveSection(): void {
    const sec = this.section;
    if (!sec) return;
    for (const step of allSteps(sec.steps)) {
      if (step.kind !== 'task') continue;
      const st = this.#states.get(this.keyOf(sec, step));
      if (st?.task && st.taskRan && !st.task.stored) this.storeTask(sec, step, st);
    }
    this.hide.reveal();
  }

  /** Tracks runner-issued work so the next navigation can let it settle first. */
  private track<T>(p: Promise<T>): Promise<T> {
    this.#pending.add(p);
    void p.finally(() => this.#pending.delete(p)).catch(() => {});
    return p;
  }

  /** Enters section `i` (0-based). Newest navigation wins. */
  async goto(i: number): Promise<void> {
    const before = [...this.#pending];
    return this.track(this.enter(i, before));
  }

  private async enter(i: number, before: Promise<unknown>[]): Promise<void> {
    const lesson = this.lesson;
    if (!lesson) return;
    const target = Math.min(Math.max(0, i), lesson.sections.length - 1);
    if (this.section && target !== this.index) this.leaveSection();
    const ticket = this.#nav.begin();
    this.#visit = ticket;
    this.hide.reveal();
    this.index = target;
    this.error = null;
    this.entering = true;
    this.#expected = null;
    this.#before = undefined;
    const sec = lesson.sections[target];
    this.resetVisit(sec);
    this.#visited.add(sec.id);
    this.deps.progress?.visitSection(lesson.meta.id, sec.id);
    const delay = this.deps.setupDelayMs ?? SETUP_DELAY_MS;
    const timer = setTimeout(() => {
      if (this.#nav.current(ticket) && this.entering) {
        this.busy = this.busy ?? lessonsCopy.settingUp;
        this.refresh();
      }
    }, delay);
    this.refresh();
    try {
      if (this.#stateful) {
        this.busy = lessonsCopy.waitingForModel;
        this.refresh();
        await this.#stateful.catch(() => {});
        if (!this.#nav.current(ticket)) return;
      }
      // Work the last navigation started is aborted; let its in-flight requests
      // land before this fold, so a late answer can't overwrite this section's
      // scene (apply then puts every field where this section wants it).
      if (before.length) {
        await Promise.allSettled(before);
        if (!this.#nav.current(ticket)) return;
      }
      const r = await foldTo(lesson, target + 1, this.foldDeps(), ticket.signal);
      if (!this.#nav.current(ticket)) return; // a newer navigation owns the screen
      if (r.status === 'model') this.banner = { model: r.model };
      else if (r.status === 'error') {
        const msg = r.error instanceof Error ? r.error.message : String(r.error);
        this.error = lessonsCopy.stepFailed(msg);
        this.deps.log?.({ lessonId: lesson.meta.id, message: `apply failed: ${msg}` });
      } else if (r.status === 'aborted') {
        this.deps.log?.({ lessonId: lesson.meta.id, message: 'apply aborted' });
      }
      if (r.status !== 'model') this.banner = this.mismatch();
      // Predict hides: hidden until the learner commits or skips.
      for (const step of allSteps(sec.steps)) {
        if (step.kind !== 'predict') continue;
        const st = this.state(sec, step);
        if (!st.locked && !st.skipped) this.hide.hide(list(step.fields.hides));
      }
      this.#expected = this.snapshotKey();
    } finally {
      clearTimeout(timer);
      if (this.#nav.current(ticket)) {
        this.entering = false;
        this.busy = null;
        this.refresh();
      }
    }
  }

  private foldDeps() {
    const lesson = this.lesson!;
    return {
      set: this.set,
      dispatcher: this.#dispatcher!,
      memo: this.deps.memo,
      bindings: this.bindings(),
      captures: this.captures,
      currentModel: () => this.deps.currentModel?.() ?? null,
      wait: (msg: string) => {
        this.busy = msg;
        this.refresh();
      },
      when: (step: Step) => this.whenHolds(step),
      onBaseline: () => {
        this.#baseline = takeCapture(this.set);
      },
      debug: this.deps.debug,
      log: (msg: string, step?: Step) => this.deps.log?.({ lessonId: lesson.meta.id, stepId: step?.id, message: msg }),
    };
  }

  /** Per-visit state resets: do steps, observes and tasks start fresh; answers stay. */
  private resetVisit(sec: Section): void {
    for (const step of allSteps(sec.steps)) {
      const st = this.state(sec, step);
      st.doState = 'ready';
      st.doMessage = null;
      st.revealed = false;
      st.result = null;
      st.picking = false;
      st.nudging = false;
      st.task = step.kind === 'task' ? newTaskState() : null;
      st.taskRan = false;
      if (step.kind === 'task') st.task!.pendingArgs = this.initialChangeArgs(step);
    }
  }

  private mismatch(): { model: string } | null {
    const want = this.lesson?.meta.model;
    const have = this.deps.currentModel?.() ?? null;
    return want && have && want !== have ? { model: want } : null;
  }

  private async switchModel(): Promise<void> {
    const model = this.banner?.model ?? this.lesson?.meta.model;
    if (!model || !this.#dispatcher) return;
    const p = this.#dispatcher.dispatch('switch_model', { preset: model }, { signal: new AbortController().signal });
    this.#stateful = p;
    this.busy = lessonsCopy.waitingForModel;
    this.refresh();
    try {
      const r = await p;
      if (r.status === 'blocked') this.error = lessonsCopy.blocked;
    } catch (e) {
      this.error = lessonsCopy.stepFailed(e instanceof Error ? e.message : String(e));
    } finally {
      if (this.#stateful === p) this.#stateful = null;
    }
    this.banner = null;
    await this.goto(this.index);
  }

  private async openLink(href: string): Promise<void> {
    const m = /^lesson:([^#\s]+)(?:#(.+))?$/.exec(href);
    if (m) {
      if (m[1] === this.lesson?.meta.id) return this.goto(m[2] ? this.sectionIndex(m[2]) : 0);
      this.deps.openOther?.(m[1], m[2] ?? null);
      return;
    }
    if (!this.#dispatcher || !this.set.actions.open_link) return;
    try {
      const r = await this.#dispatcher.dispatch('open_link', { url: href }, { signal: new AbortController().signal });
      if (r.status === 'blocked') {
        this.error = lessonsCopy.blocked;
        this.deps.log?.({ lessonId: this.lesson?.meta.id, message: 'dispatcher blocked a link', effect: r.effect, scope: r.scope });
        this.refresh();
      }
    } catch (e) {
      this.deps.log?.({ lessonId: this.lesson?.meta.id, message: `link failed: ${String(e)}` });
    }
  }

  // -------------------------------------------------------------------------
  // Steps
  // -------------------------------------------------------------------------

  keyOf(sec: Section, step: Step): string {
    return step.id ?? `${sec.id}@${step.line}`;
  }

  private state(sec: Section, step: Step): StepState {
    const k = this.keyOf(sec, step);
    let st = this.#states.get(k);
    if (!st) {
      st = blankState();
      if (step.kind === 'task') {
        st.task = newTaskState();
        st.task.pendingArgs = this.initialChangeArgs(step);
      }
      this.#states.set(k, st);
    }
    return st;
  }

  /** Finds a step by key (id or section@line) anywhere in the lesson. */
  findStep(key: string): { section: Section; step: Step } | null {
    for (const section of this.lesson?.sections ?? []) {
      for (const step of allSteps(section.steps)) if (this.keyOf(section, step) === key) return { section, step };
    }
    return null;
  }

  private stepState(key: string): { section: Section; step: Step; st: StepState } | null {
    const f = this.findStep(key);
    return f ? { ...f, st: this.state(f.section, f.step) } : null;
  }

  private qualify(key: string): string {
    const id = this.lesson?.meta.id ?? '';
    return key.startsWith(`${id}.`) || key.includes('.') ? key : `${id}.${key}`;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private write(sec: Section, step: Step, kind: RunnerJournalKind, part: Partial<RunnerJournalEntry>): void {
    const lesson = this.lesson;
    if (!lesson) return;
    const at = this.now().toISOString();
    const entry: RunnerJournalEntry = {
      id: `${lesson.meta.id}:${this.keyOf(sec, step)}:${at}:${Math.random().toString(36).slice(2, 8)}`,
      at,
      lesson: { id: lesson.meta.id, version: String(lesson.meta.version ?? '1'), source: this.#sourceKind },
      sectionId: sec.id,
      stepId: this.keyOf(sec, step),
      kind,
      question: plainText(step.prose.flatMap((p) => renderProse(p.text, this.renderCtx(sec)))).trim() || String(step.fields.question ?? ''),
      answer: {},
      skipped: false,
      committedAt: at,
      ...part,
    };
    void Promise.resolve(this.journal.write(entry)).catch((e) =>
      this.deps.log?.({ lessonId: lesson.meta.id, stepId: entry.stepId, message: `journal write failed: ${String(e)}` }),
    );
    this.deps.progress?.finishStep(lesson.meta.id, entry.stepId);
  }

  async answer(key: string, a: { choice?: number; text?: string }): Promise<void> {
    const f = this.stepState(key);
    if (!f || f.st.locked) return;
    const { section, step, st } = f;
    if (a.choice !== undefined) st.choice = a.choice;
    if (a.text !== undefined) st.text = a.text;
    const choices = (step.fields.choices ?? []) as { text: string }[];
    const choiceText = st.choice !== null ? choices[st.choice]?.text : undefined;
    if (choiceText === undefined && !st.text.trim() && st.pick === undefined) return;
    st.locked = true;
    if (step.kind === 'predict') this.hide.reveal(list(step.fields.hides));
    const remember = typeof step.fields.remember === 'string' ? this.qualify(step.fields.remember) : undefined;
    const kind: RunnerJournalKind = step.kind === 'recall' ? 'recall' : step.kind === 'question' ? 'question' : 'predict';
    this.write(section, step, kind, {
      answer: { ...(choiceText !== undefined ? { choice: choiceText } : {}), ...(st.text.trim() ? { text: st.text.trim() } : {}), ...(st.pick !== undefined ? { pick: st.pick } : {}) },
      remember,
    });
    this.#expected = this.snapshotKey();
    this.refresh();
  }

  async skipStep(key: string): Promise<void> {
    const f = this.stepState(key);
    if (!f || f.st.locked) return;
    const { section, step, st } = f;
    st.skipped = true;
    st.locked = true;
    st.picking = false;
    this.hide.reveal(list(step.fields.hides));
    const remember = typeof step.fields.remember === 'string' ? this.qualify(step.fields.remember) : undefined;
    this.write(section, step, step.kind === 'question' ? 'question' : step.kind === 'recall' ? 'recall' : 'predict', { skipped: true, remember });
    this.#expected = this.snapshotKey();
    this.refresh();
  }

  async startPick(key: string): Promise<void> {
    const f = this.stepState(key);
    if (!f || f.st.locked || !this.#visit) return;
    const kind = String(f.step.fields.pick ?? '');
    const picker = this.set.pickers[kind];
    if (!picker) return;
    f.st.picking = true;
    this.refresh();
    try {
      const v = await picker.start(this.#visit.signal);
      f.st.pick = v;
    } catch (e) {
      if (!isAbort(e)) this.deps.log?.({ lessonId: this.lesson?.meta.id, stepId: key, message: `picker failed: ${String(e)}` });
    } finally {
      f.st.picking = false;
      this.refresh();
    }
  }

  private markBefore(): void {
    if (this.#before === undefined) this.#before = takeCapture(this.set) ?? null;
  }

  async doStep(key: string): Promise<void> {
    const f = this.stepState(key);
    const ticket = this.#visit;
    if (!f || !ticket || !this.#dispatcher || f.st.doState === 'running') return;
    const { section, step, st } = f;
    this.markBefore();
    st.doState = 'running';
    st.doMessage = null;
    this.refresh();
    try {
      for (const a of step.actions) {
        const def = this.set.actions[a.name];
        const run = this.track(this.#dispatcher.dispatch(a.name, a.args, {
          signal: ticket.signal,
          bindings: this.bindings(),
          fresh: step.fields.fresh === true,
          wait: (m) => {
            this.busy = m;
            this.refresh();
          },
        }));
        if (def?.stateful) {
          this.#stateful = run;
          void run.finally(() => {
            if (this.#stateful === run) this.#stateful = null;
          }).catch(() => {});
        }
        const r = await run;
        if (r.status === 'blocked') {
          st.doState = 'blocked';
          st.doMessage = lessonsCopy.blocked;
          this.deps.log?.({ lessonId: this.lesson?.meta.id, stepId: key, message: 'dispatcher blocked an action', effect: r.effect, scope: r.scope });
          this.refresh();
          return;
        }
        if (r.status === 'aborted' || !this.#nav.current(ticket)) return;
      }
      if (!this.#nav.current(ticket)) return;
      st.doState = 'done';
      const cap = step.fields.capture;
      if (typeof cap === 'string') {
        const v = takeCapture(this.set);
        if (v !== undefined) {
          this.captures.set(cap, v);
          this.write(section, step, 'capture', { capture: { name: cap, readouts: { result: v } } });
        }
      }
      // A revealed observe re-checks after its do step runs again.
      for (const s2 of allSteps(section.steps)) {
        const o = this.#states.get(this.keyOf(section, s2));
        if (s2.kind === 'observe' && o?.revealed && isObj(s2.fields) && s2.fields.check) o.result = this.checkObserve(section, s2);
      }
      this.#expected = this.snapshotKey();
    } catch (e) {
      if (isAbort(e) || !this.#nav.current(ticket)) return;
      st.doState = 'failed';
      st.doMessage = lessonsCopy.stepFailed(e instanceof Error ? e.message : String(e));
      this.deps.log?.({ lessonId: this.lesson?.meta.id, stepId: key, message: `do step failed: ${String(e)}` });
    } finally {
      if (this.busy && !this.entering) this.busy = null;
      if (this.#nav.current(ticket)) this.refresh();
    }
  }

  /** The predict that `checks=` this observe. */
  private predictFor(observe: Step): { section: Section; step: Step } | null {
    if (!observe.id) return null;
    for (const section of this.lesson?.sections ?? []) {
      for (const step of allSteps(section.steps)) if (step.kind === 'predict' && step.fields.checks === observe.id) return { section, step };
    }
    return null;
  }

  private predictionOf(sec: Section, step: Step): unknown {
    const st = this.#states.get(this.keyOf(sec, step));
    if (!st || st.skipped) return undefined;
    const choices = (step.fields.choices ?? []) as { text: string }[];
    if (st.choice !== null && choices[st.choice]) return predictionValue(choices[st.choice].text);
    if (st.pick !== undefined) return st.pick;
    return st.text.trim() || undefined;
  }

  private checkObserve(sec: Section, step: Step): CheckOutcome | null {
    const check = step.fields.check as CheckItem | CheckItem[] | undefined;
    if (!check) return null;
    const p = this.predictFor(step);
    const prediction = p ? this.predictionOf(p.section, p.step) : undefined;
    return evaluateChecks(check, this.env({ prediction }));
  }

  /** An observe can show its result once its predict is answered and the section's do steps before it ran this visit. */
  private observeWaiting(sec: Section, step: Step): boolean {
    const p = this.predictFor(step);
    if (p) {
      const ps = this.#states.get(this.keyOf(p.section, p.step));
      if (!ps?.locked) return true;
    }
    for (const s of allSteps(sec.steps)) {
      if (s === step) break;
      if (s.kind === 'do' && this.whenHolds(s) && this.state(sec, s).doState !== 'done') return true;
    }
    return false;
  }

  async showObserve(key: string): Promise<void> {
    const f = this.stepState(key);
    if (!f) return;
    const { section, step, st } = f;
    if (this.observeWaiting(section, step)) return;
    st.revealed = true;
    st.result = this.checkObserve(section, step);
    const o = st.result;
    this.write(section, step, 'observe', {
      answer: st.note ? { text: st.note } : {},
      ...(o
        ? { check: { read: o.item.read, op: o.item.op, binding: o.binding, expected: o.expected, actual: o.actual, agrees: o.agrees === true } }
        : {}),
      slots: this.slotRecord(section),
    });
    this.refresh();
  }

  async observeNote(key: string, text: string): Promise<void> {
    const f = this.stepState(key);
    if (!f) return;
    f.st.note = text.trim() || null;
    if (f.step.fields.journal === true) {
      f.st.revealed = true;
      this.write(f.section, f.step, 'observe', { answer: { text: text.trim() }, skipped: !text.trim(), slots: this.slotRecord(f.section) });
    }
    this.refresh();
  }

  async writeChain(key: string, text: string): Promise<void> {
    const f = this.stepState(key);
    if (!f || !text.trim()) return;
    f.st.chainText = text.trim();
    f.st.written = true;
    f.st.nudging = false;
    this.write(f.section, f.step, 'explain-chain', { answer: { text: text.trim() } });
    this.refresh();
  }

  /** "Skip" on explain-chain: nudges once, then skips. */
  async skipChain(key: string): Promise<void> {
    const f = this.stepState(key);
    if (!f) return;
    if (!f.st.nudged) {
      f.st.nudged = true;
      f.st.nudging = true;
      this.refresh();
      return;
    }
    f.st.nudging = false;
    f.st.skipped = true;
    this.write(f.section, f.step, 'explain-chain', { skipped: true });
    this.refresh();
  }

  async answerSame(key: string, text: string): Promise<void> {
    const f = this.stepState(key);
    if (!f) return;
    f.st.same = text.trim();
    this.write(f.section, f.step, 'compare', { answer: { text: text.trim() } });
    this.refresh();
  }

  // ---- Tasks ----

  private taskOf(key: string): { section: Section; step: Step; st: StepState; task: TaskFields; ts: TaskState } | null {
    const f = this.stepState(key);
    if (!f || f.step.kind !== 'task') return null;
    if (!f.st.task) f.st.task = newTaskState();
    return { ...f, task: f.step.fields as TaskFields, ts: f.st.task };
  }

  private initialChangeArgs(step: Step): Record<string, unknown> | null {
    const oc = step.fields.one_change;
    if (typeof oc !== 'string') return null;
    const reset = step.fields.reset;
    const noun = oc.replace(/^set_/, '');
    if (isObj(reset) && isObj(reset[noun])) return { ...(reset[noun] as Record<string, unknown>) };
    return {};
  }

  async taskPredict(key: string, text: string): Promise<void> {
    const t = this.taskOf(key);
    if (!t) return;
    t.ts.prediction = text;
    this.rev++;
  }

  async taskArgs(key: string, args: Record<string, unknown>): Promise<void> {
    const t = this.taskOf(key);
    if (!t) return;
    t.ts.pendingArgs = { ...(t.ts.pendingArgs ?? {}), ...args };
    this.rev++;
  }

  async taskRun(key: string): Promise<void> {
    const t = this.taskOf(key);
    const ticket = this.#visit;
    if (!t || !ticket || !this.#dispatcher) return;
    const { task, ts } = t;
    const gate = gateRun(task, ts, this.env({ prediction: ts.prediction }), this.set);
    if (!gate.ok) {
      ts.message = gate.message;
      this.refresh();
      return;
    }
    this.markBefore();
    try {
      for (const a of runActions(task, this.set, ts.pendingArgs)) {
        const r = await this.track(this.#dispatcher.dispatch(a.name, a.args, { signal: ticket.signal, bindings: this.bindings() }));
        if (r.status === 'blocked') {
          ts.message = lessonsCopy.blocked;
          this.refresh();
          return;
        }
        if (r.status === 'aborted' || !this.#nav.current(ticket)) return;
      }
    } catch (e) {
      if (isAbort(e) || !this.#nav.current(ticket)) return;
      // A failed run is never judged: the checks would read the run before it (critic r3).
      ts.message = lessonsCopy.stepFailed(e instanceof Error ? e.message : String(e));
      this.refresh();
      return;
    }
    ts.runs += 1;
    ts.lastArgs = ts.pendingArgs ? { ...ts.pendingArgs } : null;
    const prediction = ts.prediction;
    ts.prediction = '';
    t.st.taskRan = true;
    const j = judgeTask(task, this.env({ prediction }), this.set);
    ts.met = j.met;
    ts.message = j.met ? j.message : j.message;
    if (j.met) this.storeTask(t.section, t.step, t.st);
    this.write(t.section, t.step, 'task', { answer: { text: prediction || undefined, value: { run: ts.runs, met: j.met } } });
    this.#expected = this.snapshotKey();
    this.refresh();
  }

  async taskCheck(key: string): Promise<void> {
    const t = this.taskOf(key);
    if (!t) return;
    const j = judgeTask(t.task, this.env({ prediction: t.ts.prediction }), this.set);
    t.ts.met = j.met;
    t.ts.message = j.message;
    if (j.met) {
      t.st.taskRan = true;
      this.storeTask(t.section, t.step, t.st);
    }
    this.refresh();
  }

  async taskReset(key: string): Promise<void> {
    const t = this.taskOf(key);
    const ticket = this.#visit;
    if (!t || !ticket || t.task.reset === undefined) return;
    const overlay = resolveBindings(t.task.reset, this.bindings());
    const s = this.set.target(this.lesson?.meta.baseline ?? {}, overlay, this.set.snapshot());
    try {
      await this.set.apply(s, applyContext(this.set as ToolActionSet<unknown>, this.deps.memo, ticket.signal));
    } catch (e) {
      if (!isAbort(e)) t.ts.message = lessonsCopy.stepFailed(e instanceof Error ? e.message : String(e));
    }
    t.ts.met = false;
    t.ts.pendingArgs = this.initialChangeArgs(t.step);
    this.#expected = this.snapshotKey();
    this.refresh();
  }

  /** remember: {key, read} and capture, once per visit. */
  private storeTask(sec: Section, step: Step, st: StepState): void {
    if (!st.task || st.task.stored) return;
    st.task.stored = true;
    const f = step.fields as TaskFields;
    if (f.remember) {
      const v = readFrom(this.set, f.remember.read, this.resolveArgs(f.remember.args));
      this.write(sec, step, 'task', { answer: { value: v }, remember: this.qualify(f.remember.key) });
    }
    if (f.capture) {
      const v = takeCapture(this.set);
      if (v !== undefined) {
        this.captures.set(f.capture, v);
        this.write(sec, step, 'capture', { capture: { name: f.capture, readouts: { result: v } } });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Values: bindings, slots, checks
  // -------------------------------------------------------------------------

  rowValue(id: string, field?: string): unknown {
    const r = this.deps.rows?.(id);
    if (!field) return r;
    let v: unknown = r;
    for (const k of field.split('.')) v = isObj(v) ? v[k] : undefined;
    return v;
  }

  bindings(): BindingSources {
    return {
      earlier: (key) => earlierValue(this.journal, key),
      row: (id, field) => this.rowValue(id, field),
    };
  }

  resolveArgs(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!args) return undefined;
    return resolveBindings(args, this.bindings()) as Record<string, unknown>;
  }

  private slots(sec: Section | null): Record<string, Slot> {
    return { ...(this.lesson?.meta.slots ?? {}), ...(sec?.slots ?? {}) };
  }

  slotSource(): SlotSource {
    return {
      read: (name, args, capture) => {
        const cap = capture ? this.captures.get(capture) : undefined;
        if (capture && cap === undefined) return undefined;
        return readFrom(this.set, name, this.resolveArgs(args), cap);
      },
      readouts: this.set.readouts,
    };
  }

  private slotRecord(sec: Section): Record<string, { live: unknown; expect: unknown }> {
    const slots = this.slots(sec);
    const src = this.slotSource();
    const out: Record<string, { live: unknown; expect: unknown }> = {};
    for (const [name, s] of Object.entries(slots)) out[name] = { live: slotValue(name, slots, src) ?? null, expect: s.expect ?? null };
    return out;
  }

  env(o: { prediction?: unknown } = {}): CheckEnv {
    const sec = this.section;
    const slots = this.slots(sec);
    const src = this.slotSource();
    const mm = this.mismatch();
    return {
      set: this.set,
      read: (readout, args, from) => {
        if (from) {
          const cap = this.captures.get(from);
          return cap === undefined ? undefined : readFrom(this.set, readout, args, cap);
        }
        return readFrom(this.set, readout, args);
      },
      prediction: o.prediction,
      before: (readout, args) => (this.#before ? readFrom(this.set, readout, args, this.#before) : readFrom(this.set, readout, args)),
      baseline: (readout, args) => (this.#baseline !== undefined ? readFrom(this.set, readout, args, this.#baseline) : undefined),
      earlier: (key) => earlierValue(this.journal, key),
      row: (id, field) => this.rowValue(id, field),
      slot: (name) => {
        const s = slots[name];
        if (!s) return undefined;
        if (typeof s.expect === 'number') return s.expect;
        return slotValue(name, slots, src);
      },
      resolveArgs: (a) => this.resolveArgs(a),
      mismatch: mm ? { model: this.deps.modelName?.(mm.model) ?? mm.model } : null,
    };
  }

  /** A step's `when` (missing readout = the condition doesn't hold; its `not` sibling shows). */
  whenHolds(step: Step): boolean {
    const w = step.fields.when as CheckItem | undefined;
    if (!w) return true;
    const o = evaluateCheck({ ...w, not: false }, this.env());
    const held = o.agrees === true;
    return w.not ? !held : held;
  }

  /** The tool's state as a comparable string (the drift chip). */
  private snapshotKey(): string {
    try {
      return JSON.stringify(this.set.snapshot());
    } catch {
      return '';
    }
  }

  /** The app moved away from what this section set up (and the learner's steps since). */
  drift(): boolean {
    if (this.entering || this.#expected === null || this.busy) return false;
    return this.snapshotKey() !== this.#expected;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderCtx(sec: Section | null): RenderContext {
    const slots = this.slots(sec);
    const src = this.slotSource();
    const author = this.deps.authorMode?.() ?? false;
    return {
      slot: (name) => (name in slots ? renderSlot(name, slots, src) : null),
      slotExpect: author
        ? (name) => {
            const s = slots[name];
            if (!s || s.expect === undefined) return null;
            return lessonsCopy.expectBeside(typeof s.expect === 'number' ? formatValue(s.expect, slotFormat(s, src.readouts)) : String(s.expect));
          }
        : undefined,
      earlier: (key, fallback) => earlierText(this.journal, key, fallback),
      image: (p) => this.#images[p] ?? null,
      note: (m) => {
        if (!this.#notes.includes(m)) this.#notes.push(m);
      },
    };
  }

  private nodes(text: string | undefined, sec: Section | null): RNode[] {
    return text ? renderInline(text, this.renderCtx(sec)) : [];
  }

  private assertLines(step: Step, sec: Section): RNode[][] {
    const a = step.fields.assert;
    if (!Array.isArray(a)) return [];
    const slots = this.slots(sec);
    const src = this.slotSource();
    return a.map((item) =>
      this.nodes(
        evaluateAssert(item, slots, src, (e) => this.deps.log?.({ lessonId: this.lesson?.meta.id, stepId: step.id, message: `${e.message}: ${e.slot}` })),
        sec,
      ),
    );
  }

  private checkView(o: CheckOutcome | null, last = false): CheckView | null {
    if (!o) return null;
    const binding = o.binding === 'run' ? `run ${o.bindingName ?? ''}` : o.binding;
    return { agrees: o.agrees, text: last ? lessonsCopy.lastTime(o.text) : o.text, binding, last };
  }

  private renderBlock(sec: Section, step: Step): RenderedBlock | null {
    if (!this.whenHolds(step)) return null;
    const ctx = this.renderCtx(sec);
    const st = this.state(sec, step);
    const f = step.fields;
    const key = this.keyOf(sec, step);
    const body = step.prose.flatMap((p) => renderProse(p.text, ctx));
    const children = step.children.map((c) => this.renderBlock(sec, c)).filter((b): b is RenderedBlock => b !== null);
    const b: RenderedBlock = { key, kind: step.kind, stepId: step.id, body, children };
    const asserts = this.assertLines(step, sec);
    switch (step.kind) {
      case 'explain':
        if (typeof f.image === 'string') {
          const src = this.#images[f.image];
          b.image = src ? { src, alt: String(f.alt ?? '') } : null;
        }
        if (asserts.length) b.asserts = asserts;
        break;
      case 'analogy':
        b.analogy = { like: this.nodes(f.like, sec), because: this.nodes(f.because, sec), breaks: this.nodes(f.breaks, sec) };
        break;
      case 'simplification':
        b.simplification = true;
        break;
      case 'fold':
        b.title = String(f.title ?? '');
        break;
      case 'recall':
      case 'question':
      case 'predict': {
        const choices = Array.isArray(f.choices) ? (f.choices as { text: string; feedback?: string; reveal?: boolean }[]) : null;
        const picked = st.choice !== null && choices ? choices[st.choice] : undefined;
        let feedback: RNode[] | null = null;
        if (st.locked && !st.skipped && picked?.feedback && picked.reveal !== false) feedback = this.nodes(picked.feedback, sec);
        b.ask = {
          question: f.question ? this.nodes(String(f.question), sec) : null,
          choices: choices ? choices.map((c, i) => ({ index: i, text: this.nodes(c.text, sec), picked: st.choice === i })) : null,
          free: f.free === true,
          pick: typeof f.pick === 'string' ? f.pick : null,
          picked: st.pick !== undefined ? earlierWords(st.pick) : null,
          locked: st.locked,
          skipped: st.skipped,
          answer: st.text || null,
          feedback,
          onSkip: st.skipped && f.on_skip ? this.nodes(String(f.on_skip), sec) : null,
          modelAnswer: st.locked && f.model_answer ? this.nodes(String(f.model_answer), sec) : null,
          canSkip: step.kind === 'predict' || step.kind === 'question',
          hidden: step.kind === 'predict' && !st.locked ? list(f.hides).map((a) => this.set.anchors[a]?.label ?? a) : [],
        };
        break;
      }
      case 'do':
        b.act = { state: st.doState, message: st.doMessage };
        break;
      case 'observe': {
        let result = this.checkView(st.result);
        if (!st.revealed && step.id && this.lesson) {
          const last = this.journal.last?.(this.lesson.meta.id, step.id);
          if (last?.check) {
            const o = {
              agrees: last.check.agrees,
              binding: last.check.binding as CheckOutcome['binding'],
              text: '',
              actual: last.check.actual,
              expected: last.check.expected,
              item: { read: last.check.read, op: last.check.op } as CheckItem,
            } as CheckOutcome;
            o.text = this.lastLine(o);
            result = { agrees: o.agrees, text: lessonsCopy.lastTime(o.text), binding: o.binding, last: true };
          }
        }
        b.observe = {
          journal: f.journal === true,
          revealed: st.revealed,
          result,
          note: st.note,
          waiting: this.observeWaiting(sec, step),
          asserts: st.revealed ? asserts : [],
        };
        break;
      }
      case 'compare': {
        const cols = Array.isArray(f.columns) ? (f.columns as Record<string, any>[]) : [];
        b.columns = cols.map((c) => {
          if (typeof c.text === 'string') return { kind: 'text' as const, text: this.nodes(c.text, sec) };
          if (typeof c.view === 'string') return { kind: 'view' as const, view: c.view, args: (this.resolveArgs(c.args) ?? {}) as Record<string, unknown> };
          const def = this.set.readouts[c.read];
          const cap = typeof c.from === 'string' ? this.captures.get(c.from) : undefined;
          const v = typeof c.from === 'string' && cap === undefined ? undefined : readFrom(this.set, c.read, this.resolveArgs(c.args), cap);
          const label = typeof c.from === 'string' ? `${c.from}` : String(c.read);
          return { kind: 'read' as const, label, value: formatReading(v, def) };
        });
        b.sameQuestion = f.same_question ? (f.same_question === 'journal' || f.same_question === 'pick' ? lessonsCopy.sameQuestion : String(f.same_question)) : null;
        if (asserts.length) b.asserts = asserts;
        break;
      }
      case 'explain-result':
        b.explainResult = {
          supports: list(f.supports).map((s) => this.nodes(s, sec)),
          leavesOpen: list(f.leaves_open).map((s) => this.nodes(s, sec)),
          skeptic: isObj(f.skeptic) ? { says: this.nodes(String(f.skeptic.says), sec), check: this.nodes(String(f.skeptic.check), sec) } : null,
          limits: list(f.limits).map((s) => this.nodes(s, sec)),
          asserts,
        };
        break;
      case 'transfer':
        b.transfer = { prompt: String(f.prompt ?? ''), expect: this.nodes(f.expect_if_explanation_holds, sec), limits: list(f.limits).map((s) => this.nodes(s, sec)) };
        break;
      case 'task': {
        const ts = st.task ?? newTaskState();
        const task = f as TaskFields;
        b.task = {
          runs: ts.runs,
          maxRuns: task.max_runs ?? null,
          needsPrediction: task.predict_before_each_run === true,
          prediction: ts.prediction,
          message: ts.message,
          met: ts.met,
          canRun: !(task.max_runs !== undefined && ts.runs >= task.max_runs),
          hasRun: st.taskRan,
          canReset: task.reset !== undefined,
          changeArgs: task.one_change && ts.pendingArgs ? Object.entries(ts.pendingArgs).map(([name, v]) => ({ name, value: String(v ?? '') })) : null,
        };
        break;
      }
      case 'explain-chain':
        b.chain = {
          prompt: f.prompt ? this.nodes(String(f.prompt), sec) : null,
          text: st.chainText,
          written: st.written,
          skipped: st.skipped,
          nudging: st.nudging,
          modelAnswer: st.written || st.skipped ? this.nodes(String(f.model_answer ?? ''), sec) : [],
        };
        if (asserts.length) b.asserts = asserts;
        break;
    }
    return b;
  }

  private lastLine(o: CheckOutcome): string {
    const c = lessonsCopy;
    const shows = formatReading(o.actual, this.set.readouts[o.item.read]);
    switch (o.binding) {
      case 'prediction':
        return o.agrees ? c.agreesPrediction : c.differsPrediction(shows);
      default:
        return o.agrees ? c.agreesLesson : c.differsLesson(shows);
    }
  }

  /** Which `:look` pointers show now: the first unfinished step's, else the section's first. */
  activeLooks(step: RenderedStep): PointerTarget[] {
    const unfinished = (b: RenderedBlock): boolean =>
      (b.ask ? !b.ask.locked : false) || (b.act ? b.act.state !== 'done' : false) || (b.observe ? !b.observe.revealed : false) || (b.task ? !b.task.met : false);
    const flat = (bs: RenderedBlock[]): RenderedBlock[] => bs.flatMap((b) => [b, ...flat(b.children)]);
    const blocks = flat(step.blocks);
    const first = blocks.find(unfinished);
    const pool = first ? blocks.slice(0, blocks.indexOf(first) + 1).reverse() : blocks;
    for (const b of pool) {
      const looks = looksIn(b.body);
      if (looks.length) return looks[0] as PointerTarget[];
    }
    return [];
  }

  /** The current section as presenters draw it. */
  render(): RenderedStep {
    void this.rev;
    const lesson = this.lesson!;
    const sec = lesson.sections[this.index];
    const blocks = sec.steps.map((s) => this.renderBlock(sec, s)).filter((b): b is RenderedBlock => b !== null);
    const all = (bs: RenderedBlock[]): RenderedBlock[] => bs.flatMap((b) => [b, ...all(b.children)]);
    const results = all(blocks).filter((b) => b.explainResult);
    const leavesOpen = results.flatMap((b) => b.explainResult!.leavesOpen);
    const skeptic = results.find((b) => b.explainResult!.skeptic)?.explainResult!.skeptic?.says ?? null;
    const limits = list(lesson.meta.limits).map((s) => this.nodes(s, sec));
    const prereqs = lesson.meta.prerequisites ?? [];
    const cold =
      // `opened`, not `visited`: a lesson marked from 0.3.8 tour progress still shows its cold entry.
      lesson.meta.cold_entry && prereqs.length && this.index === 0 && !prereqs.every((p) => this.deps.progress?.opened(p))
        ? renderProse(lesson.meta.cold_entry, this.renderCtx(sec))
        : null;
    // A recall shows only when its lesson has been visited.
    const relevant = (b: RenderedBlock) => {
      if (b.kind !== 'recall') return true;
      const step = this.findStep(b.key)?.step;
      const from = step?.fields.from;
      return !this.deps.progress || (typeof from === 'string' && this.deps.progress.visited(from));
    };
    return {
      lesson: {
        id: lesson.meta.id,
        title: lesson.meta.title,
        minutes: lesson.meta.minutes,
        spine: lesson.meta.spine ?? [],
        source: this.#sourceKind,
        draft: lesson.meta.draft === true,
      },
      section: sec,
      index: this.index,
      total: lesson.sections.length,
      sections: lesson.sections.map((s, i) => ({ id: s.id, title: s.title, depth: s.depth, visited: this.#visited.has(s.id), current: i === this.index })),
      blocks: blocks.filter(relevant),
      spineMasks: spineMasks(all(blocks).flatMap((b) => b.body)),
      coldEntry: cold,
      honesty: limits.length || leavesOpen.length || skeptic ? { limits, leavesOpen, skeptic } : null,
      busy: this.busy,
      drift: this.drift(),
      banner: this.banner ? { model: this.deps.modelName?.(this.banner.model) ?? this.banner.model } : null,
      error: this.error,
      authorMode: this.deps.authorMode?.() ?? false,
      authorNotes: [...this.#notes],
    };
  }

  /** Every capture the lesson declares, for views over captured runs. */
  captureMap(): Record<string, unknown> {
    const lesson = this.lesson;
    if (!lesson) return {};
    return this.captures.all(captureNames(lesson.sections.flatMap((s) => s.steps)));
  }
}

export function createRunner<VS>(deps: RunnerDeps<VS>): LessonRunner<VS> {
  return new LessonRunner(deps);
}
