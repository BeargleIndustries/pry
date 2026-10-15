import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionsDocPath, buildActionsDoc, buildSchemas, schemaDir, serialise } from '../../../scripts/lessons-schema';

const uiDir = fileURLToPath(new URL('../../..', import.meta.url));

describe('lessons-schema', () => {
  it('› all four schema files are up to date', () => {
    const schemas = buildSchemas();
    // The plan's four, plus the composed Pry front matter the template's schema line points at.
    expect(Object.keys(schemas).sort()).toEqual([
      'front-matter.v1.schema.json',
      'lesson.v1.schema.json',
      'pry-baseline.v1.schema.json',
      'pry-enter.v1.schema.json',
      'pry-front-matter.v1.schema.json',
    ]);
    for (const [name, schema] of Object.entries(schemas)) {
      const onDisk = readFileSync(join(schemaDir(uiDir), name), 'utf8').replace(/\r\n/g, '\n');
      expect(onDisk, `${name} is stale: run npm run lessons:schema`).toBe(serialise(schema));
    }
  });

  it('ACTIONS.md is up to date with the registry docs', () => {
    const onDisk = readFileSync(actionsDocPath(uiDir), 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk, 'ACTIONS.md is stale: run npm run lessons:schema').toBe(buildActionsDoc());
    expect(onDisk).toContain('| `set_prompt` | view |');
  });
});
