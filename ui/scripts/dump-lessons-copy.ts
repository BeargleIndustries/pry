// Prints every learner-visible string in lessons/copy.ts (functions filled with
// sample values) for the brad-voice lint: npx vite-node scripts/dump-lessons-copy.ts
import { lessonsCopy } from '../src/lib/lessons/copy';

const sample: Record<string, unknown[]> = {
  minutes: [8],
  greyed: ['lessons/my.lesson/lesson.md:12', 'The prompt is missing.'],
  stepId: ['run-it'],
  pointerHidden: ['the Why (DLA) chart, left side'],
  picked: ['L9H9'],
  modelBanner: ['GPT-2 small'],
  switchTo: ['GPT-2 small'],
  modelCaveat: ['GPT-2 small', '" Paris"'],
  stepFailed: ['the engine stopped'],
  differsPrediction: ['" Paris"'],
  differsLesson: ['42% (about 3 in 7)'],
  agreesRun: ['b'],
  differsRun: ['b', '" the cat sat"'],
  differsBefore: ['12.50'],
  differsEarlier: ['" Mary"'],
  differsOther: ['10'],
  lastTime: ['The app agrees with your prediction.'],
  runsLeft: [2],
  noRunsLeft: [4],
  constraintFails: ['how many heads are knocked out'],
  needsOk: [1],
  checkProblems: [2],
  expectBeside: ['0.42'],
  installBy: ['Sam'],
  permDownload: ['gpt2-medium'],
  permNetwork: ['neuronpedia.org'],
  permExternal: ['arxiv.org'],
  permCost: ['a paid model'],
};

const lines: string[] = ['# T3 learner-visible strings (ui/src/lib/lessons/copy.ts, sample values filled in)', ''];
for (const [k, v] of Object.entries(lessonsCopy)) {
  const s = typeof v === 'function' ? (v as (...a: unknown[]) => string)(...(sample[k] ?? ['X'])) : String(v);
  lines.push(s, '');
}
console.log(lines.join('\n'));
