// Structural lint (plan T1 "Structural lint") and overlay (tour) lint (N9, N10,
// map 7.1). Takes a ToolActionSet, so it lints lessons for any tool, not only Pry.

import type { ActionDef, ToolActionSet } from '../registry/contract';
import { FREE_EFFECTS } from '../registry/contract';
import { makeIssue, nearest, type LessonIssue, type Severity, type Where } from './errors';
import { allSteps, findBindings, safeParseBound, stepTexts } from './normalise';
import type { CheckItem, Lesson, Section, Slot, Step } from './schema';
import { compareVersions } from './version';

export interface LintOptions {
  tool: ToolActionSet<any>;
  /** Bundled with the app (stricter on expect and recorded prompts; exempt from permissions). */
  bundled?: boolean;
  /** Skeletons may write `expect: pending`. */
  skeleton?: boolean;
  /** Release lint: `draft` and `expect: pending` fail. */
  release?: boolean;
  /** Ids of every known lesson (for corrected_in, recall `from`, withdrawn_in). */
  knownLessons?: Iterable<string>;
  /** `remember` keys other lessons declare. */
  rememberKeys?: Iterable<string>;
  /** Row ids in verified-rows.yaml; `$row` references are checked when given. */
  verifiedRows?: Iterable<string>;
  /** Row id -> its rows.json `constants`; when given, every `$row.<id>.<field>` must name one. */
  rowConstants?: Record<string, Record<string, unknown>>;
  /** Prompts with a recorded response; bundled prompts are checked when given. */
  recordedPrompts?: Iterable<string>;
  /** The app version `tool_min` is compared with (default: the tool set's version). */
  appVersion?: string;
  /** Size in bytes of an image relative to the lesson file, or undefined when it's missing. */
  imageSize?(src: string, lessonFile?: string): number | undefined;
  /** Legal `tool:` keys on explain-result (the pinned caveat map). */
  caveatTools?: string[];
}

const NUMBER_OPS = ['equals', 'in', 'changed_from', 'gt', 'lt', 'increased', 'decreased', 'within'];
const OPS_BY_TYPE: Record<string, string[]> = {
  number: NUMBER_OPS,
  string: ['equals', 'in', 'changed_from', 'contains', 'starts_with'],
  boolean: ['equals', 'changed_from'],
  list: ['equals', 'changed_from', 'contains'],
  record: ['equals', 'changed_from', 'contains', 'in'],
  prose: [],
};

const INTERACTIVE = new Set(['predict', 'question', 'do', 'observe', 'compare', 'task', 'transfer', 'recall', 'explain-chain']);
const MB = 1024 * 1024;

interface Ordered {
  step: Step;
  section: Section;
  order: number;
  inFold: boolean;
  /** The list this step sits in (its siblings). */
  siblings: Step[];
}

function order(lesson: Lesson): Ordered[] {
  const out: Ordered[] = [];
  const walk = (steps: Step[], section: Section, inFold: boolean) => {
    for (const step of steps) {
      out.push({ step, section, order: out.length, inFold, siblings: steps });
      walk(step.children, section, inFold || step.kind === 'fold');
    }
  };
  for (const s of lesson.sections) walk(s.steps, s, false);
  return out;
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every string under a `prompt` key, at any depth. */
function deepPrompts(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => deepPrompts(x, out));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'prompt' && typeof x === 'string') out.push(x);
      else deepPrompts(x, out);
    }
  }
  return out;
}

function zodDetail(err: any): string {
  return (err?.issues ?? [])
    .map((i: any) => {
      if (i.code === 'unrecognized_keys') return `unknown ${i.keys.map((k: string) => `\`${k}\``).join(', ')}`;
      return `${i.path?.length ? `\`${i.path.join('.')}\` ` : ''}${i.message}`;
    })
    .join('; ');
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Exact host or a subdomain of it, after lower-casing and IDNA normalisation. */
export function hostMatches(host: string, allowed: string): boolean {
  const a = hostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(allowed) ? allowed : `http://${allowed}`);
  const h = hostOf(`http://${host}`);
  if (!a || !h) return false;
  return h === a || h.endsWith(`.${a}`);
}

export function lintLesson(lesson: Lesson, opts: LintOptions): LessonIssue[] {
  const tool = opts.tool;
  const meta = lesson.meta;
  const issues: LessonIssue[] = [];
  const known = new Set(opts.knownLessons ?? []);
  known.add(meta.id);
  const rows = opts.verifiedRows ? new Set([...opts.verifiedRows].map(String)) : null;
  const steps = order(lesson);
  const perms = meta.permissions ?? {};
  const usedScopes = new Set<string>();

  const at = (o?: Ordered, line?: number) => ({
    line: line ?? o?.step.line,
    section: o?.section.index ?? 0,
    step: o?.step.id,
  });
  const err = (code: string, data: Record<string, unknown>, where: Where, severity: Severity = 'error') =>
    issues.push(makeIssue(code, data, where, severity));
  /** `$row.<id>.<field>` / `{row: <id>.<field>}`: the row exists and has that constant (a warning for skeletons). */
  const checkRow = (id: string, field: string | undefined, where: Where) => {
    if (rows && !rows.has(id)) return err('row-unknown', { id }, where);
    const c = opts.rowConstants;
    if (c && (!field || !Object.hasOwn(c[id] ?? {}, field))) err('row-field-missing', { id, field: field ?? '' }, where, opts.skeleton ? 'warning' : 'error');
  };
  /** Error for bundled lessons, warning for user lessons. */
  const bundledErr = (code: string, data: Record<string, unknown>, where: Where) =>
    err(code, data, where, opts.bundled ? 'error' : 'warning');

  // --- remember keys, step ids, captures, slots -----------------------------------
  const remember = new Set<string>();
  const declare = (k: string) => {
    remember.add(k);
    remember.add(`${meta.id}.${k}`);
  };
  for (const k of opts.rememberKeys ?? []) remember.add(k);
  const stepIds = new Map<string, Ordered>();
  const captures = new Map<string, Ordered>();
  for (const o of steps) {
    const f = o.step.fields;
    if (typeof f.remember === 'string') declare(f.remember);
    if (isObj(f.remember) && typeof f.remember.key === 'string') declare(f.remember.key);
    if (o.step.id) {
      if (stepIds.has(o.step.id)) err('duplicate-id', { id: o.step.id }, at(o));
      else stepIds.set(o.step.id, o);
    }
    if ((o.step.kind === 'do' || o.step.kind === 'task') && typeof f.capture === 'string') captures.set(f.capture, o);
  }
  const sectionIds = new Set(lesson.sections.map((s) => s.id));
  const slotsFor = (section: Section): Record<string, Slot> => ({ ...(meta.slots ?? {}), ...(section.slots ?? {}) });

  // --- front matter --------------------------------------------------------------
  const fm = { line: 1, section: 0 };
  if (!opts.bundled && meta.id.startsWith(tool.idPrefix)) err('id-prefix', { prefix: tool.idPrefix }, fm);
  if (meta.tool_min !== undefined) {
    const have = opts.appVersion ?? tool.version;
    if (compareVersions(String(meta.tool_min), have) > 0) err('tool-min', { tool: tool.tool, need: meta.tool_min, have }, fm);
  }
  if (meta.model !== undefined && !tool.models.includes(meta.model)) err('model-unknown', { model: meta.model, models: tool.models }, fm);
  if (meta.draft) err('draft', {}, fm, opts.release ? 'error' : 'warning');
  for (const box of meta.spine ?? []) if (!tool.spine.some((s) => s.id === box)) err('spine-unknown', { name: box }, fm);
  for (const t of meta.targets ?? []) {
    // A predict or question choice (P1.4:74), or a `:refutes{target=...}` span: outlines answer some
    // misconceptions with a refutation, not a choice (map 8; P2.4:86, P4.1:97). Either may list several.
    const has = (v: unknown) => (Array.isArray(v) ? v.includes(t) : v === t);
    const tagged = steps.some(
      (o) =>
        ((o.step.kind === 'predict' || o.step.kind === 'question') && Array.isArray(o.step.fields.choices) && o.step.fields.choices.some((c: any) => has(c?.target))) ||
        o.step.prose.some((p) => p.inline.some((n) => n.type === 'refutes' && has(n.attrs?.target))),
    );
    if (!tagged) err('targets-untagged', { target: t }, fm);
  }

  // --- names -----------------------------------------------------------------------
  const checkReadout = (name: string, args: unknown, where: Where) => {
    const def = tool.readouts[name];
    if (!def) {
      err('unknown-readout', { name, hint: nearest(name, Object.keys(tool.readouts)) }, where);
      return undefined;
    }
    if (def.args) {
      const r = safeParseBound(def.args, args ?? {});
      if (!r.success) err('bad-readout-args', { name, detail: zodDetail(r.error) }, where);
      checkBindings(r.bindings, where);
    } else if (args !== undefined && isObj(args) && Object.keys(args).length) {
      err('bad-readout-args', { name, detail: 'it takes no arguments' }, where);
    }
    return def;
  };

  const checkBindings = (b: ReturnType<typeof findBindings>, where: Where) => {
    for (const e of b.earlier) {
      if (!e.hasFallback) err('earlier-no-fallback', { key: e.key }, where);
      if (!remember.has(e.key)) err('earlier-undeclared', { key: e.key }, where);
    }
    for (const r of b.rows) checkRow(r.id, r.field, where);
  };

  const checkAnchor = (name: string, args: Record<string, unknown>, where: Where) => {
    if (name === 'lesson:spine') {
      // `box=` points at one spine box, like the training bracket (P1.1:62).
      if (typeof args.box === 'string' && !tool.spine.some((s) => s.id === args.box)) err('spine-unknown', { name: args.box }, where);
      return;
    }
    const step = /^lesson:step:(.+)$/.exec(name);
    if (step) {
      if (!stepIds.has(step[1])) err('step-unknown', { name: step[1] }, where);
      return;
    }
    if (/^lesson:image:/.test(name)) return;
    const def = tool.anchors[name];
    if (!def) {
      err('unknown-anchor', { name, hint: nearest(name, Object.keys(tool.anchors)) }, where);
      return;
    }
    if (def.args) {
      const r = safeParseBound(def.args, args);
      if (!r.success) err('bad-anchor-args', { name, detail: zodDetail(r.error) }, where);
      checkBindings(r.bindings, where);
    } else if (Object.keys(args).length) {
      err('bad-anchor-args', { name, detail: 'it takes no arguments' }, where);
    }
  };

  /** Validates a value binding in a check (`$capture`, `$earlier`, `$slot`, `$read`, `$row`). */
  const checkValueBinding = (value: unknown, valueArgs: unknown, o: Ordered, slots: Record<string, Slot>) => {
    if (typeof value !== 'string' || !value.startsWith('$')) return;
    const where = at(o);
    let m: RegExpExecArray | null;
    if ((m = /^\$capture\.([^.]+)\.(.+)$/.exec(value))) {
      const c = captures.get(m[1]);
      if (!c || c.order >= o.order) err('capture-unknown', { name: m[1] }, where);
      // `value_args` give a captured, before or baseline readout its arguments (P3.2:61, ' Mary' under the control).
      checkReadout(m[2], valueArgs, where);
    } else if ((m = /^\$earlier\.(.+)$/.exec(value))) {
      if (!remember.has(m[1])) err('earlier-undeclared', { key: m[1] }, where);
    } else if ((m = /^\$slot\.(.+)$/.exec(value))) {
      if (!slots[m[1]]) err('slot-unknown', { name: m[1] }, where);
    } else if ((m = /^\$read\.(.+)$/.exec(value))) {
      checkReadout(m[1], valueArgs, where);
    } else if ((m = /^\$(before|baseline)\.(.+)$/.exec(value))) {
      checkReadout(m[2], valueArgs, where);
    } else if ((m = /^\$row\.([^.]+)\.(.+)$/.exec(value))) {
      checkRow(m[1], m[2], where);
    }
  };

  const checkExpect = (expect: unknown, what: string, where: Where, learnerOk: boolean, readName: string) => {
    if (expect === undefined) {
      bundledErr('expect-missing', { what }, where);
      return;
    }
    if (expect === 'pending' && (!opts.skeleton || opts.release)) err('expect-pending', {}, where);
    if (expect === 'learner' && !learnerOk) err('expect-learner', { name: readName }, where);
  };

  /** Readouts a task in this section reads: the learner produces their values. */
  const taskReads = (section: Section): Set<string> => {
    const out = new Set<string>();
    for (const st of allSteps(section.steps)) {
      if (st.kind !== 'task') continue;
      for (const c of [...(st.fields.target ?? []), ...(st.fields.constraint ?? [])]) if (isObj(c)) out.add(c.read);
      if (isObj(st.fields.remember)) out.add(st.fields.remember.read);
    }
    return out;
  };

  const checkItem = (c: CheckItem, o: Ordered, inTask: boolean) => {
    const where = at(o);
    const def = checkReadout(c.read, c.args, where);
    if (def) {
      if (def.type === 'prose') err('prose-check', { read: c.read }, where);
      else if (c.field !== undefined && def.type !== 'record') err('bad-readout-args', { name: c.read, detail: '`field` only applies to a record readout' }, where);
      else if (c.field !== undefined && !def.fields?.[c.field]) err('bad-readout-args', { name: c.read, detail: `it has no field \`${c.field}\`` }, where);
      else {
        // A field's own type picks the operators (`rank` is a number).
        const type = c.field !== undefined ? def.fields![c.field] : def.type;
        if (!OPS_BY_TYPE[type]?.includes(c.op)) err('op-type', { op: c.op, read: c.field ? `${c.read}.${c.field}` : c.read, type, ops: OPS_BY_TYPE[type] }, where);
      }
    }
    if (c.value_field !== undefined && typeof c.value === 'string' && /^\$(read|capture|before|baseline)\./.test(c.value)) {
      const name = c.value.replace(/^\$capture\.[^.]+\./, '').replace(/^\$(read|before|baseline)\./, '');
      if (!tool.readouts[name]?.fields?.[c.value_field]) err('bad-readout-args', { name, detail: `it has no field \`${c.value_field}\`` }, where);
    }
    const slots = slotsFor(o.section);
    if (typeof c.from === 'string') {
      const cap = captures.get(c.from);
      if (!cap || cap.order >= o.order) err('capture-unknown', { name: c.from }, where);
    }
    checkValueBinding(c.value, c.value_args, o, slots);
    checkValueBinding(c.tolerance, undefined, o, slots);
    const constant = typeof c.value === 'number';
    if (constant || c.expect !== undefined) checkExpect(c.expect, `The check on \`${c.read}\``, where, inTask, c.read);
  };

  // --- actions -----------------------------------------------------------------------
  const isFree = (def: ActionDef) => FREE_EFFECTS.includes(def.effect);
  const ranCompute = new Set<number>(); // section indexes with a compute action in a do step
  const gatedCaptures = new Set<string>();
  const seenDo = new Map<string, Ordered>();
  const setInput = tool.actions.set_input;
  const prompts: { text: string; where: Where }[] = [];
  let anyCompute = false;

  for (const o of steps) {
    if (o.step.kind !== 'do') continue;
    let gated = false;
    for (const a of o.step.actions) {
      const where = at(o, a.line);
      const def = tool.actions[a.name];
      if (!def) {
        err('unknown-action', { name: a.name, hint: nearest(a.name, Object.keys(tool.actions)) }, where);
        continue;
      }
      const r = safeParseBound(def.args, a.args);
      if (!r.success) err('bad-args', { name: a.name, detail: zodDetail(r.error) }, where);
      checkBindings(r.bindings, where);
      if (def.effect === 'compute') {
        ranCompute.add(o.section.index);
        anyCompute = true;
      }
      if (typeof a.args.temperature === 'number' && a.args.temperature > 0 && a.args.seed === undefined) {
        err('seed-missing', { name: a.name }, where);
      }
      if (setInput && def === setInput) for (const v of Object.values(a.args)) if (typeof v === 'string') prompts.push({ text: v, where });
      if (!isFree(def)) {
        gated = true;
        const args = r.bindings.value as Record<string, unknown>;
        let scope: string = a.name;
        try {
          scope = def.scope ? def.scope(args) : a.name;
        } catch {
          /* bad args already reported */
        }
        const list = (perms as Record<string, string[] | undefined>)[def.effect] ?? [];
        const ok = def.effect === 'external' ? list.some((h) => hostMatches(scope, h)) : list.includes(scope);
        if (ok) usedScopes.add(`${def.effect}:${def.effect === 'external' ? list.find((h) => hostMatches(scope, h)) : scope}`);
        if (!ok && !opts.bundled) err('permission-missing', { name: a.name, effect: def.effect, scope }, where);
      }
    }
    if (gated && typeof o.step.fields.capture === 'string') gatedCaptures.add(o.step.fields.capture);
    if (o.step.actions.length) {
      const key = JSON.stringify(o.step.actions.map((a) => [a.name, a.args]));
      if (seenDo.has(key) && o.step.fields.fresh !== true) err('fresh-missing', {}, at(o));
      if (!seenDo.has(key)) seenDo.set(key, o);
    }
  }

  // --- enter overlays ------------------------------------------------------------------
  for (const s of lesson.sections) {
    if (!s.enter) continue;
    const where = { line: s.enter.line, section: s.index };
    const b = findBindings(s.enter.value);
    checkBindings(b, where);
    for (const p of deepPrompts(s.enter.value)) prompts.push({ text: p, where });
  }
  for (const p of deepPrompts(meta.baseline)) prompts.push({ text: p, where: fm });

  // --- steps -----------------------------------------------------------------------------
  const isOverlay = meta.presentation === 'overlay';
  for (const o of steps) {
    const { step, section } = o;
    const f = step.fields;
    const where = at(o);
    const slots = slotsFor(section);

    if (f.when && isObj(f.when)) {
      checkItem(f.when as CheckItem, o, false);
      const w = f.when;
      const same = (x: any) => isObj(x) && x.read === w.read && x.op === w.op && JSON.stringify(x.args ?? {}) === JSON.stringify(w.args ?? {}) && JSON.stringify(x.value) === JSON.stringify(w.value);
      const negated = o.siblings.some((s) => s !== step && same(s.fields.when) && !!s.fields.when.not !== !!w.not);
      if (!negated) err('when-no-sibling', {}, where);
    }

    switch (step.kind) {
      case 'explain':
        if (typeof f.image === 'string') {
          if (!f.alt || !String(f.alt).trim()) err('image-alt', {}, where);
          if (/^[a-z][a-z0-9+.-]*:/i.test(f.image) || f.image.startsWith('/') || f.image.split(/[\\/]/).includes('..')) {
            err('image-not-local', { src: f.image }, where);
          } else if (opts.imageSize) {
            const size = opts.imageSize(f.image, lesson.file);
            if (size === undefined) err('image-missing', { src: f.image }, where);
            else if (size > MB) err('image-too-big', { src: f.image }, where);
          }
        }
        break;
      case 'analogy':
        if (typeof f.breaks !== 'string' || !f.breaks.trim()) err('analogy-breaks', {}, where);
        if (typeof f.withdrawn_in === 'string' && !known.has(f.withdrawn_in)) err('simplification-unknown', { id: f.withdrawn_in }, where);
        break;
      case 'simplification':
        for (const id of f.corrected_in ?? []) if (!known.has(id)) err('simplification-unknown', { id }, where);
        break;
      case 'recall':
        if (typeof f.from === 'string' && !known.has(f.from)) err('recall-unknown', { id: f.from }, where);
        break;
      case 'question':
        if (typeof f.pick === 'string' && !tool.pickers[f.pick]) err('unknown-picker', { name: f.pick, hint: nearest(f.pick, Object.keys(tool.pickers)) }, where);
        break;
      case 'predict': {
        const target = typeof f.checks === 'string' ? stepIds.get(f.checks) : undefined;
        if (!target || target.step.kind !== 'observe') err('predict-no-observe', {}, where);
        if (typeof f.pick === 'string' && !tool.pickers[f.pick]) err('unknown-picker', { name: f.pick, hint: nearest(f.pick, Object.keys(tool.pickers)) }, where);
        for (const h of f.hides ?? []) checkAnchor(h, {}, where);
        if (isObj(f.skip_check)) {
          for (const w of f.skip_check.when ?? []) if (!stepIds.has(w.step)) err('skip-check-unknown', { what: 'step', name: w.step }, where);
          for (const s of f.skip_check.skip ?? []) if (!sectionIds.has(s)) err('skip-check-unknown', { what: 'section', name: s }, where);
          if (f.skip_check.reason_step && !stepIds.has(f.skip_check.reason_step)) err('skip-check-unknown', { what: 'step', name: f.skip_check.reason_step }, where);
        }
        break;
      }
      case 'observe': {
        const list = Array.isArray(f.check) ? f.check : f.check ? [f.check] : [];
        for (const c of list) if (isObj(c)) checkItem(c as CheckItem, o, false);
        break;
      }
      case 'compare':
        for (const c of f.columns ?? []) {
          if (!isObj(c)) continue;
          if (typeof c.read === 'string') {
            checkReadout(c.read, c.args, where);
            if (typeof c.from === 'string') {
              const cap = captures.get(c.from);
              if (!cap || cap.order >= o.order) err('capture-unknown', { name: c.from }, where);
            }
          } else if (typeof c.view === 'string') {
            const def = tool.views[c.view];
            if (!def) err('unknown-view', { name: c.view, hint: nearest(c.view, Object.keys(tool.views)) }, where);
            else {
              const r = safeParseBound(def.args, c.args ?? {});
              if (!r.success) err('bad-view-args', { name: c.view, detail: zodDetail(r.error) }, where);
            }
          }
        }
        break;
      case 'explain-result': {
        const missing = ['supports', 'leaves_open'].filter((k) => f[k] === undefined || (Array.isArray(f[k]) ? f[k].length === 0 : !String(f[k]).trim()));
        if (missing.length) err('explain-result-fields', { missing }, where);
        if ((meta.stage === 2 || meta.stage === 3) && !f.skeptic) err('skeptic-missing', {}, where);
        const ran = ranCompute.has(section.index) || ranCompute.has(section.index - 1);
        if (ran && !f.tool) err('tool-missing', {}, where);
        if (f.tool && opts.caveatTools && !opts.caveatTools.includes(f.tool)) err('tool-unknown', { tool: f.tool, tools: opts.caveatTools }, where);
        break;
      }
      case 'transfer':
        if (!step.children.some((c) => c.kind === 'predict')) err('transfer-no-predict', {}, where);
        if (typeof f.prompt === 'string') prompts.push({ text: f.prompt, where });
        break;
      case 'task':
        for (const c of [...(f.target ?? []), ...(f.constraint ?? [])]) if (isObj(c)) checkItem(c as CheckItem, o, true);
        for (const name of f.learner_actions ?? []) {
          if (!tool.actions[name]) err('unknown-action', { name, hint: nearest(name, Object.keys(tool.actions)) }, where);
        }
        if (typeof f.one_change === 'string' && !tool.actions[f.one_change]) {
          err('unknown-action', { name: f.one_change, hint: nearest(f.one_change, Object.keys(tool.actions)) }, where);
        }
        if (isObj(f.remember)) checkReadout(f.remember.read, f.remember.args, where);
        if (f.reset !== undefined) checkBindings(findBindings(f.reset), where);
        break;
    }

    // Inline syntax and slots in every learner-visible text of this step.
    for (const p of step.prose) {
      for (const n of p.inline) {
        const w = at(o, p.line);
        if (n.type === 'look') {
          const { at: target, ...raw } = n.attrs ?? {};
          // Attribute values are text; a number-looking one is a number (`head-cell layer=9`, P3.2:51).
          const rest = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : v]));
          const targets = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
          for (const t of targets) checkAnchor(t, rest, w);
        } else if (n.type === 'earlier') {
          const key = typeof n.attrs?.key === 'string' ? n.attrs.key : '';
          if (!remember.has(key)) err('earlier-undeclared', { key }, w);
        } else if (n.type === 'spine') {
          const mask = typeof n.attrs?.mask === 'string' ? n.attrs.mask : '';
          for (const box of mask.split('..')) if (!tool.spine.some((s) => s.id === box)) err('spine-unknown', { name: box }, w);
        } else if (n.type === 'link' && n.url) {
          const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(n.url)?.[1]?.toLowerCase();
          if (scheme === 'lesson') continue;
          if (scheme !== 'http' && scheme !== 'https') {
            err('link-scheme', { scheme: scheme ? `${scheme}:` : n.url }, w);
            continue;
          }
          const host = hostOf(n.url);
          if (!host) continue;
          const allowed = perms.external ?? [];
          const match = allowed.find((h) => hostMatches(host, h));
          if (match) usedScopes.add(`external:${match}`);
          if (!opts.bundled && !match) err('link-host', { host }, w);
        }
      }
    }
    for (const a of Array.isArray(f.assert) ? f.assert : []) {
      for (const s of [a?.require?.slot, a?.require?.slot2]) if (typeof s === 'string' && !slots[s]) err('slot-unknown', { name: s }, where);
      // On an explain-chain, `say` is the clause in the model answer that `else` replaces (P3.2:87).
      if (step.kind === 'explain-chain' && typeof a?.say === 'string' && !String(f.model_answer ?? '').includes(a.say)) err('assert-say-missing', { say: a.say }, where);
    }
    for (const t of stepTexts(step)) {
      for (const m of t.text.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)) {
        if (!slots[m[1]]) err('slot-unknown', { name: m[1] }, at(o, t.line));
      }
      for (const m of t.text.matchAll(/:earlier\{[^}]*key="?([^"}\s]+)/g)) {
        if (t.role !== 'prose' && !remember.has(m[1])) err('earlier-undeclared', { key: m[1] }, at(o, t.line));
      }
    }

    // Overlay (tour): explain steps only.
    if (isOverlay && step.kind !== 'explain') err('overlay-step', { kind: step.kind }, where);
  }

  // --- analogies: one per section on the main path ------------------------------------
  for (const s of lesson.sections) {
    const main = s.steps.filter((st) => st.kind === 'analogy');
    if (main.length > 1) err('analogy-two', {}, { line: main[1].line, section: s.index, step: main[1].id });
  }

  // --- slots: expect, learner values, readouts before they exist ------------------------
  const allSlots: { name: string; slot: Slot; section?: Section; line: number }[] = [
    ...Object.entries(meta.slots ?? {}).map(([name, slot]) => ({ name, slot, line: 1 })),
    ...lesson.sections.flatMap((s) => Object.entries(s.slots ?? {}).map(([name, slot]) => ({ name, slot, section: s, line: s.slotsLine ?? s.line }))),
  ];
  const checkLists = steps.flatMap((o) => [o.step.fields.check, o.step.fields.target, o.step.fields.constraint].flat());
  const anyExpect = allSlots.some((x) => x.slot.expect !== undefined) || checkLists.some((c) => isObj(c) && c.expect !== undefined);
  for (const { name, slot, section, line } of allSlots) {
    const where = { line, section: section?.index ?? 0 };
    if (slot.row !== undefined) {
      const [id, ...field] = slot.row.split('.');
      checkRow(id, field.join('.') || undefined, where);
      continue;
    }
    if (slot.formula) {
      for (const f of slot.from ?? []) if (!allSlots.some((x) => x.name === f)) err('slot-unknown', { name: f }, where);
      continue;
    }
    if (!slot.read) continue;
    const def = checkReadout(slot.read, slot.args, where);
    if (def?.type === 'prose') err('prose-check', { read: slot.read }, where);
    if (slot.from_capture && !captures.has(slot.from_capture)) err('capture-unknown', { name: slot.from_capture }, where);
    let learnerOk = false;
    if (slot.from_capture) {
      const cap = captures.get(slot.from_capture);
      learnerOk = !!cap && (cap.step.kind === 'task' || cap.step.actions.some((a) => findBindings(a.args).earlier.length > 0));
    } else {
      const secs = section ? [section] : lesson.sections;
      learnerOk = secs.some((s) => taskReads(s).has(slot.read!));
    }
    checkExpect(slot.expect, `The slot \`{${name}}\``, where, learnerOk, slot.read);
  }
  if (anyExpect && !meta.model) err('expect-no-model', {}, fm);

  // Slot uses before the step that produces the value.
  const firstCompute = steps.find((o) => o.step.kind === 'do' && o.step.actions.some((a) => tool.actions[a.name]?.effect === 'compute'));
  const firstEnter = lesson.sections.find((s) => s.enter);
  for (const o of steps) {
    const slots = slotsFor(o.section);
    for (const t of stepTexts(o.step)) {
      for (const m of t.text.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)) {
        const slot = slots[m[1]];
        if (!slot || slot.row !== undefined || slot.formula) continue;
        let before = false;
        // A predict choice's feedback shows when its observe answers it, after the run (P1.1:87).
        const checks = o.step.kind === 'predict' && t.role === 'feedback' ? stepIds.get(o.step.fields.checks) : undefined;
        const shownAt = checks ? checks.order : o.order;
        if (slot.from_capture) {
          const cap = captures.get(slot.from_capture);
          before = !!cap && shownAt < cap.order;
        } else if (slot.read) {
          const ran = (firstCompute && firstCompute.order < o.order) || meta.baseline !== undefined || (firstEnter && firstEnter.index <= o.section.index);
          before = !ran;
        }
        if (before) err('slot-before-readout', { name: m[1] }, at(o, t.line));
      }
    }
  }

  // --- later sections reading what only a gated step produced ----------------------------
  for (const o of steps) {
    const reads: string[] = [];
    const f = o.step.fields;
    const collect = (v: unknown) => {
      const s = JSON.stringify(v ?? null);
      for (const m of s.matchAll(/\$capture\.([^."]+)/g)) reads.push(m[1]);
    };
    collect(f.check);
    collect(f.target);
    collect(f.constraint);
    for (const c of [...(f.columns ?? []), ...[f.check, f.target, f.constraint].flat()]) if (isObj(c) && typeof c.from === 'string') reads.push(c.from);
    for (const name of reads) {
      const cap = captures.get(name);
      if (!cap || !gatedCaptures.has(name) || cap.section.index === o.section.index) continue;
      if (!o.section.steps.some((s) => s.kind === 'do')) err('gated-readout', { name }, at(o));
    }
  }

  // --- recorded prompts (bundled) ----------------------------------------------------------
  if (opts.recordedPrompts) {
    const rec = new Set(opts.recordedPrompts);
    for (const p of prompts) if (!rec.has(p.text)) bundledErr('unrecorded-prompt', { prompt: p.text }, p.where);
  }

  // --- warnings ---------------------------------------------------------------------------
  for (const [effect, list] of Object.entries(perms)) {
    for (const scope of list ?? []) if (!usedScopes.has(`${effect}:${scope}`)) err('permission-unused', { effect, scope }, fm, 'warning');
  }
  for (const s of lesson.sections) {
    const all = allSteps(s.steps);
    if (all.some((st) => INTERACTIVE.has(st.kind))) continue;
    const words = all.flatMap((st) => st.prose.map((p) => p.text)).join(' ').split(/\s+/).filter(Boolean).length;
    if (words > 150) err('long-section', { words }, { line: s.line, section: s.index }, 'warning');
  }
  if (anyCompute && deepPrompts(meta.baseline).length === 0) err('no-baseline-prompt', {}, fm, 'warning');

  // --- overlay (tour) lint ---------------------------------------------------------------
  if (isOverlay) {
    if (lesson.sections.length > 12) err('overlay-sections', { n: lesson.sections.length }, fm);
    for (const s of lesson.sections) {
      if (!s.enter) continue;
      for (const key of Object.keys(s.enter.value)) {
        if (key !== 'open_panel') err('overlay-enter', { key }, { line: s.enter.line, section: s.index });
      }
    }
  }

  return issues;
}

/** Lints a set of lessons together: cross-lesson keys, known ids and prerequisite cycles. */
export function lintLessonSet(lessons: Lesson[], opts: LintOptions): Map<string, LessonIssue[]> {
  const known = new Set([...(opts.knownLessons ?? []), ...lessons.map((l) => l.meta.id)]);
  const remember = new Set(opts.rememberKeys ?? []);
  for (const l of lessons) {
    for (const s of l.sections) {
      for (const st of allSteps(s.steps)) {
        const k = typeof st.fields.remember === 'string' ? st.fields.remember : isObj(st.fields.remember) ? st.fields.remember.key : undefined;
        if (typeof k === 'string') {
          remember.add(k);
          remember.add(`${l.meta.id}.${k}`);
        }
      }
    }
  }
  const out = new Map<string, LessonIssue[]>();
  for (const l of lessons) {
    const issues = lintLesson(l, { ...opts, knownLessons: known, rememberKeys: remember });
    out.set(l.meta.id, l.file ? issues.map((i) => ({ ...i, file: l.file })) : issues);
  }
  // Prerequisite cycles.
  const prereq = new Map(lessons.map((l) => [l.meta.id, l.meta.prerequisites ?? []]));
  const reported = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (path.includes(id)) {
      const chain = [...path.slice(path.indexOf(id)), id];
      const key = [...chain].sort().join(',');
      if (!reported.has(key)) {
        reported.add(key);
        out.get(id)?.push(makeIssue('prereq-cycle', { chain }, { line: 1, section: 0 }));
      }
      return;
    }
    for (const next of prereq.get(id) ?? []) visit(next, [...path, id]);
  };
  for (const id of prereq.keys()) visit(id, []);
  return out;
}
