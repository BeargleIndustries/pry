import { describe, expect, it } from 'vitest';
import { lintLesson } from './lint';
import { errors, load, src } from './fixtures/helpers';
import { fixtureTool } from './fixtures/tool';
import { loadLessonSource } from './normalise';

const F = '```';

function lenient(body: string, fm: Record<string, unknown> = {}) {
  const { lesson, issues } = loadLessonSource(src(body, { tool: 'fixture', ...fm }), { mode: 'lenient', tool: fixtureTool });
  return { lesson, issues: lesson ? [...issues, ...lintLesson(lesson, { tool: fixtureTool })] : issues };
}

describe('schema', () => {
  it('› id with .. or / is a schema error', () => {
    for (const id of ['pry..x', 'my/lesson', '../etc.passwd', 'a.b/c']) {
      expect(errors(load('## A\n\nHi.\n', { id }).issues), id).toContain('bad-id');
    }
    expect(errors(load('## A\n\nHi.\n', { id: 'my.lesson-1' }).issues)).toEqual([]);
    expect(errors(load('## A\n\nHi.\n', { id: `a.${'b'.repeat(70)}` }).issues)).toContain('bad-id');
  });

  it('› id _template is an error', () => {
    expect(errors(load('## A\n\nHi.\n', { id: '_template' }).issues)).toContain('bad-id');
    expect(errors(load('## A\n\nHi.\n', { id: '_template.x' }).issues)).toContain('bad-id');
  });

  it('› strict errors on unknown keys', () => {
    const fm = load('## A\n\nHi.\n', { colour: 'red' }, { mode: 'strict' });
    expect(fm.issues.find((i) => i.code === 'unknown-key')?.message).toContain('`colour`');
    const step = load(`## A\n\n:::explain{id=e}\n${F}yaml\nmood: calm\n${F}\n:::\n`, {}, { mode: 'strict' });
    expect(errors(step.issues)).toContain('unknown-key');
  });

  it('› lenient drops unknown keys only on presentational objects', () => {
    const body = `## A\n\n:::explain{id=e mood=calm}\nHi.\n:::\n\n:::analogy{id=a}\n${F}yaml\nlike: x\nbecause: y\nbreaks: z\nflavour: sweet\n${F}\n:::\n`;
    const { lesson, issues } = lenient(body, { colour: 'red' });
    expect(errors(issues)).toEqual([]);
    expect(lesson!.authorNotes.join(' ')).toMatch(/colour/);
    expect(lesson!.authorNotes.join(' ')).toMatch(/mood/);
    expect(lesson!.authorNotes.join(' ')).toMatch(/flavour/);
    expect(lesson!.sections[0].steps[0].fields.mood).toBeUndefined();
    // Not presentational: a predict keeps its unknown key as an error.
    const p = lenient(`## A\n\n:::predict{id=p checks=o mood=calm}\nQ?\n\n${F}yaml\nfree: true\n${F}\n:::\n\n:::observe{id=o}\n${F}yaml\njournal: true\n${F}\n:::\n`);
    expect(errors(p.issues)).toContain('unknown-key');
  });

  it('› unknown key under check/slots/assert/actions/enter/predict/task/permissions/baseline is an error in lenient mode', () => {
    const cases: [string, string, Record<string, unknown>?][] = [
      ['check', `## A\n\n:::observe{id=o}\n${F}yaml\ncheck: { read: score, op: gt, value: 0.1, expect: 0.2, extra: 1 }\n${F}\n:::\n`],
      ['slots', `## A\n\n:::slots\nx: { read: score, expect: 1, extra: 1 }\n:::\n\nHi.\n`],
      ['assert', `## A\n\n:::explain{id=e}\n${F}yaml\nassert: [{ require: { slot: x, op: gt, value: 1, extra: 1 }, say: a, else: b }]\n${F}\n:::\n`],
      ['actions', `## A\n\n:::do{id=d}\nGo.\n\n${F}actions\n- run: { extra: 1 }\n${F}\n:::\n`],
      ['enter', `## A\n\n:::enter\nprompt: "x"\nextra: 1\n:::\n\nHi.\n`],
      ['predict', `## A\n\n:::predict{id=p checks=o}\nQ?\n\n${F}yaml\nfree: true\nextra: 1\n${F}\n:::\n\n:::observe{id=o}\n${F}yaml\njournal: true\n${F}\n:::\n`],
      ['task', `## A\n\n:::task{id=t}\n${F}yaml\ntarget: [{ read: score, op: gt, value: $read.score }]\nextra: 1\n${F}\n:::\n`],
      ['permissions', `## A\n\nHi.\n`, { permissions: { network: ['catalog'], extra: ['x'] } }],
      ['baseline', `## A\n\nHi.\n`, { baseline: { prompt: 'x', extra: 1 } }],
    ];
    for (const [name, body, fm] of cases) {
      const { issues } = lenient(body, fm);
      // Action arguments are checked against the action's own schema, so they report as bad-args.
      const want = name === 'actions' ? 'bad-args' : 'unknown-key';
      const hit = issues.find((i) => i.severity === 'error' && i.code === want);
      expect(hit?.message, `${name}: ${errors(issues)}`).toMatch(/extra/);
    }
  });

  it('› baseline and enter validated by the tool\'s schemas', () => {
    const bad = loadLessonSource(src('## A\n\n:::enter\nprompt: 3\n:::\n\nHi.\n', { tool: 'fixture', baseline: { prompt: 7 } }), { tool: fixtureTool });
    const msgs = bad.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/baseline/);
    expect(msgs).toMatch(/:::enter/);
    const good = loadLessonSource(src('## A\n\n:::enter\nprompt: "x"\nreset: true\n:::\n\nHi.\n', { tool: 'fixture', baseline: { prompt: 'x' } }), { tool: fixtureTool });
    expect(errors(good.issues)).toEqual([]);
  });
});
