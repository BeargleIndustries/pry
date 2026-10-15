// Emits the lesson format's JSON Schemas (plan "Format versioning story", plan:150):
//   front-matter.v1       generic front matter (`baseline` is {})
//   lesson.v1             a compiled lesson (what `lessons:compile` prints; `baseline` and `:::enter` are {})
//   pry-baseline.v1       Pry's `baseline`
//   pry-enter.v1          Pry's `:::enter` overlay plus the generic `reset`
//   pry-front-matter.v1   front matter with Pry's baseline composed in (the template's schema line)
//
//   npm run lessons:schema            writes docs/lessons/schema/*.json and docs/lessons/ACTIONS.md (run from ui/)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { pryToolSet } from '../src/lib/lessons/registry/pry-set';
import { frontMatter, slots, STEP_KINDS, stepSchemas } from '../src/lib/lessons/format/schema';

export const SCHEMA_BASE = 'https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/';

type Json = Record<string, unknown>;

const json = (schema: z.ZodType): Json => {
  const out = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Json;
  delete out.$schema;
  return out;
};

function withId(name: string, title: string, body: Json): Json {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `${SCHEMA_BASE}${name}`, title, ...body };
}

function frontMatterWith(baseline: Json): Json {
  const fm = json(frontMatter);
  (fm.properties as Json).baseline = baseline;
  return fm;
}

function lessonSchema(): Json {
  const inline = { type: 'object', properties: { type: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['type', 'start', 'end'] };
  const prose = { type: 'object', properties: { text: { type: 'string' }, line: { type: 'integer' }, inline: { type: 'array', items: inline } }, required: ['text', 'line', 'inline'] };
  const action = { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' }, line: { type: 'integer' } }, required: ['name', 'args', 'line'] };
  const defs: Json = { prose, action };
  for (const kind of STEP_KINDS) defs[`fields-${kind}`] = json(stepSchemas[kind]);
  defs.step = {
    type: 'object',
    properties: {
      kind: { enum: [...STEP_KINDS] },
      id: { type: 'string' },
      line: { type: 'integer' },
      fields: { type: 'object' },
      prose: { type: 'array', items: { $ref: '#/$defs/prose' } },
      actions: { type: 'array', items: { $ref: '#/$defs/action' } },
      children: { type: 'array', items: { $ref: '#/$defs/step' } },
      implicit: { type: 'boolean' },
    },
    required: ['kind', 'line', 'fields', 'prose', 'actions', 'children'],
    allOf: STEP_KINDS.map((kind) => ({
      if: { properties: { kind: { const: kind } } },
      then: { properties: { fields: { $ref: `#/$defs/fields-${kind}` } } },
    })),
  };
  defs.section = {
    type: 'object',
    properties: {
      index: { type: 'integer' },
      id: { type: 'string' },
      title: { type: 'string' },
      depth: { enum: ['core', 'optional'] },
      line: { type: 'integer' },
      outline: { type: 'string' },
      enter: { type: 'object', properties: { value: {}, line: { type: 'integer' } } },
      slots: json(slots),
      slotsLine: { type: 'integer' },
      steps: { type: 'array', items: { $ref: '#/$defs/step' } },
    },
    required: ['index', 'id', 'title', 'depth', 'line', 'steps'],
  };
  return {
    type: 'object',
    properties: {
      file: { type: 'string' },
      meta: frontMatterWith({}),
      sections: { type: 'array', items: { $ref: '#/$defs/section' } },
      authorNotes: { type: 'array', items: { type: 'string' } },
    },
    required: ['meta', 'sections', 'authorNotes'],
    $defs: defs,
  };
}

/** Every schema file by name. */
export function buildSchemas(): Record<string, Json> {
  const pryBaseline = json(pryToolSet.baselineSchema);
  const pryEnter = json(pryToolSet.overlaySchema);
  const enter = { allOf: [pryEnter, { type: 'object', properties: { reset: { const: true } } }] };
  return {
    'front-matter.v1.schema.json': withId('front-matter.v1.schema.json', 'Lesson front matter, format 1', frontMatterWith({})),
    'lesson.v1.schema.json': withId('lesson.v1.schema.json', 'Compiled lesson, format 1', lessonSchema()),
    'pry-baseline.v1.schema.json': withId('pry-baseline.v1.schema.json', 'Pry lesson baseline, format 1', pryBaseline),
    'pry-enter.v1.schema.json': withId('pry-enter.v1.schema.json', 'Pry section enter overlay, format 1', enter),
    'pry-front-matter.v1.schema.json': withId('pry-front-matter.v1.schema.json', 'Pry lesson front matter, format 1', frontMatterWith(pryBaseline)),
  };
}

export const serialise = (s: Json) => `${JSON.stringify(s, null, 2)}\n`;

/** A JSON Schema as a short type, e.g. `{ text: string, occurrence?: "first" | "last" | integer }`. */
function shape(s: any): string {
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0) return 'any';
  if (s.anyOf) return s.anyOf.map(shape).join(' | ');
  if (s.oneOf) return s.oneOf.map(shape).join(' | ');
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((e: unknown) => JSON.stringify(e)).join(' | ');
  if (s.type === 'array') return `${shape(s.items)}[]`;
  if (s.type === 'object') {
    const props = Object.entries(s.properties ?? {});
    if (!props.length) return s.additionalProperties && s.additionalProperties !== false ? `{ [key]: ${shape(s.additionalProperties)} }` : '{}';
    const req = new Set(s.required ?? []);
    return `{ ${props.map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${shape(v)}`).join(', ')} }`;
  }
  return String(s.type ?? 'any');
}

const argsOf = (schema?: z.ZodType) => (schema ? `\`${shape(json(schema))}\`` : '');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** docs/lessons/ACTIONS.md, generated from the registry docs. */
export function buildActionsDoc(): string {
  const t = pryToolSet;
  const aliasOf = (rec: Record<string, object>, name: string) => Object.keys(rec).find((k) => k !== name && rec[k] === rec[name] && Object.keys(rec).indexOf(k) < Object.keys(rec).indexOf(name));
  const out: string[] = [
    '# Pry lesson actions, readouts and anchors',
    '',
    'Generated from the registry by `npm run lessons:schema`. Do not edit by hand.',
    '',
    '## Actions',
    '',
    'Effects: `view` and `compute` run freely and replay when a section opens; `download`, `network` and `external` need a `permissions` entry and run only when the learner presses "Do it".',
    '',
    '| Action | Effect | Arguments | What it does |',
    '|---|---|---|---|',
  ];
  for (const [name, a] of Object.entries(t.actions)) {
    const alias = aliasOf(t.actions, name);
    out.push(`| \`${name}\` | ${a.effect}${a.stateful ? ', stateful' : ''} | ${cell(argsOf(a.args))} | ${cell(alias ? `Same as \`${alias}\`. ${a.doc}` : a.doc)} |`);
  }
  out.push('', '## Readouts', '', '| Readout | Type | Arguments | What it reads |', '|---|---|---|---|');
  for (const [name, r] of Object.entries(t.readouts)) {
    out.push(`| \`${name}\` | ${r.type}${r.unit ? ` (${r.unit})` : ''} | ${cell(argsOf(r.args))} | ${cell(r.doc)} |`);
  }
  out.push('', '## Anchors', '', '| Anchor | Arguments | Hideable | What it is |', '|---|---|---|---|');
  for (const [name, a] of Object.entries(t.anchors)) {
    out.push(`| \`${name}\` | ${cell(argsOf(a.args))} | ${a.hide ? 'yes' : ''} | ${cell(a.doc)} |`);
  }
  out.push('', '## Views', '', '| View | Arguments | What it shows |', '|---|---|---|');
  for (const [name, v] of Object.entries(t.views)) out.push(`| \`${name}\` | ${cell(argsOf(v.args))} | ${cell(v.doc)} |`);
  out.push('', '## Pickers', '', '| Picker | What the learner does |', '|---|---|');
  for (const [name, p] of Object.entries(t.pickers)) out.push(`| \`${name}\` | ${cell(p.doc)} |`);
  out.push(
    '',
    '## Services',
    '',
    'The names a lesson lists under `permissions.network`. A `network` action needs the service it uses listed there.',
    '',
    '| Service | Host | Actions that use it | What it is |',
    '|---|---|---|---|',
  );
  for (const [name, sv] of Object.entries(t.services)) {
    const users = Object.entries(t.actions)
      .filter(([n, a]) => {
        if (a.effect !== 'network' || aliasOf(t.actions, n)) return false;
        try {
          return (a.scope ? a.scope({}) : n) === name;
        } catch {
          return false;
        }
      })
      .map(([n]) => `\`${n}\``);
    out.push(`| \`${name}\` | ${sv.host} | ${users.join(', ')} | ${cell(sv.doc)} |`);
  }
  out.push('', '## Models', '', t.models.map((m) => `\`${m}\``).join(', '), '');
  return out.join('\n');
}

export function actionsDocPath(uiDir: string): string {
  return resolve(uiDir, '../docs/lessons/ACTIONS.md');
}

export function schemaDir(uiDir: string): string {
  return resolve(uiDir, '../docs/lessons/schema');
}

if (!process.env.VITEST) {
  const dir = schemaDir(process.cwd());
  mkdirSync(dir, { recursive: true });
  for (const [name, schema] of Object.entries(buildSchemas())) {
    writeFileSync(join(dir, name), serialise(schema));
    console.log(`wrote ${join(dir, name)}`);
  }
  writeFileSync(actionsDocPath(process.cwd()), buildActionsDoc());
  console.log(`wrote ${actionsDocPath(process.cwd())}`);
}
