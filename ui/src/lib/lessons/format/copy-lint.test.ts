import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { formatValue } from '../slots';
import type { CopyLintOptions, LintWords, TermsData } from './copy-lint';
import { copy, errors } from './fixtures/helpers';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const terms = parse(readFileSync(here('../../../lessons/terms.yaml'), 'utf8')) as TermsData;
const words = parse(readFileSync(here('../../../lessons/lint-words.yaml'), 'utf8')) as LintWords;
const path = [...new Set(terms.terms.map((t) => t.introduced_in))];
const OPTS: CopyLintOptions = { terms, words, path };

const F = '```';
const yaml = (s: string) => `${F}yaml\n${s}\n${F}`;
const step = (head: string, body: string) => `:::${head}\n${body}\n:::\n`;
const explain = (text: string) => `## A\n\n${step('explain{id=e}', text)}`;
const lesson = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });
const TOUR = lesson('pry.quick-tour', { presentation: 'overlay' });
const run = (body: string, fm: Record<string, unknown> = lesson('pry.p1-3')) => errors(copy(body, fm, OPTS));

describe('copy lint', () => {
  it('› term used before its introduced_in lesson is an error', () => {
    expect(run(explain('Each layer adds to the residual stream.'), lesson('pry.p1-1'))).toContain('term-early');
    expect(run(explain('Each layer adds to the residual stream.'), lesson('pry.p1-3'))).not.toContain('term-early');
  });

  it('› term inside a fold is allowed early', () => {
    const body = `## A\n\n::::fold{id=f title="More"}\n\n${step('explain{id=e}', 'The residual stream holds it.')}\n::::\n`;
    expect(run(body, lesson('pry.p1-1'))).not.toContain('term-early');
  });

  it('› fourth new term without exception is an error', () => {
    const body = ['the token', 'the vocabulary', 'the start-of-text marker', 'the positional embedding']
      .map((t, i) => `## S${i}\n\n${step(`explain{id=e${i}}`, `This is ${t}.`)}`)
      .join('\n');
    expect(run(body, lesson('pry.p1-2'))).toContain('term-budget-lesson');
    expect(run(body, lesson('pry.p1-2', { term_budget_exception: 'round 7 #17' }))).not.toContain('term-budget-lesson');
    expect(run(explain('The token and the vocabulary.'), lesson('pry.p1-2'))).toContain('term-budget-section');
  });

  it('› banned model verb in prose is an error', () => {
    expect(run(explain('Here the model thinks about Paris.'))).toContain('model-verb');
  });

  it('› banned model verb in a predict choice is allowed', () => {
    const body = `## A\n\n${step('predict{id=p}', `Why?\n\n${yaml('choices:\n  - { text: "The model knows the answer", feedback: "Lots of people expect that." }')}`)}`;
    expect(run(body)).not.toContain('model-verb');
  });

  it('› banned model verb inside :refutes is allowed', () => {
    expect(run(explain('If :refutes[the model knows the capital], the internet would matter.'))).not.toContain('model-verb');
  });

  it('› quoted "Logit Lens" in the tour is not a term use', () => {
    expect(run(explain('Open the "Logit Lens" tab.'), TOUR)).not.toContain('tour-term');
    expect(run(explain('Open the “Logit Lens” tab.'), TOUR)).not.toContain('tour-term');
    expect(run(explain('Open the logit lens.'), TOUR)).toContain('tour-term');
  });

  it('› "falls a lot" in a predict choice and "most directly" in the pinned DLA caveat pass', () => {
    const body = `## A

${step('predict{id=p}', `What happens to " Mary"?\n\n${yaml('choices:\n  - { text: "It falls a lot", feedback: "It went another way." }')}`)}
${step('explain-result{id=er}', yaml('supports: ["The bars show which parts pushed most directly toward the answer."]\nleaves_open: ["Help through later parts."]\ntool: dla'))}`;
    expect(run(body, lesson('pry.p2-4'))).toEqual([]);
    expect(run(explain('The answer falls a lot.'))).toContain('qualitative');
  });

  it('› retired phrase is an error', () => {
    expect(run(explain('Watch it make up its mind.'))).toContain('retired');
  });

  it('› bare percentage in prose is an error', () => {
    expect(run(explain('Paris gets 9.7% of it.'))).toContain('bare-number');
    expect(run(explain('Paris gets 0.097 of it.'))).toContain('bare-number');
  });

  it('› bare "L9" or token count in prose is an error', () => {
    expect(run(explain('Look at L9 first.'))).toContain('bare-number');
    expect(run(explain('The prompt became 7 tokens.'))).toContain('bare-number');
    expect(run(explain('Check position 5.'))).toContain('bare-number');
  });

  it('› percentage slot renders natural frequency', () => {
    expect(formatValue(0.097, 'probability')).toBe('9.7% (about 1 in 10)');
    const fm = lesson('pry.p1-4', { slots: { p: { read: 'top_guess.prob', expect: 0.097 } } });
    expect(run(explain('Paris gets {p}% of it.'), fm)).toContain('percent-slot');
    expect(run(explain('Paris gets {p}.'), fm)).toEqual([]);
  });

  it('› derived slot without its sources in the step is an error', () => {
    const fm = lesson('pry.p3-3', {
      slots: {
        clean: { read: 'dla.actual', expect: 3.2 },
        corrupted: { read: 'dla.actual', expect: 0.1 },
        patched: { read: 'dla.actual', expect: 2 },
        share: { from: ['clean', 'corrupted', 'patched'], formula: 'share' },
      },
    });
    expect(run(explain('It lands {share} of the way.'), fm)).toContain('derived-sources');
    expect(run(explain('It moves from {corrupted} to {patched}, {share} of the way back to {clean}.'), fm)).toEqual([]);
  });

  it('› "a lot" outside an assert is an error', () => {
    expect(run(explain('That slice carries a lot of the difference.'))).toContain('qualitative');
    const asserted = explain(
      `That slice carries some of it.\n\n${yaml('assert:\n  - require: { slot: s, op: gt, value: 0.5 }\n    say: "a lot of the difference"\n    else: "some of the difference"')}`,
    );
    expect(run(asserted, lesson('pry.p1-3', { slots: { s: { read: 'top_guess.prob', expect: 0.6 } } }))).toEqual([]);
  });

  it('› second exclamation mark is an error', () => {
    expect(run(explain('Look at that!'))).toEqual([]);
    expect(run(explain('Look at that! And that!'))).toContain('exclamation');
  });

  it('› tour_banned verb in the overlay lesson is an error', () => {
    expect(run(explain('This tab shows why it picked that.'), TOUR)).toContain('tour-banned');
    expect(run(explain('This tab shows two runs side by side.'), TOUR)).toEqual([]);
  });

  it('› unquoted "token" in the tour is an error', () => {
    expect(run(explain('Click a token above the panels.'), TOUR)).toContain('tour-term');
  });

  it('› P1.3:45 "L0 to L11" passes as inline code or row-constant slots', () => {
    expect(run(explain('Pry numbers them L0 to L11.'))).toContain('bare-number');
    expect(run(explain('Pry numbers them `L0` to `L11`.'))).toEqual([]);
    const fm = lesson('pry.p1-3', { slots: { first: { row: '20.first_layer', format: 'layer' }, last: { row: '20.last_layer', format: 'layer' } } });
    expect(run(explain('Pry numbers them {first} to {last}.'), fm)).toEqual([]);
  });

  it('› P3.2:51 name movers pass as {row: ...} slots and fail as bare L9H9', () => {
    const fm = lesson('pry.p3-2', { slots: { movers: { row: '26.name_movers' } } });
    expect(run(explain('The name mover heads are L9H9, L9H6 and L10H0.'), fm)).toContain('bare-number');
    expect(run(explain('The name mover heads are {movers}.'), fm)).toEqual([]);
  });

  it('› missing pinned caveat beside its tool\'s result is an error', () => {
    const er = (supports: string) => `## A\n\n${step('explain-result{id=er}', yaml(`supports: ["${supports}"]\nleaves_open: ["Help through later parts."]\ntool: dla`))}`;
    expect(run(er('The bars show each part.'), lesson('pry.p2-4'))).toContain('caveat-missing');
    expect(run(er('Only direct pushes count, so read each bar as one part.'), lesson('pry.p2-4'))).toEqual([]);
  });
});

// Copy-lint changes forced by the T1 outline-coverage gate (each names the outline line).
describe('copy lint: outline-coverage additions', () => {
  it('› term_budget_exception also lifts the one-term-per-section rule (P1.2:27)', () => {
    expect(run(explain('The token and the vocabulary.'), lesson('pry.p1-2', { term_budget_exception: 'round 7 #17' }))).not.toContain('term-budget-section');
  });

  it('› a term family counts as one new term in its section (P3.3:8)', () => {
    expect(run(explain('The clean run and the corrupted run.'), lesson('pry.p3-3'))).not.toContain('term-budget-section');
  });

  it('› a stand-in name is fine until its term is named, retired after (P1.2:79)', () => {
    const two = `## A\n\n${step('explain{id=a}', 'The starting numbers are its embedding.')}\n## B\n\n${step('explain{id=b}', 'The starting numbers again.')}`;
    const errs = errors(copy(two, lesson('pry.p1-2'), OPTS));
    expect(errs.filter((c) => c === 'retired')).toHaveLength(1);
    expect(run(explain('The starting numbers.'), lesson('pry.p1-3'))).toContain('retired');
    expect(run(explain('The starting numbers.'), lesson('pry.p1-1'))).not.toContain('retired');
  });

  it('› a choice may be a fixed percentage bin, and 100% is the whole (P1.4:34, P1.4:59)', () => {
    const p = `## A\n\n${step('predict{id=p checks=o}', `How much of the 100% will it get?\n\n${yaml('choices:\n  - { text: "under 10%" }\n  - { text: "over 50%" }')}`)}`;
    expect(run(p, lesson('pry.p1-4'))).not.toContain('bare-number');
    expect(run(explain('It got 34% of it.'), lesson('pry.p1-4'))).toContain('bare-number');
  });

  it('› a predict or question stem asks, so a qualitative word there is fine (P2.1:40)', () => {
    const p = `## A\n\n${step('predict{id=p checks=o}', `Which earlier word matters most?\n\n${yaml('choices:\n  - { text: "A" }')}`)}`;
    expect(run(p, lesson('pry.p2-1'))).not.toContain('qualitative');
    expect(run(explain('Most of it goes there.'), lesson('pry.p2-1'))).toContain('qualitative');
  });

  it('› exempt phrases: a rank ("the most") and a non-model subject ("temperature decides") (P1.4:93, P1.5:88)', () => {
    expect(run(explain("' one' got the most, but only about 1 in 3."), lesson('pry.p1-4'))).not.toContain('qualitative');
    expect(run(explain('Temperature decides how random the pick is.'), lesson('pry.p1-5'))).not.toContain('model-verb');
    expect(run(explain('The model decides.'), lesson('pry.p1-5'))).toContain('model-verb');
  });

  it('› the lesson that withdraws a picture may name it (P2.1:49)', () => {
    const line = explain("That's the assembly line's picture: we're done with it.");
    expect(run(line, lesson('pry.p2-1'))).not.toContain('metaphor-name');
    expect(run(line, lesson('pry.p2-2'))).toContain('metaphor-name');
  });

  it('› inline code inside a refutation is masked (P2.3:58)', () => {
    expect(run(explain(':refutes[being on top at `L9` settled nothing]'), lesson('pry.p2-3'))).not.toContain('bare-number');
  });
});

describe('lint-words.yaml', () => {
  it('keeps every pinned caveat phrase in step with copy/caveats.test.ts', () => {
    const pins = readFileSync(here('../../copy/caveats.test.ts'), 'utf8').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    for (const [tool, phrases] of Object.entries(words.pinned_caveats)) {
      for (const p of phrases) expect(pins.includes(p) || pins.includes(p.replace(/'/g, "\\'")), `${tool}: ${p}`).toBe(true);
    }
  });
});
