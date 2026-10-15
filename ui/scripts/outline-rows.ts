// Outline row scanner (plan T1 gate, C4-7; T6a runs it as `npm run lessons:rows`).
// Scans the whole of each outlines/*.md for "to verify", "propose row" and
// "new row", splits multi-item bullets on semicolons, de-duplicates, and prints
// raw and de-duplicated counts.
//
//   npm run lessons:rows -- [outlines-dir]
// The default dir is ../.omc/plans/curriculum/outlines from ui/; when that's
// missing (a git worktree), the nearest one up the directory tree is used.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface RowItem {
  file: string;
  line: number;
  text: string;
  /** The step block the item sits in: contiguous non-blank lines, 1-based inclusive. */
  block: [number, number];
}

const PHRASE = /to verify|propose row|new row/i;
const CHILD = /^\s+(?:\d+\.|[-*])\s+/;

/** Splits on semicolons outside brackets, parentheses, backticks and double quotes. */
export function splitItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '`' || c === '"') quote = c;
    else if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === ';' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

const clean = (line: string) => line.replace(/^\s*(?:\d+\.|[-*])\s+/, '').trim();

function blockOf(lines: string[], i: number): [number, number] {
  const boundary = (l: string | undefined) => l === undefined || l.trim() === '' || /^#/.test(l);
  let a = i;
  let b = i;
  while (!boundary(lines[a - 1])) a--;
  while (!boundary(lines[b + 1])) b++;
  return [a + 1, b + 1];
}

export function scanOutline(file: string, text: string): RowItem[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const items: RowItem[] = [];
  const push = (i: number, body: string) => {
    for (const t of splitItems(body)) items.push({ file, line: i + 1, text: t, block: blockOf(lines, i) });
  };
  for (let i = 0; i < lines.length; i++) {
    if (!PHRASE.test(lines[i])) continue;
    // A "To verify ...:" header with an indented list under it: the list entries are the items.
    const isHeader = /:\s*$/.test(lines[i].replace(/[*_]+\s*$/, ''));
    const children: number[] = [];
    if (isHeader) for (let j = i + 1; j < lines.length && CHILD.test(lines[j]); j++) children.push(j);
    if (children.length) {
      for (const j of children) push(j, clean(lines[j]));
      i = children[children.length - 1];
    } else {
      push(i, clean(lines[i]));
    }
  }
  return items;
}

const key = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');

export function dedupe(items: RowItem[]): RowItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = key(it.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The outlines dir: the given one, else the default, else the nearest `.omc/plans/curriculum/outlines` above `from`. */
export function findOutlines(from: string, given?: string): string | null {
  if (given) return existsSync(given) ? resolve(given) : null;
  const def = resolve(from, '../.omc/plans/curriculum/outlines');
  if (existsSync(def)) return def;
  let dir = resolve(from);
  for (;;) {
    const cand = join(dir, '.omc/plans/curriculum/outlines');
    if (existsSync(cand)) return cand;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function scanOutlines(dir: string): { raw: RowItem[]; unique: RowItem[] } {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const raw = files.flatMap((f) => scanOutline(f, readFileSync(join(dir, f), 'utf8')));
  return { raw, unique: dedupe(raw) };
}

function main(argv: string[]) {
  const dir = findOutlines(process.cwd(), argv[0]);
  if (!dir) {
    console.error(`No outlines folder found${argv[0] ? ` at ${argv[0]}` : ''}.`);
    process.exit(2);
  }
  const { raw, unique } = scanOutlines(dir);
  for (const it of unique) console.log(`${it.file}:${it.line}\t${it.text}`);
  console.log(`\nraw items: ${raw.length}`);
  console.log(`de-duplicated items: ${unique.length}`);
}

// Run as a script (vite-node puts the script's own arguments after its runner); tests import it.
if (!process.env.VITEST) main(process.argv.slice(2));
