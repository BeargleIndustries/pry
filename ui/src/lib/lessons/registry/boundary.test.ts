import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Plan "The runner contract": nothing under ui/src/lib/lessons/** except
// registry/pry-* imports Pry (tool) code, so the runner and format stay
// tool-agnostic. "Pry code" = any module under ui/src/lib outside lessons/,
// reached by a relative path or `$lib/` (the shared lesson scripts in
// ui/scripts are not Pry code). Allowed: the pointer and popup placement.

const LESSONS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = resolve(LESSONS, '..');
const ALLOWED = ['components/Pointer.svelte', 'popup/place.ts', 'popup/occupied.svelte.ts'].map((p) => resolve(LIB, p));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|svelte)$/.test(name) ? [p] : [];
  });
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

/** Resolved target without extension handling: enough to tell inside vs outside lessons/. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith('$lib/')) return resolve(LIB, spec.slice(5));
  if (spec.startsWith('.')) return resolve(dirname(file), spec);
  return null; // a package
}

const isPryOwned = (file: string) => relative(LESSONS, file).split(sep)[0] === 'registry' && /^pry-/.test(relative(join(LESSONS, 'registry'), file));

describe('lessons boundary', () => {
  it('› no file under ui/src/lib/lessons/** except registry/pry-* imports Pry modules', () => {
    const bad: string[] = [];
    for (const f of files(LESSONS)) {
      if (isPryOwned(f)) continue;
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(IMPORT)) {
        const spec = m[1] ?? m[2] ?? m[3];
        const t = spec ? target(f, spec) : null;
        if (!t) continue;
        const inLib = t.startsWith(LIB + sep);
        const inside = t === LESSONS || t.startsWith(LESSONS + sep);
        const allowed = ALLOWED.some((a) => t === a || t === a.replace(/\.(ts|svelte)$/, ''));
        if (inLib && !inside && !allowed) bad.push(`${relative(LESSONS, f)} imports ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the check sees a planted import', () => {
    const fake = join(LESSONS, 'runner', 'x.ts');
    expect(target(fake, '../../analysis-core')).toBe(resolve(LIB, 'analysis-core'));
    expect(isPryOwned(join(LESSONS, 'registry', 'pry-actions.ts'))).toBe(true);
    expect(isPryOwned(join(LESSONS, 'registry', 'dispatcher.ts'))).toBe(false);
  });
});
