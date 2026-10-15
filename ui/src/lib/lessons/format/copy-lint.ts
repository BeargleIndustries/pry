// Copy lint (plan T1 "Copy lint", style guide sections 5-7). The word lists are
// data: `ui/src/lessons/terms.yaml` and `lint-words.yaml`, or a user lesson
// set's own copies. Code fences never reach here; inline code, slots and
// directive syntax are masked before any rule looks at the text.

import { makeIssue, type LessonIssue } from './errors';
import { allSteps, stepTexts, type StepText } from './normalise';
import { parseInline } from './parse';
import type { Lesson, Section, Slot, Step } from './schema';

export interface Term {
  term: string;
  introduced_in: string;
  aliases?: string[];
  /** Terms sharing a family are named together and count as one new term per section. */
  family?: string;
}

export interface TermsData {
  terms: Term[];
  /** Style guide section 2 labels and tab names; a term inside a quoted label isn't a use. */
  ui_labels: string[];
}

export interface LintWords {
  retired: string[];
  banned_model_verbs: string[];
  metaphor_names: string[];
  qualitative: string[];
  tour_banned: string[];
  /** Tool key -> the pinned caveat phrases (from copy/caveats.test.ts) one of which must sit beside its result. */
  pinned_caveats: Record<string, string[]>;
  /** Stand-in name -> its real term (map 5.2): a plain phrase until the term is named, retired after. */
  stand_in_names?: Record<string, string>;
  /** Phrases holding a qualitative word that state a rank, not a size ("got the most", P1.4:93). */
  qualitative_exempt?: string[];
  /** Phrases where a banned verb's subject isn't the model ("Temperature decides", P1.5:88). */
  model_verb_exempt?: string[];
  /** Metaphor -> the lesson that withdraws it (map 5.1); that lesson may name it to say it's done. */
  metaphor_withdrawn_in?: Record<string, string | string[]>;
  /** Stand-in name -> its term: retired only before the term is named (map 5.2:274, "direct pushes"). */
  pre_intro_retired?: Record<string, string>;
  /** Tour phrases holding a banned word that send the viewer to Lessons (quick-tour.md:50). */
  tour_banned_exempt?: string[];
}

export interface CopyLintOptions {
  terms: TermsData;
  words: LintWords;
  /** Lesson ids in path order (index.yaml order without overlay lessons). */
  path: string[];
}

interface Unit extends StepText {
  step: Step;
  section: Section;
  inFold: boolean;
  /** Text with inline code, slots and directive syntax blanked (labels kept). */
  base: string;
  /** Spans of `:refutes[...]` labels. */
  refutes: [number, number][];
}

const blank = (s: string, from: number, to: number) => s.slice(0, from) + ' '.repeat(Math.max(0, to - from)) + s.slice(to);

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

/** Whole-word, case-insensitive matches; `plural` also matches a trailing s / es. */
function wordRe(phrase: string, plural = false): RegExp {
  return new RegExp(`(?<![\\w-])${escape(phrase)}${plural ? '(?:s|es)?' : ''}(?![\\w-])`, 'gi');
}

function maskBase(text: string): { base: string; refutes: [number, number][] } {
  let base = text;
  const refutes: [number, number][] = [];
  for (const n of parseInline(text)) {
    if (n.type === 'code' || n.type === 'slot') {
      base = blank(base, n.start, n.end);
      continue;
    }
    // Keep a label's characters, blank the syntax around it.
    const raw = text.slice(n.start, n.end);
    const li = n.label !== undefined ? raw.indexOf(`[${n.label}]`) : -1;
    if (li < 0 || n.type === 'spine') {
      base = blank(base, n.start, n.end);
      continue;
    }
    const ls = n.start + li + 1;
    const le = ls + n.label!.length;
    base = blank(base, n.start, ls);
    base = blank(base, le, n.end);
    // Inline code and slots inside a label are masked too (`L9` in a refutation, P2.3:58).
    for (const c of parseInline(n.label!)) if (c.type === 'code' || c.type === 'slot') base = blank(base, ls + c.start, ls + c.end);
    if (n.type === 'refutes') refutes.push([ls, le]);
  }
  // Image syntax `![alt](src)` is not prose.
  base = base.replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => ' '.repeat(m.length));
  return { base, refutes };
}

/** Blanks quoted spans (straight or curly) whose content is a UI label. */
function maskLabels(text: string, labels: Set<string>): string {
  return text.replace(/"([^"\n]+)"|“([^”\n]+)”/g, (m, a: string | undefined, b: string | undefined) =>
    labels.has((a ?? b ?? '').trim().toLowerCase()) ? ' '.repeat(m.length) : m,
  );
}

function maskSpans(text: string, spans: [number, number][]): string {
  let out = text;
  for (const [a, b] of spans) out = blank(out, a, b);
  return out;
}

function maskPhrases(text: string, phrases: string[]): string {
  let out = text;
  for (const p of phrases) out = out.replace(wordRe(p), (m) => ' '.repeat(m.length));
  return out;
}

function units(lesson: Lesson): Unit[] {
  const out: Unit[] = [];
  const walk = (steps: Step[], section: Section, inFold: boolean) => {
    for (const step of steps) {
      for (const t of stepTexts(step)) out.push({ ...t, step, section, inFold, ...maskBase(t.text) });
      walk(step.children, section, inFold || step.kind === 'fold');
    }
  };
  for (const s of lesson.sections) walk(s.steps, s, false);
  return out;
}

/** "add up to 100%" and "of the 100%" name the whole distribution, not a measurement (P1.4:34, P1.4:59). */
const WHOLE_100 = /\b(?:adds?\s+up\s+to|adds?\s+to|of\s+the)\s+100\s?%|\b0\s?-\s?100\s?%\s+scale/gi;
const PERCENT_RULE = /(?<![\w.])\d+(?:\.\d+)?\s?%/g;
const LABEL_RULE = /(?<![\w-])L\d+(?:H\d+)?(?![\w])/g;
const NUMBER_RULES: RegExp[] = [
  PERCENT_RULE,
  /(?<![\w.])\d+\.\d+(?![\w.])/g,
  LABEL_RULE,
  /\b(?:position|token|word|layer)s?\s+\d+/gi,
  /(?<![\w.])\d+\s+(?:tokens|words)\b/gi,
];

export function copyLint(lesson: Lesson, opts: CopyLintOptions): LessonIssue[] {
  const issues: LessonIssue[] = [];
  const { terms, words } = opts;
  const labels = new Set(terms.ui_labels.map((l) => l.trim().toLowerCase()));
  const pinned = Object.values(words.pinned_caveats).flat();
  const meta = lesson.meta;
  const isTour = meta.presentation === 'overlay';
  const all = units(lesson);
  const where = (u: Unit) => ({ line: u.line, section: u.section.index, step: u.step.id });
  const err = (code: string, data: Record<string, unknown>, u: Unit) => issues.push(makeIssue(code, data, where(u)));
  const termNames = (t: Term) => [t.term, ...(t.aliases ?? [])];
  const hits = (text: string, phrase: string, plural = false) => [...text.matchAll(wordRe(phrase, plural))];

  // Terms used before their lesson, and the new-term budget.
  const here = opts.path.indexOf(meta.id);
  const firstSection = new Map<string, number>();
  for (const u of all) {
    const text = maskLabels(u.base, labels);
    for (const t of terms.terms) {
      if (!termNames(t).some((n) => hits(text, n, true).length)) continue;
      if (isTour) {
        err('tour-term', { term: t.term }, u);
        continue;
      }
      const intro = opts.path.indexOf(t.introduced_in);
      const exempt = u.inFold || u.role === 'choice';
      if (here >= 0 && intro > here && !exempt) err('term-early', { term: t.term, lesson: t.introduced_in }, u);
      if (t.introduced_in === meta.id && !exempt && !firstSection.has(t.term)) firstSection.set(t.term, u.section.index);
    }
  }
  if (!isTour) {
    const perSection = new Map<number, string[]>();
    for (const [term, s] of firstSection) perSection.set(s, [...(perSection.get(s) ?? []), term]);
    // Terms of one family ("clean run / corrupted run", P3.3:8) count as one naming moment.
    const familyOf = (term: string) => terms.terms.find((t) => t.term === term)?.family ?? term;
    for (const [s, list] of perSection) {
      if (new Set(list.map(familyOf)).size > 1) {
        const sec = lesson.sections[s - 1];
        issues.push(makeIssue('term-budget-section', { terms: list }, { line: sec.line, section: s }));
      }
    }
    const lessonNew = new Set([...(meta.new_terms ?? []), ...firstSection.keys()]);
    if (lessonNew.size > 3 && !meta.term_budget_exception) issues.push(makeIssue('term-budget-lesson', { n: lessonNew.size }, { line: 1, section: 0 }));
  }

  let bangs = 0;
  for (const u of all) {
    const labelled = maskLabels(u.base, labels);
    const refuted = maskSpans(u.base, u.refutes);

    // Pinned caveats are fixed wording (only the Critic or Brad changes them), so they're exempt.
    const unpinned = maskPhrases(labelled, pinned);
    for (const p of words.retired) if (hits(unpinned, p).length) err('retired', { phrase: p }, u);
    for (const [p, term] of Object.entries(words.stand_in_names ?? {})) {
      if (!hits(unpinned, p).length) continue;
      const intro = opts.path.indexOf(terms.terms.find((t) => t.term === term)?.introduced_in ?? '');
      // A lesson that never names its own term can't lean on the stand-in either (critic m6).
      const named = here < 0 || here > intro || (here === intro && u.section.index > (firstSection.get(term) ?? -Infinity));
      if (named) err('retired', { phrase: p }, u);
    }
    // Stand-in names retired only before their term is named: on the path before the term's
    // lesson, in the tour, and in that lesson before the term's section (map 5.2:274).
    for (const [p, term] of Object.entries(words.pre_intro_retired ?? {})) {
      if (!hits(unpinned, p).length) continue;
      const intro = opts.path.indexOf(terms.terms.find((t) => t.term === term)?.introduced_in ?? '');
      const early = isTour || (here >= 0 && here < intro) || (here === intro && u.section.index < (firstSection.get(term) ?? Infinity));
      if (early) err('retired', { phrase: p }, u);
    }

    if (u.role !== 'choice' && u.role !== 'feedback') {
      const notModel = maskPhrases(refuted, words.model_verb_exempt ?? []);
      for (const v of words.banned_model_verbs) if (hits(notModel, v).length) err('model-verb', { verb: v }, u);
    }
    if (u.step.kind !== 'analogy') {
      for (const p of words.metaphor_names) {
        // The step that withdraws a picture names it to say so, in the lesson map 5.1 withdraws it in (P2.1:49).
        const withdraws = Array.isArray(u.step.fields.withdraws) && u.step.fields.withdraws.includes(p);
        if (withdraws && [words.metaphor_withdrawn_in?.[p] ?? []].flat().includes(meta.id)) continue;
        if (hits(u.base, p).length) err('metaphor-name', { phrase: p }, u);
      }
    }
    // A choice may be a fixed percentage bin or layer range the learner picks ("under 10%" P1.4:34,
    // "L0-L2" P2.3:45, P2.4:78), and a quoted phrase in an analogy ("70% chance of rain", P1.4:51)
    // isn't a measurement. Every other number rule still applies to both.
    let numeric = labelled.replace(WHOLE_100, (m) => ' '.repeat(m.length));
    if (u.step.kind === 'analogy' && u.role === 'field') numeric = numeric.replace(/"[^"\n]*"/g, (m) => ' '.repeat(m.length));
    for (const re of NUMBER_RULES) {
      if (u.role === 'choice' && (re === PERCENT_RULE || re === LABEL_RULE)) continue;
      for (const m of numeric.matchAll(re)) err('bare-number', { text: m[0].trim() }, u);
    }
    // A slot already renders its natural frequency, so a literal one beside it goes stale (critic m11).
    for (const m of u.text.matchAll(/\{([a-z_][a-z0-9_]*)\}\s*,?\s*\(?about 1 in \d+/g)) err('frequency-literal', { name: m[1] }, u);
    for (const m of u.text.matchAll(/\{([a-z_][a-z0-9_]*)\}\s?%/g)) err('percent-slot', { name: m[1] }, u);

    if (u.role !== 'choice' && u.role !== 'feedback' && u.role !== 'say') {
      let claim = maskPhrases(maskSpans(labelled, u.refutes), [...pinned, ...(words.qualitative_exempt ?? [])]);
      // An explain-chain assert's `say` is the gated clause inside the model answer (P3.2:87).
      if (u.step.kind === 'explain-chain' && u.field === 'model_answer' && Array.isArray(u.step.fields.assert)) {
        for (const a of u.step.fields.assert) if (typeof a?.say === 'string' && a.say) claim = claim.split(a.say).join(' '.repeat(a.say.length));
      }
      // A question a predict or question step asks isn't the lesson's claim ("Which earlier word
      // matters most...?", P2.1:40), and nor is a hypothetical it sets up ("If ' he' barely moves,
      // list two reasons...", P3.4:73). Only sentences ending in "?" or opening with "If" are masked.
      if (u.role === 'prose' && (u.step.kind === 'predict' || u.step.kind === 'question')) {
        claim = claim.replace(/[^.!?\n]*\?|(?<=^|[.!?]\s+)If\b[^.!?\n]*[.!]?/g, (m) => ' '.repeat(m.length));
      }
      for (const q of words.qualitative) if (hits(claim, q).length) err('qualitative', { word: q }, u);
    }
    if (u.role === 'feedback') {
      for (const w of ['wrong', 'correct', 'great job']) if (hits(u.base, w).length) err('verdict-feedback', { word: w }, u);
    }
    const before = bangs;
    bangs += (u.base.match(/!/g) ?? []).length;
    if (before < 2 && bangs >= 2) issues.push(makeIssue('exclamation', {}, where(u)));
    if (isTour) {
      // "what all this means" sends the viewer to Lessons; it doesn't interpret a result (quick-tour.md:50).
      const tour = maskPhrases(labelled, words.tour_banned_exempt ?? []);
      for (const w of words.tour_banned) if (hits(tour, w).length) err('tour-banned', { word: w }, u);
    }
  }

  // Per step: derived slots need their sources beside them; pinned caveats beside results.
  for (const s of lesson.sections) {
    const slots: Record<string, Slot> = { ...(meta.slots ?? {}), ...(s.slots ?? {}) };
    for (const step of allSteps(s.steps)) {
      const texts = stepTexts(step);
      const used = new Set(texts.flatMap((t) => [...t.text.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)].map((m) => m[1])));
      for (const name of used) {
        const slot = slots[name];
        if (!slot?.formula) continue;
        const missing = (slot.from ?? []).filter((f) => !used.has(f));
        if (missing.length) issues.push(makeIssue('derived-sources', { name, missing }, { line: step.line, section: s.index, step: step.id }));
      }
      if (step.kind === 'explain-result' && typeof step.fields.tool === 'string') {
        const phrases = words.pinned_caveats[step.fields.tool] ?? [];
        const joined = texts.map((t) => t.text).join('\n').toLowerCase();
        if (phrases.length && !phrases.some((p) => joined.includes(p.toLowerCase()))) {
          issues.push(makeIssue('caveat-missing', { tool: step.fields.tool, phrase: phrases[0] }, { line: step.line, section: s.index, step: step.id }));
        }
      }
    }
  }
  return issues;
}
