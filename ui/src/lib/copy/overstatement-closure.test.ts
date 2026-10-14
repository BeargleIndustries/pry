// Overstatement closure (plan pry-learning-mode-2026-10-12, T6 "Caveats and closure";
// audit-curriculum-2026-10-12 §1.3, 29 rows).
//
// Each overstatement closes where its text survives (tips, panels, glossary, welcome):
// the old phrase is gone from the file's visible strings and the defensible rewrite is
// there. Rows in the tour and the experiments close by deletion in T7b: they run as
// `test.todo` while the file exists and pass once it's gone.
//
// Old phrases are regexes with `\s` for spaces, so the plan's `rg` over ui/src/lib
// doesn't find this file quoting them.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, read, visible } from './copy-files';
import { visibleHits } from './visible-strings';

interface Row {
  n: number;
  file: string;
  /** Must not appear in any visible string. */
  old: RegExp;
  /** Whole file must contain (whitespace runs compare as one space). */
  now?: string[];
  /** The row closes when T7b deletes the file. */
  byDeletion?: true;
  /** The file is reworded now and T7b deletes it later: a missing file passes too. */
  deletedLater?: true;
}

const TOUR = 'lib/tutorial/tour-steps.ts';
const EXP = 'lib/experiments/experiments.json';
const TIPS = 'lib/tips/tips-registry.ts';

export const OVERSTATEMENTS: Row[] = [
  { n: 1, file: TOUR, old: /shows\syou\swhat\swent\son\sinside\swhile\sit\sguessed/, byDeletion: true },
  { n: 2, file: TOUR, old: /not\son\ssome\sphrase\sthe\smodel\smemorized/, byDeletion: true },
  { n: 3, file: TOUR, old: /features\sshow\swhat\sit's\sthinking\sabout/, byDeletion: true },
  { n: 4, file: TOUR, old: /looking\sat\sthe\sbias\sinside\sthe\smodel/, byDeletion: true },
  { n: 5, file: TOUR, old: /causal\sevidence\sthe\slabel's\sright/, byDeletion: true },
  { n: 6, file: TOUR, old: /brings\sthe\soriginal\sanswer\sback/, byDeletion: true },
  { n: 7, file: TOUR, old: /where\sthe\sname\sthat\smatters\sis\ssitting/, byDeletion: true },
  {
    n: 8,
    file: TOUR,
    old: /model's\sconfidence,\sand\sconfidence\sisn't\sa\sfact\scheck/,
    now: ['When one guess gets most of the chance, over 50%, the confident tag appears.'],
    deletedLater: true,
  },
  { n: 9, file: TOUR, old: /the\sright\sanswer\sshows\sup\sand\sgets\sstronger/, byDeletion: true },
  { n: 10, file: TOUR, old: /you've\sprobably\sfound\ssomething\sreal/, byDeletion: true },
  { n: 11, file: EXP, old: /The\smodel's\snever\sseen\sthis\sphrase/, byDeletion: true },
  { n: 12, file: EXP, old: /more\sof\sthe\sanswer\scame\sback/, byDeletion: true },
  { n: 13, file: EXP, old: /lists\sthe\sconcepts\sthe\sfeature/, byDeletion: true },
  {
    n: 14,
    file: TIPS,
    old: /an\sunsure\sone\sis\stelling\syou\ssomething/,
    now: ['often a good place to look, since small changes to the prompt can tip them'],
  },
  { n: 15, file: TIPS, old: /make\sup\sits\smind|slow\smotion/, now: ["A rough read of what each layer's partial result would predict"] },
  { n: 16, file: TIPS, old: /where\sthe\sanswer\sgot\ssettled/, now: ['the layers around the change are a good place to look next'] },
  {
    n: 17,
    file: TIPS,
    old: /good\sevidence\sthe\sfeature\sdoes\swhat\sits\slabel\ssays/,
    now: ["that's evidence the feature pushes the writing that way at this strength"],
  },
  { n: 18, file: TIPS, old: /it\swasn't\sneeded/, now: ['No change means the model could answer without it here. Other parts may have covered for it.'] },
  { n: 19, file: TIPS, old: /were\sdriving\sthe\sguess/, now: ['those features affect the guess here'] },
  { n: 20, file: TIPS, old: /settles\sit/, now: ['Knocking it out is a test'] },
  { n: 21, file: TIPS, old: /bring\sthe\soriginal\sanswer\sback/, now: ["Blue squares raise the original answer's score"] },
  { n: 22, file: TIPS, old: /honest\scheck|probably\sabout\sright/, now: ['Steering is one check', 'the label fits at least that much'] },
  { n: 23, file: TIPS, old: /an\sidea\sthe\sfeature/, now: ['found active on the selected word, often matching an idea'] },
  { n: 24, file: 'lib/glossary.ts', old: /shows\sa\ssimple\sversion/, now: ['a starting point, not an established circuit'] },
  { n: 25, file: 'routes/+page.svelte', old: /Concepts\sthe\smodel\slit\sup/, now: ['Patterns a separate network (an SAE) found'] },
  { n: 26, file: 'routes/+page.svelte', old: /change\sits\smind/, now: ['A rough read of what each layer would guess'] },
  { n: 27, file: 'lib/components/PanelB.svelte', old: /Concepts\sthat\slit\sup|see\sthe\sconcepts\sinside/, now: ['Features that fired', 'see which features fire'] },
  { n: 28, file: 'lib/readouts.ts', old: /No\ssingle\spart\sbrings/, now: ['No single part raises the score'] },
  { n: 29, file: 'routes/welcome/+page.svelte', old: /opens\sthe\sblack\sbox|ideas\slight\sup/, now: ['which patterns fire inside it'] },
];

describe('overstatement closure (audit §1.3)', () => {
  it('has the audit’s 29 rows', () => {
    expect(OVERSTATEMENTS.map((r) => r.n)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  for (const r of OVERSTATEMENTS) {
    const name = `overstatement ${r.n}: ${r.file}`;
    const exists = existsSync(resolve(SRC, r.file));
    if (r.byDeletion) {
      if (exists) it.todo(`${name} [closes when T7b deletes it]`);
      else it(name, () => expect(exists).toBe(false));
      continue;
    }
    if (!exists && r.deletedLater) {
      it(name, () => expect(exists).toBe(false));
      continue;
    }
    it(name, () => {
      expect(visibleHits(visible(r.file), r.old), `${name} still says ${r.old}`).toEqual([]);
      const flat = read(r.file).replace(/\s+/g, ' ');
      for (const s of r.now ?? []) expect(flat, `${name} +"${s}"`).toContain(s);
    });
  }
});
