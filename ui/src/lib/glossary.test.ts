import { describe, it, expect } from 'vitest';
import { glossary, lookupTerm, resolveTerm, MAX_DEFINITION_LENGTH } from './glossary';

// Every .svelte source file under src/, as raw text.
const svelteSources = import.meta.glob('/src/**/*.svelte', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('glossary', () => {
  const entries = Object.entries(glossary);

  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries)('%s: definition is non-empty and at most 140 characters', (_key, e) => {
    expect(e.term.trim()).not.toBe('');
    expect(e.definition.trim()).not.toBe('');
    expect(e.definition.length).toBeLessThanOrEqual(MAX_DEFINITION_LENGTH);
  });

  it('keys, terms and aliases are unique and each resolves to its own entry', () => {
    const seen = new Map<string, string>();
    for (const [key, e] of entries) {
      const names = new Set([key, e.term, ...e.aliases].map((n) => n.toLowerCase()));
      for (const name of names) {
        expect(name.trim()).not.toBe('');
        const owner = seen.get(name);
        expect(owner === undefined || owner === key, `"${name}" used by ${owner} and ${key}`).toBe(true);
        seen.set(name, key);
        expect(resolveTerm(name)).toBe(key);
      }
    }
  });

  it('looks up aliases case-insensitively', () => {
    expect(lookupTerm('Head')).toBe(glossary['attention-head']);
    expect(lookupTerm('Tokens')).toBe(glossary.token);
    expect(lookupTerm('knockout')).toBe(glossary.ablation);
    expect(lookupTerm('not a term')).toBeNull();
  });

  it('every <Term key=...> in the UI exists in the glossary', () => {
    const files = Object.entries(svelteSources);
    expect(files.length).toBeGreaterThan(5);
    const used: string[] = [];
    for (const [path, src] of files) {
      for (const m of src.matchAll(/<Term\s+key="([^"]+)"/g)) {
        used.push(m[1]);
        expect(resolveTerm(m[1]), `${path}: unknown term "${m[1]}"`).not.toBeNull();
      }
    }
    expect(used.length).toBeGreaterThan(0);
  });

  // copy:G1: an entry nobody can open is wasted; attach it where the word appears.
  it('every glossary key is used by at least one <Term>', () => {
    const usedKeys = new Set<string>();
    for (const src of Object.values(svelteSources)) {
      for (const m of src.matchAll(/<Term\s+key="([^"]+)"/g)) {
        const key = resolveTerm(m[1]);
        if (key) usedKeys.add(key);
      }
    }
    const unused = Object.keys(glossary).filter((k) => !usedKeys.has(k));
    expect(unused, `glossary keys with no <Term>: ${unused.join(', ')}`).toEqual([]);
  });

  // copy:G2
  it('has entries: direct-value-path, threshold, query-key, name-mover, seed, circuit, patching', () => {
    for (const key of ['direct-value-path', 'threshold', 'query-key', 'name-mover', 'seed', 'circuit', 'patching']) {
      expect(glossary[key], key).toBeDefined();
    }
  });

  it('copy:G3 and copy:G4 wording', () => {
    expect(glossary.dla.definition).toContain('leaves out help');
    expect(glossary.temperature.definition).toContain('randomness');
  });
});
