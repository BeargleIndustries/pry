// Lesson errors (plan T1 "Errors"): "Section N, step `id`, line L: <plain sentence>".
// Every message the format, lint and copy lint print is worded here, so the
// wording lives in one place. TOP_TEN are the mistakes authors make most; they
// get custom wording that says what to do next.

export type Severity = 'error' | 'warning';

export interface Where {
  line?: number;
  /** 1-based section number; 0 = front matter or before the first section. */
  section?: number;
  step?: string;
  file?: string;
}

export interface LessonIssue extends Where {
  severity: Severity;
  code: string;
  message: string;
}

type D = Record<string, any>;

const quoteList = (xs: string[]) => xs.map((x) => `\`${x}\``).join(', ');
const hint = (h?: string) => (h ? ` Did you mean \`${h}\`?` : '');

/** The ten mistakes authors make most, each with wording that says what to do. */
export const TOP_TEN = [
  'unknown-action',
  'bad-args',
  'unknown-readout',
  'unknown-key',
  'missing-blank-line',
  'predict-no-observe',
  'explain-result-fields',
  'analogy-breaks',
  'earlier-no-fallback',
  'seed-missing',
] as const;

export const MESSAGES: Record<string, (d: D) => string> = {
  // The top ten.
  'unknown-action': (d) => `There's no action called \`${d.name}\`.${hint(d.hint)} ACTIONS.md lists every action.`,
  'bad-args': (d) => `The action \`${d.name}\` can't take these arguments: ${d.detail}. ACTIONS.md shows what it takes.`,
  'unknown-readout': (d) => `There's no readout called \`${d.name}\`.${hint(d.hint)} ACTIONS.md lists every readout.`,
  'unknown-key': (d) => `\`${d.key}\` isn't a field ${d.where}. Check the spelling, or remove it.`,
  'missing-blank-line': () => 'Put a blank line before each `:::` line and after each closing `:::`, or the step runs into its neighbour.',
  'predict-no-observe': () => "This predict step has nothing to check it. Add an observe step and point to it with `checks=<observe id>`.",
  'explain-result-fields': (d) => `An explain-result needs both \`supports\` and \`leaves_open\`. This one is missing ${quoteList(d.missing)}.`,
  'analogy-breaks': () => "This analogy needs a `breaks` line that says where the comparison stops being true.",
  'earlier-no-fallback': (d) => `\`$earlier.${d.key}\` needs a \`fallback:\` value for learners who skipped that step or haven't done that lesson.`,
  'seed-missing': (d) => `\`${d.name}\` runs above temperature 0, so give it a \`seed\`. Without one, going back to this section can't repeat the same text.`,

  // Parsing and schema.
  'yaml-syntax': (d) => `The YAML ${d.where} doesn't parse: ${d.detail}`,
  'front-matter-missing': () => 'The lesson needs front matter between `---` lines at the very top.',
  'bad-field': (d) => `${d.where}: ${d.detail}`,
  'format-too-new': (d) => `This lesson uses lesson format ${d.n}. Update Pry to open it.`,
  'raw-html': () => "Raw HTML isn't allowed in a lesson. Use Markdown, or a step kind.",
  mdx: () => "MDX and JSX aren't allowed in a lesson. Use Markdown, or a step kind.",
  'unknown-step': (d) => `There's no step kind called \`${d.kind}\`.${hint(d.hint)}`,
  'step-nesting': (d) => `A \`${d.kind}\` step can't sit inside ${d.parent}.`,
  'bad-id': (d) => `The lesson id \`${d.id}\` doesn't fit the rule: lower-case letters, digits and dashes in at least two parts joined by dots, 64 characters at most, never starting with \`_\`.`,
  'before-section': () => 'Everything after the front matter belongs in a `##` section. Start one above this line.',
  'duplicate-block': (d) => `This section has two \`:::${d.name}\` blocks. Merge them into one.`,
  'duplicate-key': (d) => `\`${d.key}\` is set twice on this step, once in the attributes and once in the YAML.`,

  // Structural lint.
  'unknown-anchor': (d) => `There's no anchor called \`${d.name}\`.${hint(d.hint)}`,
  'bad-anchor-args': (d) => `The anchor \`${d.name}\` can't take these arguments: ${d.detail}.`,
  'unknown-view': (d) => `There's no view called \`${d.name}\`.${hint(d.hint)}`,
  'bad-view-args': (d) => `The view \`${d.name}\` can't take these arguments: ${d.detail}.`,
  'unknown-picker': (d) => `There's no picker called \`${d.name}\`.${hint(d.hint)}`,
  'bad-readout-args': (d) => `The readout \`${d.name}\` can't take these arguments: ${d.detail}.`,
  'op-type': (d) => `\`${d.op}\` doesn't work on \`${d.read}\`, which is a ${d.type}. Use one of ${quoteList(d.ops)}.`,
  'prose-check': (d) => `\`${d.read}\` is a sentence for hints, so it can't be checked.`,
  'transfer-no-predict': () => 'A transfer step needs its own predict step, so the learner commits before trying it.',
  'skeptic-missing': () => "In Stage 2 or 3, an explain-result needs a `skeptic:` with what a skeptic would say and the check to run.",
  'analogy-two': () => 'This section already has an analogy on the main path. Keep one per section, or move one into a `fold`.',
  'simplification-unknown': (d) => `\`corrected_in\` names \`${d.id}\`, which isn't a known lesson.`,
  'recall-unknown': (d) => `\`from\` names \`${d.id}\`, which isn't a known lesson.`,
  'earlier-undeclared': (d) => `No step writes the key \`${d.key}\`. Add \`remember: ${d.key}\` to the predict, question or task that records it.`,
  'capture-unknown': (d) => `\`${d.name}\` isn't captured by any earlier do step. Add \`capture: ${d.name}\` to the do step that runs it.`,
  'when-no-sibling': () => 'A step with `when` needs a sibling step in the same section with the same condition and the opposite `not`, so the learner always sees one of them.',
  'skip-check-unknown': (d) => `\`skip_check\` names the ${d.what} \`${d.name}\`, which this lesson doesn't have.`,
  'tool-missing': () => 'This explain-result follows a tool run, so it needs `tool:` naming the tool, for its pinned caveat.',
  'tool-unknown': (d) => `\`tool: ${d.tool}\` isn't one of ${quoteList(d.tools)}.`,
  'row-unknown': (d) => `\`$row.${d.id}\` isn't a row in verified-rows.yaml.`,
  'fresh-missing': () => 'This do step repeats an earlier one with the same actions. Add `fresh: true` so pressing "Do it" calls the sidecar again.',
  'gated-readout': (d) => `This section reads \`${d.name}\`, which only a do step that downloads or goes online produces, and those don't replay. Add a do step to this section.`,
  'expect-missing': (d) => `${d.what} needs an \`expect\` value from rows.json.`,
  'expect-pending': () => '`expect: pending` is only allowed while drafting a skeleton (`--skeleton`).',
  'expect-learner': (d) => `\`expect: learner\` only fits a readout the learner produces (a task, a picker, or a do step bound by \`$earlier\`), and \`${d.name}\` comes from a fixed run.`,
  'duplicate-id': (d) => `The step id \`${d.id}\` is used twice in this lesson.`,
  'prereq-cycle': (d) => `These lessons list each other as prerequisites in a loop: ${d.chain.join(' -> ')}.`,
  'tool-min': (d) => `This lesson needs ${d.tool} ${d.need} or later, and this is ${d.have}.`,
  'image-alt': () => 'An image needs `alt` text describing it.',
  'image-not-local': (d) => `The image \`${d.src}\` must be a file inside the lesson folder.`,
  'image-too-big': (d) => `The image \`${d.src}\` is over 1 MB.`,
  'image-missing': (d) => `The image \`${d.src}\` isn't in the lesson folder.`,
  'expect-no-model': () => 'This lesson has expected values, so it needs a `model:` they were recorded on.',
  'model-unknown': (d) => `\`model: ${d.model}\` isn't one of ${quoteList(d.models)}.`,
  'targets-untagged': (d) => `\`targets\` lists \`${d.target}\`, and no predict choice is tagged with it.`,
  'permission-missing': (d) => `\`${d.name}\` needs \`permissions: { ${d.effect}: [${d.scope}] }\` in the front matter.`,
  'link-host': (d) => `The link goes to ${d.host}, which isn't listed in \`permissions.external\`.`,
  'link-scheme': (d) => `Links must start with http:// or https://. This one uses \`${d.scheme}\`.`,
  'id-prefix': (d) => `Ids starting with \`${d.prefix}\` belong to the app's own lessons. Pick another first part.`,
  'unrecorded-prompt': (d) => `The prompt "${d.prompt}" has no recorded response in rows.json or expectations.json.`,
  'slot-unknown': (d) => `There's no slot called \`{${d.name}}\`. Declare it under \`slots:\`.`,
  'slot-before-readout': (d) => `\`{${d.name}}\` shows before the step that produces its value, so it would read "(appears after you run it)".`,
  'spine-unknown': (d) => `\`${d.name}\` isn't a box on the spine strip.`,
  'step-unknown': (d) => `\`${d.name}\` isn't a step id in this lesson.`,
  draft: () => 'This lesson is marked `draft: true`.',
  'permission-unused': (d) => `\`permissions.${d.effect}\` lists \`${d.scope}\`, and no action uses it.`,
  'long-section': (d) => `This section has ${d.words} words and nothing for the learner to do. Split it, or add a step.`,
  'no-baseline-prompt': () => 'This lesson runs the model and its `baseline` sets no prompt.',

  // Overlay (tour) lint.
  'overlay-step': (d) => `A tour step can only hold explain steps, and this one has a \`${d.kind}\` step.`,
  'overlay-enter': (d) => `A tour step's \`enter\` can only open a panel (\`open_panel\`), and this one sets \`${d.key}\`.`,
  'overlay-sections': (d) => `A tour has at most 12 steps, and this one has ${d.n}.`,

  // Copy lint.
  'term-early': (d) => `"${d.term}" is introduced in ${d.lesson}, later on the path. Describe it in plain words here, or move it into a fold.`,
  'term-budget-section': (d) => `This section introduces ${d.terms.length} new terms (${d.terms.join(', ')}). Keep it to one per section.`,
  'term-budget-lesson': (d) => `This lesson introduces ${d.n} new terms. Keep it to three, or set \`term_budget_exception\` with the decision that allows more.`,
  retired: (d) => `"${d.phrase}" is a retired phrase. The style guide's tables say what to use.`,
  'model-verb': (d) => `"${d.verb}" describes the model like a person. Say what the numbers do, such as "gives X a higher probability".`,
  'metaphor-name': (d) => `"${d.phrase}" is a metaphor, so it can only sit in an analogy block, never stand in as a name.`,
  'bare-number': (d) => `"${d.text}" is a number in the prose. Put it in a slot bound to a readout, or a row constant, so it matches the screen.`,
  'percent-slot': (d) => `\`{${d.name}}%\` writes a percentage without "about 1 in N". Write \`{${d.name}}\`; the slot adds it.`,
  'derived-sources': (d) => `\`{${d.name}}\` is worked out from ${quoteList(d.missing)}, so show those in the same step.`,
  qualitative: (d) => `"${d.word}" makes a claim about size. Put it in an assert's \`say\` line, with an \`else\` for when the numbers don't back it.`,
  exclamation: () => 'A lesson gets one exclamation mark at most.',
  'verdict-feedback': (d) => `Feedback says "${d.word}". Say what happened and why, without a verdict.`,
  'caveat-missing': (d) => `Results from ${d.tool} need the pinned caveat beside them, with the words "${d.phrase}".`,
  'tour-banned': (d) => `The tour points at controls and makes no claims, so "${d.word}" can't appear in it.`,
  'tour-term': (d) => `"${d.term}" is a term from Lessons. In the tour it can only appear inside a quoted UI label.`,
};

export function makeIssue(code: string, data: D = {}, where: Where = {}, severity: Severity = 'error'): LessonIssue {
  const msg = MESSAGES[code];
  return { severity, code, message: msg ? msg(data) : code, ...where };
}

/** "Section N, step `id`, line L: <plain sentence>", with the file first when known. */
export function formatIssue(i: LessonIssue): string {
  const parts: string[] = [];
  if (i.section) parts.push(`Section ${i.section}`);
  if (i.step) parts.push(`step \`${i.step}\``);
  if (i.line) parts.push(`line ${i.line}`);
  const head = parts.join(', ');
  const body = head ? `${head}: ${i.message}` : i.message;
  const sev = i.severity === 'warning' ? 'warning: ' : '';
  return i.file ? `${i.file}${i.line ? `:${i.line}` : ''}: ${sev}${body}` : `${sev}${body}`;
}

/** The closest name in `names` to `name` (edit distance), for "Did you mean" hints. */
export function nearest(name: string, names: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const n of names) {
    const d = distance(name, n);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(name.length / 2)) ? best : undefined;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export const hasErrors =(issues: LessonIssue[]) => issues.some((i) => i.severity === 'error');
