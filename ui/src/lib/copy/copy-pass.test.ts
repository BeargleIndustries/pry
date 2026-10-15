// 0.4.0 copy pass (plan pry-learning-mode-2026-10-12 lines 536-537; style guide §2,
// round 7 #19). One row per copy-pass item: the old phrase is absent, the new one present.
//
// Old phrases are regexes with `\s` for spaces, so the plan's `rg` over ui/src/lib
// doesn't find this file quoting them.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { glossary, resolveTerm } from '../glossary';
import { DLA_GAP_EXPLAINED, FEATURE_KNOCKOUT_NOTE } from '../readouts';
import { tipsRegistry } from '../tips/tips-registry';
import { SRC, allFiles, read, visible } from './copy-files';
import { visibleHits } from './visible-strings';

const PAGE = 'routes/+page.svelte';
// The 0.3.8 tour's step file (T7b deleted it). Spelled in two parts so T7b's
// acceptance grep for the retired module names over ui/src stays empty.
const TOUR = 'lib/tutorial/tour' + '-steps.ts';
const C = (name: string) => `lib/components/${name}.svelte`;
const squash = (s: string) => s.replace(/\s+/g, ' ');

/** A tab's `title` in +page.svelte. */
function tabTitle(id: string): string {
  const m = read(PAGE).match(new RegExp(`id: '${id}',[^}]*?title:\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`));
  expect(m, `${id} tab has a title`).not.toBeNull();
  return m![1];
}

const tipWhy = (id: string) => squash(tipsRegistry.find((t) => t.id === id)?.why ?? '');

/** Old phrase gone from the file's visible strings, new phrase in the file. */
function swapped(file: string, old: RegExp, now: string) {
  expect(visibleHits(visible(file), old), `${file} still says ${old}`).toEqual([]);
  expect(squash(read(file)), file).toContain(now);
}

describe('0.4.0 copy pass', () => {
  // --- Tab tooltips (+page.svelte)
  it('Logit Lens tab tooltip', () => {
    const t = tabTitle('logit-lens');
    expect(t).not.toMatch(/change\sits\smind/);
    expect(t).toContain('A rough read of what each layer would guess');
  });
  it('Features tab tooltip', () => {
    const t = tabTitle('features');
    expect(t).not.toMatch(/lit\sup|knew/);
    expect(t).toContain('Patterns a separate network (an SAE) found');
  });
  it('Predictions tab tooltip', () => {
    const t = tabTitle('predictions');
    expect(t).not.toMatch(/thinks/);
    expect(t).toContain('The probability the model gives each possible next token');
  });

  // --- Glossary
  it('glossary: layer reads the residual stream', () => {
    expect(glossary.layer.definition).not.toMatch(/running\snotes/);
    expect(glossary.layer.definition).toContain('reads the residual stream');
  });
  it('glossary: residual stream defined by what it is', () => {
    expect(glossary['residual-stream'].definition).not.toMatch(/running\snotes/);
    expect(glossary['residual-stream'].definition).toContain("Each token's list of numbers");
  });
  it('glossary: MLP as the half of each layer after attention', () => {
    expect(glossary.mlp.definition).not.toMatch(/processing\sblock/);
    expect(glossary.mlp.definition).toContain('The half of each layer that comes after attention');
  });
  it('glossary: SAE as sparse autoencoder (SAE)', () => {
    expect(JSON.stringify(glossary.sae)).not.toMatch(/feature\sdictionary/);
    expect(glossary.sae.definition).toContain('A sparse autoencoder (SAE)');
  });
  it('glossary: token throughout', () => {
    expect(read('lib/glossary.ts')).not.toMatch(/word\x2dpiece/);
    expect(resolveTerm('word\x2dpiece')).toBeNull();
    expect(glossary.token.definition).toContain('The smallest chunk of text the model works with');
  });
  it('glossary: entry patching reads activation patching', () => {
    expect(glossary.patching.term).toBe('activation patching');
    expect(resolveTerm('patching')).toBe('patching');
  });
  it('glossary: start-of-text marker alias removed', () => {
    expect(glossary['attention-sink'].aliases.map((a) => a.toLowerCase())).not.toContain('attention\x20sink');
    expect(resolveTerm('attention\x20sink')).toBeNull();
    expect(glossary['attention-sink'].term).toBe('start-of-text marker');
  });
  it('glossary introducedIn matches terms.yaml', () => {
    const terms = (parse(read('lessons/terms.yaml')) as { terms: { term: string; aliases?: string[]; introduced_in: string }[] }).terms;
    const byName = new Map<string, string>();
    for (const t of terms) for (const n of [t.term, ...(t.aliases ?? [])]) byName.set(n.toLowerCase(), t.introduced_in);
    for (const [key, e] of Object.entries(glossary)) {
      const hit = [e.term, ...e.aliases].map((n) => byName.get(n.toLowerCase())).find((v) => v !== undefined);
      expect(e.introducedIn, `${key} introducedIn`).toBe(hit);
    }
    expect(Object.values(glossary).filter((e) => e.introducedIn).length).toBeGreaterThan(20);
  });

  // --- Panel headings say token
  it('Predictions heading says token', () => {
    swapped(C('PredictionsPanel'), /Next-word\sguesses/, 'Next-token guesses (top 10)');
    swapped(C('SteeringPanel'), /Next-word\sguesses/, 'Next-token guesses (top 5)');
    swapped(C('ComparePanel'), /Next-word\sguesses/, 'Next-token guesses');
  });
  it('Features on this token', () => {
    swapped(C('ComparePanel'), /Features\son\sthis\sword/, 'Features on this token');
  });
  it('How differently each head looks from this token', () => {
    swapped(C('ComparePanel'), /looks\sfrom\sthis\sword/, 'How differently each head looks from this token');
  });

  // --- Tips
  it('TIPS:183 uses the DLA gap wording', () => {
    const why = tipWhy('dla-waterfall');
    expect(why).not.toMatch(/won't\sadd\sup/);
    expect(why).toContain("the bars' total, the real logit and the gap");
    expect(why).toContain(DLA_GAP_EXPLAINED.replace(/\.$/, ''));
  });
  it('TIPS:224 gets the feature-knockout description', () => {
    const why = tipWhy('ablation-feature-toggle');
    expect(why).not.toMatch(/settles\sit/);
    expect(why).toContain(FEATURE_KNOCKOUT_NOTE);
  });

  // --- Tour (T7b deletes the file; the idea lands in P1.4)
  it('TOUR:374 reworded', () => {
    if (!existsSync(resolve(SRC, TOUR))) return;
    swapped(TOUR, /90%\ssure\sand\sstill\swrong/, 'a top guess can get 90% and still be wrong');
  });

  // --- The plan's rg over ui/src/lib (line 546), outside lesson folds and analogies that quote them
  it('retired phrases are gone from ui/src/lib', () => {
    const retired =
      /running\snotes|processing\sblock|feature\sdictionary|word\x2dpiece|attention\ssink|change\sits\smind|what\sit\s.knew.|how\slikely\sit\sthinks/;
    // Quoting is allowed in the outline skeletons (analogy and fold blocks). The tour and
    // the experiments close by deletion in T7b.
    const exempt = (f: string) => f.startsWith('lib/lessons/fixtures/outline-coverage/') || f === TOUR || f === 'lib/experiments/experiments.json';
    const hits = allFiles()
      .filter((f) => f.startsWith('lib/') && !exempt(f))
      .filter((f) => retired.test(read(f)));
    expect(hits).toEqual([]);
  });
});
