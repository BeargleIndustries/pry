// Lesson renderer (plan T3 "Renderer"): lesson Markdown -> an allow-listed
// node tree the presenters draw with plain Svelte markup. Allowed mdast nodes:
// paragraph, text, emphasis, strong, inlineCode, code, list, listItem,
// heading 3-4, blockquote, thematicBreak, break, table, link, image, plus the
// format's inline directives (`:look`, `:earlier`, `:spine`, `:refutes`) and
// `{slot}`s. Everything else is dropped with an author note; HTML is always
// dropped. Links run through the tool's `open_link` action (dispatcher, so
// grants apply); `lesson:<id>#<section>` links navigate inside Lessons.
// Nothing in ui/src/lib/lessons renders raw HTML: no Svelte html tag anywhere (render.test.ts checks).
//
// Also defines `RenderedStep`, the runner -> presenter payload (contract.ts
// re-exports it): one section with each step's state already resolved.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseInline } from './format/parse';
import type { Section, StepKind } from './format/schema';

// ---------------------------------------------------------------------------
// The node tree
// ---------------------------------------------------------------------------

/** A pointer target as `:look` names it (format: `at=anchor ...args`). */
export type LookTarget = { anchor: string; args?: Record<string, unknown> } | { runner: string; args?: Record<string, unknown> };

export type RNode =
  | { t: 'p' | 'blockquote' | 'li' | 'em' | 'strong' | 'refutes' | 'table' | 'tr' | 'td'; children: RNode[] }
  | { t: 'ul' | 'ol'; children: RNode[] }
  | { t: 'h3' | 'h4'; children: RNode[] }
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'pre'; text: string }
  | { t: 'hr' }
  | { t: 'br' }
  | { t: 'link'; href: string; internal: { lesson: string; section: string | null } | null; children: RNode[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'look'; at: LookTarget[]; children: RNode[] }
  | { t: 'earlier'; key: string; text: string; state: EarlierState }
  | { t: 'spine'; mask: string }
  | { t: 'slot'; name: string; text: string; expect?: string };

export type EarlierState = 'answer' | 'skipped' | 'missing';

/** What the renderer needs from the runner while it renders one section. */
export interface RenderContext {
  /** The rendered live value of a slot, or null when `name` isn't a slot here. */
  slot(name: string): string | null;
  /** Author mode: the slot's expected value, shown beside it. */
  slotExpect?(name: string): string | null;
  /** `:earlier{key}[fallback]`. */
  earlier(key: string, fallback: string): { text: string; state: EarlierState };
  /** Lesson-relative image path -> URL. */
  image?(path: string): string | null;
  /** Records an author note (a dropped node). */
  note?(msg: string): void;
}

const md = unified().use(remarkParse);

const BLOCK_ALLOW = new Set(['paragraph', 'list', 'listItem', 'heading', 'blockquote', 'thematicBreak', 'code', 'table', 'tableRow', 'tableCell']);

/** `"9"` -> 9, `"true"` -> true; everything else stays a string. */
function coerce(v: string | string[] | true): unknown {
  if (v === true) return true;
  if (Array.isArray(v)) return v.map((x) => coerce(x));
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** `:look{at=... k=v}` -> pointer targets in order (`at=[a, b]` is a sequence). */
export function lookTargets(attrs: Record<string, string | string[] | true> | undefined): LookTarget[] {
  if (!attrs) return [];
  const at = attrs.at;
  const names = Array.isArray(at) ? at : typeof at === 'string' ? [at] : [];
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) if (k !== 'at') rest[k] = coerce(v);
  const args = Object.keys(rest).length ? rest : undefined;
  return names.map((n) => (n.startsWith('lesson:') ? { runner: n, ...(args ? { args } : {}) } : { anchor: n, ...(args ? { args } : {}) }));
}

/** `lesson:<id>#<section>` -> where to go; anything else -> null. */
export function lessonLink(href: string): { lesson: string; section: string | null } | null {
  const m = /^lesson:([^#\s]+)(?:#(.+))?$/.exec(href);
  return m ? { lesson: m[1], section: m[2] ?? null } : null;
}

/** Splits one text value on the format's inline syntax. */
function inlineText(value: string, ctx: RenderContext): RNode[] {
  const out: RNode[] = [];
  let at = 0;
  for (const n of parseInline(value)) {
    if (n.type === 'code' || n.type === 'link') continue; // mdast already split these
    if (n.start > at) out.push({ t: 'text', text: value.slice(at, n.start) });
    at = n.end;
    switch (n.type) {
      case 'slot': {
        const text = ctx.slot(n.name!);
        if (text === null) out.push({ t: 'text', text: value.slice(n.start, n.end) });
        else {
          const expect = ctx.slotExpect?.(n.name!) ?? undefined;
          out.push({ t: 'slot', name: n.name!, text, ...(expect ? { expect } : {}) });
        }
        break;
      }
      case 'look':
        out.push({ t: 'look', at: lookTargets(n.attrs), children: inlineText(n.label ?? '', ctx) });
        break;
      case 'earlier': {
        const key = typeof n.attrs?.key === 'string' ? n.attrs.key : '';
        const e = ctx.earlier(key, n.label ?? '');
        out.push({ t: 'earlier', key, text: e.text, state: e.state });
        break;
      }
      case 'spine':
        out.push({ t: 'spine', mask: typeof n.attrs?.mask === 'string' ? n.attrs.mask : '' });
        if (n.label) out.push(...inlineText(n.label, ctx));
        break;
      case 'refutes':
        out.push({ t: 'refutes', children: inlineText(n.label ?? '', ctx) });
        break;
    }
  }
  if (at < value.length) out.push({ t: 'text', text: value.slice(at) });
  return out;
}

function convert(node: any, ctx: RenderContext): RNode[] {
  const kids = () => (node.children ?? []).flatMap((c: any) => convert(c, ctx));
  switch (node.type) {
    case 'root':
      return kids();
    case 'paragraph':
      return [{ t: 'p', children: kids() }];
    case 'text':
      return inlineText(node.value, ctx);
    case 'emphasis':
      return [{ t: 'em', children: kids() }];
    case 'strong':
      return [{ t: 'strong', children: kids() }];
    case 'inlineCode':
      return [{ t: 'code', text: node.value }];
    case 'code':
      return [{ t: 'pre', text: node.value }];
    case 'list':
      return [{ t: node.ordered ? 'ol' : 'ul', children: kids() }];
    case 'listItem': {
      // Tight list items wrap their text in a paragraph; unwrap a lone one.
      const c = kids();
      const inner = c.length === 1 && c[0].t === 'p' ? (c[0] as { children: RNode[] }).children : c;
      return [{ t: 'li', children: inner }];
    }
    case 'heading':
      if (node.depth === 3 || node.depth === 4) return [{ t: node.depth === 3 ? 'h3' : 'h4', children: kids() }];
      ctx.note?.(`Dropped a level ${node.depth} heading inside a step: only ### and #### show.`);
      return [];
    case 'blockquote':
      return [{ t: 'blockquote', children: kids() }];
    case 'thematicBreak':
      return [{ t: 'hr' }];
    case 'break':
      return [{ t: 'br' }];
    case 'table':
      return [{ t: 'table', children: kids() }];
    case 'tableRow':
      return [{ t: 'tr', children: kids() }];
    case 'tableCell':
      return [{ t: 'td', children: kids() }];
    case 'link': {
      const href = String(node.url ?? '');
      return [{ t: 'link', href, internal: lessonLink(href), children: kids() }];
    }
    case 'image': {
      const src = ctx.image?.(String(node.url ?? '')) ?? null;
      if (!src) {
        ctx.note?.(`Dropped an image that isn't in the lesson folder: ${node.url}`);
        return node.alt ? [{ t: 'text', text: String(node.alt) }] : [];
      }
      return [{ t: 'image', src, alt: String(node.alt ?? '') }];
    }
    case 'html':
      ctx.note?.('Dropped raw HTML: lessons show Markdown only.');
      return [];
    default:
      if (BLOCK_ALLOW.has(node.type)) return kids();
      ctx.note?.(`Dropped a ${node.type} block: lessons don't show that kind of Markdown.`);
      return [];
  }
}

/** One prose block (a raw Markdown slice) -> block nodes. */
export function renderProse(text: string, ctx: RenderContext): RNode[] {
  return convert(md.parse(text), ctx);
}

/** A field value (a choice, a feedback line): inline nodes, without the paragraph wrapper. */
export function renderInline(text: string, ctx: RenderContext): RNode[] {
  const nodes = renderProse(text, ctx);
  if (nodes.length === 1 && nodes[0].t === 'p') return nodes[0].children;
  return nodes;
}

/** The plain text of a node list (aria labels, tests). */
export function plainText(nodes: RNode[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
        case 'pre':
        case 'earlier':
        case 'slot':
          return n.text;
        case 'hr':
        case 'spine':
          return '';
        case 'br':
          return '\n';
        case 'image':
          return n.alt;
        default:
          return plainText((n as { children: RNode[] }).children);
      }
    })
    .join('');
}

/** Every `:look` in a node list, in document order. */
export function looksIn(nodes: RNode[]): LookTarget[][] {
  const out: LookTarget[][] = [];
  const walk = (ns: RNode[]) => {
    for (const n of ns) {
      if (n.t === 'look') out.push(n.at);
      if ('children' in n) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Every `:spine{mask}` in a node list. */
export function spineMasks(nodes: RNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: RNode[]) => {
    for (const n of ns) {
      if (n.t === 'spine' && n.mask) out.push(n.mask);
      if ('children' in n) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// ---------------------------------------------------------------------------
// RenderedStep: what the runner hands a presenter
// ---------------------------------------------------------------------------

export interface RenderedChoice {
  index: number;
  text: RNode[];
  picked: boolean;
}

export interface CheckView {
  /** true: agrees, false: differs, null: nothing to compare yet. */
  agrees: boolean | null;
  text: string;
  /** What the reading was compared with: prediction, lesson, run <name>, before, earlier, other. */
  binding: string;
  /** Shown from an earlier visit ("Last time: ..."). */
  last?: boolean;
}

export interface TaskView {
  runs: number;
  maxRuns: number | null;
  needsPrediction: boolean;
  prediction: string;
  message: string | null;
  met: boolean;
  canRun: boolean;
  /** "Run it" has something to send; false when the task is done with the app's own controls. */
  runnable: boolean;
  hasRun: boolean;
  canReset: boolean;
  /** one_change: the action's arguments the learner edits between runs. */
  changeArgs: { name: string; value: string }[] | null;
}

export interface RenderedBlock {
  key: string;
  kind: StepKind;
  stepId?: string;
  /** Author mode shows step ids. */
  body: RNode[];
  children: RenderedBlock[];
  image?: { src: string; alt: string } | null;
  analogy?: { like: RNode[]; because: RNode[]; breaks: RNode[] };
  simplification?: boolean;
  title?: string;
  /** recall / question / predict. */
  ask?: {
    question: RNode[] | null;
    choices: RenderedChoice[] | null;
    free: boolean;
    pick: string | null;
    picked: string | null;
    locked: boolean;
    skipped: boolean;
    answer: string | null;
    feedback: RNode[] | null;
    onSkip: RNode[] | null;
    modelAnswer: RNode[] | null;
    canSkip: boolean;
    /** Labels of the regions this predict hides until the learner answers. */
    hidden: string[];
  };
  act?: { state: 'ready' | 'running' | 'done' | 'failed' | 'blocked'; message: string | null };
  observe?: { journal: boolean; revealed: boolean; result: CheckView | null; note: string | null; waiting: boolean; asserts: RNode[][] };
  columns?: ({ kind: 'read'; label: string; value: string } | { kind: 'view'; view: string; args: Record<string, unknown> } | { kind: 'text'; text: RNode[] })[];
  sameQuestion?: string | null;
  explainResult?: { supports: RNode[][]; leavesOpen: RNode[][]; skeptic: { says: RNode[]; check: RNode[] } | null; limits: RNode[][]; asserts: RNode[][] };
  transfer?: { prompt: string; expect: RNode[]; limits: RNode[][] };
  task?: TaskView;
  chain?: { prompt: RNode[] | null; text: string; written: boolean; skipped: boolean; nudging: boolean; modelAnswer: RNode[] };
  /** `assert` lines on explain / compare steps. */
  asserts?: RNode[][];
  /** A tool view mounted under this step because its text points at it (`:look{at=embedding-view}`). */
  mount?: { view: string; args: Record<string, unknown> };
}

export interface RenderedStep {
  lesson: { id: string; title: string; minutes: number; spine: string[]; source: 'bundled' | 'user'; draft: boolean };
  /** The normalised section (the overlay presenter draws straight from it). */
  section: Section;
  index: number;
  total: number;
  sections: { id: string; title: string; depth: 'core' | 'optional'; visited: boolean; current: boolean }[];
  blocks: RenderedBlock[];
  /** Boxes a `:spine{mask}` hides in this section. */
  spineMasks: string[];
  coldEntry: RNode[] | null;
  honesty: { limits: RNode[][]; leavesOpen: RNode[][]; skeptic: RNode[] | null } | null;
  busy: string | null;
  /** The runner is still setting the section up (its fold); presenters ignore tool highlights meanwhile. */
  entering?: boolean;
  drift: boolean;
  banner: { model: string } | null;
  error: string | null;
  authorMode: boolean;
  authorNotes: string[];
}
