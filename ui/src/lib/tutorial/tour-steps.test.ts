import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LARGE_TARGETS, tourChapters, tourUi } from './tour-steps';

const SRC = join(__dirname, '..', '..');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return svelteFiles(p);
    return name.endsWith('.svelte') ? [p] : [];
  });
}

const allSvelte = svelteFiles(SRC)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const steps = tourChapters.flatMap((c) => c.steps);
const words = (s: string) => s.trim().split(/\s+/).length;

describe('tour anchors', () => {
  it('every step target is a data-tour or data-tip attribute in the UI source', () => {
    const missing = steps
      .filter((s) => s.target !== null)
      .filter((s) => !allSvelte.includes(`data-tour="${s.target}"`) && !allSvelte.includes(`data-tip="${s.target}"`))
      .map((s) => `${s.id} -> ${s.target}`);
    expect(missing).toEqual([]);
  });
});

describe('tour structure', () => {
  it('has unique chapter and step ids, and no empty chapter', () => {
    const chapterIds = tourChapters.map((c) => c.id);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);
    const stepIds = steps.map((s) => s.id);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    for (const c of tourChapters) expect(c.steps.length).toBeGreaterThan(0);
  });

  it('starts with the basics and ends without async work on the Done step', () => {
    expect(tourChapters[0].id).toBe('basics');
    const last = tourChapters.at(-1)!.steps.at(-1)!;
    expect(last.run).toBeUndefined();
  });

  it('only Compare chapter steps use Compare mode', () => {
    for (const c of tourChapters) {
      for (const s of c.steps) expect(!!s.compare).toBe(c.id === 'compare');
    }
  });
});

describe('tour copy', () => {
  it('keeps blurbs short and Why? text bounded', () => {
    const long = steps.filter((s) => words(s.blurb) > 35).map((s) => `${s.id} (${words(s.blurb)})`);
    expect(long).toEqual([]);
    const longWhy = steps.filter((s) => s.why && words(s.why) > 120).map((s) => `${s.id} (${words(s.why!)})`);
    expect(longWhy).toEqual([]);
  });

  it('uses no em dashes anywhere', () => {
    const texts = [
      ...steps.flatMap((s) => [s.blurb, s.why ?? '', s.run?.label ?? '']),
      ...tourChapters.flatMap((c) => [c.title, c.summary]),
      ...Object.values(tourUi).flatMap((v) =>
        typeof v === 'string'
          ? [v]
          : typeof v === 'function'
            ? [(v as (...a: unknown[]) => string)('GPT-2', 2)]
            : Object.values(v),
      ),
    ];
    expect(texts.filter((t) => t.includes('—'))).toEqual([]);
  });

  it('describes positive and negative with the colors the UI uses', () => {
    const all = steps.map((s) => `${s.blurb} ${s.why ?? ''}`).join(' ').toLowerCase();
    expect(all).not.toMatch(/\bred bars?\b|\bgreen bars?\b/);
  });
});

describe('tour placement', () => {
  it('every step targeting a LARGE_TARGETS anchor declares focus', () => {
    const missing = steps
      .filter((s) => s.target !== null && LARGE_TARGETS.includes(s.target) && !s.focus)
      .map((s) => s.id);
    expect(missing).toEqual([]);
    for (const s of steps) {
      if (!s.focus) continue;
      for (const f of s.focus) expect(f >= 0 && f <= 1, `${s.id} focus in [0,1]`).toBe(true);
    }
  });

  it('placement values are valid sides', () => {
    const sides = ['top', 'bottom', 'left', 'right'];
    const bad = steps.filter((s) => s.placement !== undefined && !sides.includes(s.placement)).map((s) => s.id);
    expect(bad).toEqual([]);
  });
});
