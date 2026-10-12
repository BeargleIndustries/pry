// Shared extractor of user-visible strings (plan pry-clarity T4e, crit:R2C-1).
//
// Copy tests check "must not contain" phrases against what a user can read, not
// against raw file text, so identifiers (`probeHardware`, `diagnosticPath`), tour
// and tip anchors (`data-tip="panel-a-heatmap"`), import paths, CSS classes and
// comments never trip a copy row.
//
// What counts as visible:
// - `.svelte` markup: text nodes (with `{expr}` kept as written), the values of
//   user-facing attributes (`title`, `aria-label`, `placeholder`, `alt`, and props
//   such as `label`), and string literals inside `{...}` text expressions and
//   user-facing attribute expressions.
// - `.svelte` `<script>` blocks and `.ts` files: string and template literals that
//   sit under a user-facing field (`blurb`, `why`, `title`, `body`, `hook`,
//   `lookFor`, `found`, `next`, `label`, `text`, ...), plus any other literal that
//   reads like prose (has a space and isn't a class list), e.g. template-literal
//   returns in `readouts.ts`. Literals under anchor/id fields and in imports are skipped.
// - `.json`: string values under user-facing keys, plus prose-like values that
//   aren't under an anchor/id key.

/** Fields whose string values are shown to the user. */
export const USER_FIELDS = new Set([
  'blurb',
  'why',
  'title',
  'body',
  'hook',
  'lookFor',
  'found',
  'next',
  'label',
  'text',
  'heading',
  'message',
  'description',
  'detail',
  'hint',
  'caption',
  'subtitle',
  'tooltip',
  'tabLabel',
  'reset',
  'try',
  'steps',
  'prompt',
  'placeholder',
  'alt',
]);

/** Fields whose values are anchors, ids or code, never shown as copy. */
export const CODE_FIELDS = new Set([
  'id',
  'key',
  'target',
  'anchor',
  'tab',
  'placement',
  'focus',
  'href',
  'src',
  'class',
  'className',
  'icon',
  'kind',
  'type',
  'event',
  'action',
  'model',
  'preset',
  'repo',
  'path',
]);

/** Markup attributes whose values are visible (or read aloud). */
const VISIBLE_ATTRS = new Set([
  'title',
  'aria-label',
  'aria-description',
  'placeholder',
  'alt',
  'label',
  'heading',
  'text',
  'message',
  'description',
  'hint',
  'caption',
  'subtitle',
  'tooltip',
  'blurb',
  'why',
]);

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rarr: '→',
  larr: '←',
  times: '×',
  middot: '·',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(n);
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function decodeEscapes(s: string): string {
  return s.replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gis, (_, e: string) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e === 'n') return '\n';
    if (e === 't') return '\t';
    if (e === '\n' || e === '\r') return '';
    return e;
  });
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A Tailwind/CSS class list such as "flex gap-2 text-sm". */
function isClassList(s: string): boolean {
  const toks = s.trim().split(/\s+/);
  if (!toks.every((t) => /^!?[a-z0-9_:\-/[\].#%()]+$/.test(t))) return false;
  return toks.filter((t) => /[-:]/.test(t)).length * 2 >= toks.length;
}

/** Reads like copy: has a letter and a space, and isn't a class list or a selector. */
function isProse(s: string): boolean {
  const t = s.trim();
  if (!/[A-Za-z]/.test(t) || !/\s/.test(t)) return false;
  if (isClassList(t)) return false;
  if (/^\[data-[\w-]+=/.test(t)) return false;
  return true;
}

interface Literal {
  value: string;
  /** Field name (`key:`) the literal is the value of, if any. */
  field?: string;
  /** True when the literal sits in an import/export-from clause. */
  importPath: boolean;
}

/**
 * Walk TypeScript/JavaScript source and return every string or template literal,
 * with comments and regex literals skipped. Template literals keep `${expr}` as written.
 */
export function scanLiterals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  const n = src.length;
  // Last significant (non-space, non-comment) character, for regex detection.
  let prev = '';
  let prevWord = '';

  const fieldBefore = (start: number): string | undefined => {
    // Look back over `key:` / `key?:` with optional spaces (not a ternary's `'a' :`).
    const head = src.slice(Math.max(0, start - 80), start);
    const m = head.match(/(?:^|[{,\s(])([A-Za-z_$][\w$]*)\??\s*:\s*$/);
    return m?.[1];
  };
  const inImport = (start: number): boolean => {
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const line = src.slice(lineStart, start);
    return /^\s*(import|export)\b/.test(line) || /\bfrom\s*$/.test(line) || /\bimport\s*\(\s*$/.test(line);
  };

  const readQuoted = (q: string): string => {
    let j = i + 1;
    let raw = '';
    while (j < n && src[j] !== q) {
      if (src[j] === '\\') {
        raw += src[j] + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (src[j] === '\n') break;
      raw += src[j++];
    }
    i = j + 1;
    return decodeEscapes(raw);
  };

  const readTemplate = (): string => {
    let j = i + 1;
    let raw = '';
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\') {
        raw += src[j] + (src[j + 1] ?? '');
        j += 2;
        continue;
      }
      if (src[j] === '$' && src[j + 1] === '{') {
        // Keep the interpolation as written; scan nested literals too.
        let depth = 1;
        let k = j + 2;
        while (k < n && depth > 0) {
          const c = src[k];
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '"' || c === "'" || c === '`') {
            const save = i;
            i = k;
            if (c === '`') readTemplate();
            else readQuoted(c);
            k = i;
            i = save;
            continue;
          }
          if (depth > 0) k++;
        }
        const inner = src.slice(j + 2, k);
        for (const lit of scanLiterals(inner)) out.push({ ...lit, field: undefined });
        raw += '${' + inner + '}';
        j = k + 1;
        continue;
      }
      raw += src[j++];
    }
    i = j + 1;
    return decodeEscapes(raw);
  };

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /^(return|typeof|case|in|of)$/.test(prevWord))) {
      // Regex literal: skip to the closing slash, honoring classes and escapes.
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      i = j + 1;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      prev = '/';
      prevWord = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      const value = c === '`' ? readTemplate() : readQuoted(c);
      out.push({ value, field: fieldBefore(start), importPath: inImport(start) });
      prev = c;
      prevWord = '';
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      prevWord = src.slice(i, j);
      prev = 'a';
      i = j;
      continue;
    }
    prev = c;
    prevWord = '';
    i++;
  }
  return out;
}

/** Visible strings in TypeScript/JavaScript source (a `.ts` copy file or a Svelte script). */
export function visibleFromCode(src: string): string[] {
  const out: string[] = [];
  for (const lit of scanLiterals(src)) {
    if (lit.importPath) continue;
    if (lit.field && CODE_FIELDS.has(lit.field)) continue;
    const userField = lit.field !== undefined && USER_FIELDS.has(lit.field);
    if (userField ? lit.value.trim() !== '' : isProse(lit.value)) out.push(squash(lit.value));
  }
  return out;
}

/** Visible strings in a JSON copy file. */
export function visibleFromJson(src: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string | undefined, underUser: boolean) => {
    if (typeof v === 'string') {
      if (key && CODE_FIELDS.has(key)) return;
      if ((underUser && v.trim() !== '') || isProse(v)) out.push(squash(v));
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, key, underUser);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (CODE_FIELDS.has(k)) continue;
        walk(x, k, underUser || USER_FIELDS.has(k));
      }
    }
  };
  walk(JSON.parse(src), undefined, false);
  return out;
}

/** Index just past a `{...}` expression that opens at `start`, string-aware. */
function braceEnd(src: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return src.length;
}

/** Literals inside a markup `{expression}`, minus class lists and single code tokens. */
function exprLiterals(expr: string, keepAll: boolean): string[] {
  const out: string[] = [];
  for (const lit of scanLiterals(expr)) {
    const v = squash(lit.value);
    if (!v || !/[A-Za-z]/.test(v) || isClassList(v)) continue;
    if (lit.field && CODE_FIELDS.has(lit.field)) continue;
    if (keepAll || isProse(v) || /^[A-Z]/.test(v)) out.push(v);
  }
  return out;
}

/** Visible strings in a `.svelte` component. */
export function visibleFromSvelte(src: string): string[] {
  const out: string[] = [];
  let s = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, body: string) => {
    out.push(...visibleFromCode(body));
    return ' ';
  });

  let text = '';
  const flush = () => {
    const t = squash(decodeEntities(text));
    if (/[A-Za-z]/.test(t)) out.push(t);
    text = '';
  };

  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '<' && /[A-Za-z/!]/.test(s[i + 1] ?? '')) {
      flush();
      // Tag: name, then attributes up to the closing '>'.
      let j = i + 1;
      while (j < n && /[^\s>/]/.test(s[j])) j++;
      while (j < n && s[j] !== '>') {
        if (/\s|\//.test(s[j])) {
          j++;
          continue;
        }
        if (s[j] === '{') {
          // Shorthand `{title}` or spread `{...props}`: nothing visible to read.
          j = braceEnd(s, j);
          continue;
        }
        let k = j;
        while (k < n && /[^\s=>/]/.test(s[k])) k++;
        const name = s.slice(j, k);
        j = k;
        if (s[j] !== '=') continue;
        j++;
        const visibleAttr = VISIBLE_ATTRS.has(name);
        if (s[j] === '"' || s[j] === "'") {
          const q = s[j];
          const e = s.indexOf(q, j + 1);
          const raw = s.slice(j + 1, e < 0 ? n : e);
          if (visibleAttr) {
            const v = squash(decodeEntities(raw));
            if (v) out.push(v);
            for (const m of raw.matchAll(/\{/g)) {
              const at = m.index!;
              out.push(...exprLiterals(raw.slice(at + 1, braceEnd(raw, at) - 1), true));
            }
          }
          j = e < 0 ? n : e + 1;
        } else if (s[j] === '{') {
          const e = braceEnd(s, j);
          if (visibleAttr) out.push(...exprLiterals(s.slice(j + 1, e - 1), true));
          j = e;
        } else {
          while (j < n && /[^\s>]/.test(s[j])) j++;
        }
      }
      i = j + 1;
      continue;
    }
    if (c === '{') {
      const e = braceEnd(s, i);
      const inner = s.slice(i + 1, e - 1);
      if (/^\s*[#:/@]/.test(inner)) {
        // Block tags ({#if}, {:else}, {/each}, {@html}) split text runs.
        flush();
        if (/^\s*@html\b/.test(inner)) out.push(...exprLiterals(inner.replace(/^\s*@html/, ''), false));
      } else {
        text += s.slice(i, e);
        out.push(...exprLiterals(inner, false));
      }
      i = e;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

/**
 * The visible strings that contain `phrase`. Interpolations (`{expr}`, `${expr}`)
 * are kept as written, so a phrase with braces can name an old template; any other
 * phrase is matched with interpolation bodies blanked, so `{diagnosticPath}` in a
 * text node never counts as the word "diagnostic".
 */
export function visibleHits(strings: string[], phrase: string | RegExp): string[] {
  const blank = (v: string) => v.replace(/\$?\{[^{}]*\}/g, '{}');
  return strings.filter((v) => {
    if (phrase instanceof RegExp) return phrase.test(blank(v));
    return (phrase.includes('{') ? v : blank(v)).includes(phrase);
  });
}

/** Visible strings in a source file, chosen by its extension. */
export function visibleStrings(src: string, filename: string): string[] {
  if (filename.endsWith('.svelte')) return visibleFromSvelte(src);
  if (filename.endsWith('.json')) return visibleFromJson(src);
  return visibleFromCode(src);
}
