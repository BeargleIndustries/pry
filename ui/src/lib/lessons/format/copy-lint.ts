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

const NUMBER_RULES: RegExp[] = [
  // 100% is the whole distribution ("probabilities that add up to 100%", P1.4:59), not a measurement.
  /(?<![\w.])(?!100\s?%)\d+(?:\.\d+)?\s?%/g,
  /(?<![\w.])\d+\.\d+(?![\w.])/g,
  /(?<![\w-])L\d+(?:H\d+)?(?![\w])/g,
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
      if (new Set(list.map(familyOf)).size > 1 && !meta.term_budget_exception) {
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
      const named = here < 0 || here > intro || (here === intro && u.section.index > (firstSection.get(term) ?? Infinity));
      if (named) err('retired', { phrase: p }, u);
    }

    if (u.role !== 'choice' && u.role !== 'feedback') {
      const notModel = maskPhrases(refuted, words.model_verb_exempt ?? []);
      for (const v of words.banned_model_verbs) if (hits(notModel, v).length) err('model-verb', { verb: v }, u);
    }
    if (u.step.kind !== 'analogy') {
      for (const p of words.metaphor_names) {
        // The lesson that withdraws a picture names it once to say so (P2.1:49).
        if ([words.metaphor_withdrawn_in?.[p] ?? []].flat().includes(meta.id)) continue;
        if (hits(u.base, p).length) err('metaphor-name', { phrase: p }, u);
      }
    }
    // A choice may be a fixed bin the learner picks ("under 10%", P1.4:34), not a measured number.
    if (u.role !== 'choice') for (const re of NUMBER_RULES) for (const m of labelled.matchAll(re)) err('bare-number', { text: m[0].trim() }, u);
    for (const m of u.text.matchAll(/\{([a-z_][a-z0-9_]*)\}\s?%/g)) err('percent-slot', { name: m[1] }, u);

    // A predict or question stem asks; it isn't the lesson's claim ("Which earlier word matters most", P2.1:40).
    const asks = u.role === 'prose' && (u.step.kind === 'predict' || u.step.kind === 'question');
    if (u.role !== 'choice' && u.role !== 'feedback' && u.role !== 'say' && !asks) {
      const claim = maskPhrases(maskSpans(labelled, u.refutes), [...pinned, ...(words.qualitative_exempt ?? [])]);
      for (const q of words.qualitative) if (hits(claim, q).length) err('qualitative', { word: q }, u);
    }
    if (u.role === 'feedback') {
      for (const w of ['wrong', 'correct', 'great job']) if (hits(u.base, w).length) err('verdict-feedback', { word: w }, u);
    }
    const before = bangs;
    bangs += (u.base.match(/!/g) ?? []).length;
    if (before < 2 && bangs >= 2) issues.push(makeIssue('exclamation', {}, where(u)));
    if (isTour) for (const w of words.tour_banned) if (hits(labelled, w).length) err('tour-banned', { word: w }, u);
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
