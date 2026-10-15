// Lesson Markdown -> raw structure (plan T1 "Body"). remark finds the blocks
// (front matter, H2 sections, `:::` containers, fences); prose is kept as the
// raw source slice so lint and copy lint see exactly what the author wrote,
// and inline directives are parsed here by `parseInline`.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import { parse as parseYaml } from 'yaml';
import { makeIssue, type LessonIssue } from './errors';
import type { InlineNode } from './schema';

export interface RawProse {
  text: string;
  line: number;
}

export interface RawBlock {
  lang: string;
  value: string;
  /** Line of the block's first content line. */
  line: number;
}

export interface RawStep {
  kind: string;
  attrs: Record<string, string | string[] | true>;
  label?: string;
  line: number;
  endLine: number;
  prose: RawProse[];
  blocks: RawBlock[];
  children: RawStep[];
  implicit?: boolean;
}

export interface RawSection {
  title: string;
  attrs: Record<string, string | string[] | true>;
  line: number;
  enter?: RawBlock;
  slots?: RawBlock;
  steps: RawStep[];
}

export interface RawLesson {
  frontMatter: RawBlock | null;
  sections: RawSection[];
  issues: LessonIssue[];
  source: string;
}

// ---------------------------------------------------------------------------
// Attributes: `key=value key="quoted value" key=[a, b] flag`

export function parseAttrs(src: string): Record<string, string | string[] | true> {
  const out: Record<string, string | string[] | true> = {};
  let i = 0;
  const s = src.trim().replace(/^\{/, '').replace(/\}$/, '');
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    const m = /^[A-Za-z_$][\w.-]*/.exec(s.slice(i));
    if (!m) {
      i++;
      continue;
    }
    const key = m[0];
    i += key.length;
    if (s[i] !== '=') {
      out[key] = true;
      continue;
    }
    i++;
    const c = s[i];
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1);
      const stop = end < 0 ? s.length : end;
      out[key] = s.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === '[') {
      const end = matchClose(s, i, '[', ']');
      out[key] = s
        .slice(i + 1, end)
        .split(',')
        .map((x) => x.trim().replace(/^["']|["']$/g, ''))
        .filter((x) => x.length > 0);
      i = end + 1;
    } else {
      const m2 = /^[^\s}]*/.exec(s.slice(i))!;
      out[key] = m2[0];
      i += m2[0].length;
    }
  }
  return out;
}

/** Index of the bracket closing the one at `start`, honouring quotes and nesting. */
function matchClose(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = '';
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"') quote = c;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return s.length;
}

// ---------------------------------------------------------------------------
// Inline syntax inside prose.

const INLINE_DIRECTIVES = new Set(['look', 'earlier', 'spine', 'refutes']);

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '`') {
      let n = 1;
      while (text[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const end = text.indexOf(fence, i + n);
      if (end > 0) {
        nodes.push({ type: 'code', start: i, end: end + n, label: text.slice(i + n, end) });
        i = end + n;
        continue;
      }
    }
    if (c === ':' && (i === 0 || !/\w/.test(text[i - 1]))) {
      const m = /^:([a-z]+)/.exec(text.slice(i));
      if (m && INLINE_DIRECTIVES.has(m[1])) {
        let j = i + m[0].length;
        let attrs: Record<string, string | string[] | true> | undefined;
        let label: string | undefined;
        for (let k = 0; k < 2; k++) {
          if (text[j] === '{' && !attrs) {
            const end = matchClose(text, j, '{', '}');
            attrs = parseAttrs(text.slice(j, end + 1));
            j = end + 1;
          } else if (text[j] === '[' && label === undefined) {
            const end = matchClose(text, j, '[', ']');
            label = text.slice(j + 1, end);
            j = end + 1;
          }
        }
        if (attrs || label !== undefined) {
          nodes.push({ type: m[1] as InlineNode['type'], start: i, end: j, attrs: attrs as InlineNode['attrs'], label });
          i = j;
          continue;
        }
      }
    }
    if (c === '[' && text[i - 1] !== '!') {
      const m = /^\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/.exec(text.slice(i));
      if (m) {
        nodes.push({ type: 'link', start: i, end: i + m[0].length, label: m[1], url: m[2] });
        i += m[0].length;
        continue;
      }
    }
    if (c === '<') {
      const m = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]+)>/.exec(text.slice(i));
      if (m) {
        nodes.push({ type: 'link', start: i, end: i + m[0].length, label: m[1], url: m[1] });
        i += m[0].length;
        continue;
      }
    }
    if (c === '{') {
      const m = /^\{([a-z_][a-z0-9_]*)\}/.exec(text.slice(i));
      if (m) {
        nodes.push({ type: 'slot', start: i, end: i + m[0].length, name: m[1] });
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Blocks.

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkDirective);

const OPEN_RE = /^\s*(:{3,})([A-Za-z][\w-]*)(\[[^\]]*\])?(\{.*\})?\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

function slice(source: string, node: any): string {
  return source.slice(node.position.start.offset, node.position.end.offset);
}

function isMdx(text: string): boolean {
  return /^(import|export)\s/.test(text) || /^\s*<\/?[A-Z]/.test(text);
}

/** Issues for HTML nested inside a prose node (inline tags). */
function inlineHtml(node: any, issues: LessonIssue[], section: number) {
  for (const c of node.children ?? []) {
    if (c.type === 'html') issues.push(makeIssue(isMdx(c.value) ? 'mdx' : 'raw-html', {}, { line: c.position.start.line, section }));
    else inlineHtml(c, issues, section);
  }
}

/** `:::` lines need a blank line before an opening line and after a closing one. */
function blankLineIssues(lines: string[]): LessonIssue[] {
  const issues: LessonIssue[] = [];
  let fence = '';
  const isColon = (l: string | undefined) => l !== undefined && /^\s*:{3,}/.test(l);
  const blank = (l: string | undefined) => l === undefined || l.trim() === '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = FENCE_RE.exec(l);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = '';
      continue;
    }
    if (fence || !isColon(l)) continue;
    const opening = /^\s*:{3,}[A-Za-z]/.test(l);
    if (opening && !(blank(lines[i - 1]) || isColon(lines[i - 1]) || lines[i - 1] === '---')) {
      issues.push(makeIssue('missing-blank-line', {}, { line: i + 1 }));
    }
    if (!opening && !(blank(lines[i + 1]) || isColon(lines[i + 1]))) {
      issues.push(makeIssue('missing-blank-line', {}, { line: i + 1 }));
    }
  }
  return issues;
}

export function parseLesson(source: string): RawLesson {
  const text = source.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const issues: LessonIssue[] = blankLineIssues(lines);
  const tree: any = processor.parse(text);
  const lesson: RawLesson = { frontMatter: null, sections: [], issues, source: text };
  let section: RawSection | null = null;
  let implicit: RawStep | null = null;

  const flushImplicit = () => {
    implicit = null;
  };

  for (const node of tree.children) {
    const line = node.position.start.line;
    if (node.type === 'yaml') {
      lesson.frontMatter = { lang: 'yaml', value: node.value, line: line + 1 };
      continue;
    }
    if (node.type === 'heading' && node.depth === 2) {
      flushImplicit();
      const raw = lines[line - 1].replace(/^\s*##\s*/, '');
      const am = /\{([^{}]*)\}\s*$/.exec(raw);
      section = {
        title: (am ? raw.slice(0, am.index) : raw).trim(),
        attrs: am ? parseAttrs(am[1]) : {},
        line,
        steps: [],
      };
      lesson.sections.push(section);
      continue;
    }
    if (node.type === 'html') {
      issues.push(makeIssue(isMdx(node.value) ? 'mdx' : 'raw-html', {}, { line, section: lesson.sections.length }));
      continue;
    }
    if (!section) {
      if (node.type !== 'heading' || node.depth !== 1) issues.push(makeIssue('before-section', {}, { line }));
      continue;
    }
    if (node.type === 'containerDirective') {
      flushImplicit();
      if (node.name === 'enter' || node.name === 'slots') {
        const name = node.name as 'enter' | 'slots';
        if (section[name]) issues.push(makeIssue('duplicate-block', { name }, { line, section: lesson.sections.length }));
        section[name] = rawBody(lines, node);
        continue;
      }
      section.steps.push(readStep(node, text, lines, issues, lesson.sections.length));
      continue;
    }
    if (node.type === 'paragraph' && isMdx(slice(text, node))) {
      issues.push(makeIssue('mdx', {}, { line, section: lesson.sections.length }));
      continue;
    }
    if (node.type === 'leafDirective') {
      issues.push(makeIssue('unknown-step', { kind: node.name }, { line, section: lesson.sections.length }));
      continue;
    }
    // Prose straight under a heading becomes an implicit explain step.
    if (!implicit) {
      implicit = { kind: 'explain', attrs: {}, line, endLine: line, prose: [], blocks: [], children: [], implicit: true };
      section.steps.push(implicit);
    }
    const imp: RawStep = implicit;
    if (node.type === 'code') imp.blocks.push({ lang: node.lang ?? '', value: node.value, line: line + 1 });
    else {
      inlineHtml(node, issues, lesson.sections.length);
      imp.prose.push({ text: slice(text, node), line });
    }
    imp.endLine = node.position.end.line;
  }
  return lesson;
}

/** The raw lines between a container's opening and closing `:::`, minus a wrapping fence. */
function rawBody(lines: string[], node: any): RawBlock {
  const start = node.position.start.line;
  let end = node.position.end.line;
  if (/^\s*:{3,}\s*$/.test(lines[end - 1] ?? '')) end -= 1;
  let body = lines.slice(start, end);
  let first = start + 1;
  if (body.length && FENCE_RE.test(body[0])) {
    body = body.slice(1);
    first += 1;
    if (body.length && FENCE_RE.test(body[body.length - 1])) body = body.slice(0, -1);
  }
  return { lang: 'yaml', value: body.join('\n'), line: first };
}

function readStep(node: any, text: string, lines: string[], issues: LessonIssue[], sectionIndex: number): RawStep {
  const line = node.position.start.line;
  const m = OPEN_RE.exec(lines[line - 1] ?? '');
  const attrs = m?.[4] ? parseAttrs(m[4]) : { ...(node.attributes ?? {}) };
  const step: RawStep = {
    kind: node.name,
    attrs,
    line,
    endLine: node.position.end.line,
    prose: [],
    blocks: [],
    children: [],
  };
  for (const child of node.children) {
    const cl = child.position.start.line;
    if (child.type === 'paragraph' && child.data?.directiveLabel) {
      step.label = slice(text, child);
      continue;
    }
    if (child.type === 'containerDirective') {
      step.children.push(readStep(child, text, lines, issues, sectionIndex));
      continue;
    }
    if (child.type === 'code') {
      step.blocks.push({ lang: child.lang ?? '', value: child.value, line: cl + 1 });
      continue;
    }
    if (child.type === 'html') {
      issues.push(makeIssue(isMdx(child.value) ? 'mdx' : 'raw-html', {}, { line: cl, section: sectionIndex }));
      continue;
    }
    const raw = slice(text, child);
    if (child.type === 'paragraph' && isMdx(raw)) {
      issues.push(makeIssue('mdx', {}, { line: cl, section: sectionIndex }));
      continue;
    }
    inlineHtml(child, issues, sectionIndex);
    step.prose.push({ text: raw, line: cl });
  }
  return step;
}

// ---------------------------------------------------------------------------
// The narrow interface loader.ts calls (lane T1-app).

export interface LoadedLesson {
  id: string;
  title: string;
  draft: boolean;
  permissions: Partial<Record<'download' | 'network' | 'external' | 'cost', string[]>>;
  sections: { id: string }[];
  /** Lesson-relative image paths. */
  images: string[];
}

/** `index.yaml`: a list of lesson ids, or `{ lessons: [...] }` of ids or `{ id }` entries. */
export function parseIndex(text: string): string[] {
  const doc = parseYaml(text);
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.lessons) ? doc.lessons : [];
  return list
    .map((e: unknown) => (typeof e === 'string' ? e : (e as { id?: unknown })?.id))
    .filter((e: unknown): e is string => typeof e === 'string');
}
