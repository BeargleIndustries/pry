// Reads src-tauri/capabilities/default.json and pins the Lessons grants
// (plan T1 "Capabilities").
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Entry = string | { identifier: string; allow?: { path: string }[] };
const file = fileURLToPath(new URL('../../../../src-tauri/capabilities/default.json', import.meta.url));
const caps = JSON.parse(readFileSync(file, 'utf-8')) as { permissions: Entry[] };

function scopes(identifier: string): string[] | undefined {
  const e = caps.permissions.find((p) => typeof p !== 'string' && p.identifier === identifier);
  return e && typeof e !== 'string' ? (e.allow ?? []).map((a) => a.path) : undefined;
}

describe('capabilities', () => {
  it('› remove is scoped to $APPDATA/lessons/* only', () => {
    expect(scopes('fs:allow-remove')).toEqual(['$APPDATA/lessons/*']);
    expect(caps.permissions).not.toContain('fs:allow-remove');
  });

  it('› copy-file destination is $APPDATA/lessons/**', () => {
    expect(scopes('fs:allow-copy-file')).toEqual(['$APPDATA/lessons/**']);
    expect(caps.permissions).not.toContain('fs:allow-copy-file');
  });

  it('› window set-size is granted', () => {
    expect(caps.permissions).toContain('core:window:allow-set-size');
    expect(caps.permissions).toContain('core:window:default');
  });

  it('› the grants file can be read back and checked for existence', () => {
    for (const id of ['fs:allow-read-text-file', 'fs:allow-exists']) {
      expect(scopes(id)).toEqual(expect.arrayContaining(['$APPDATA/lesson-grants.json']));
    }
  });

  it('› log, grants and lesson writes are granted', () => {
    for (const id of ['fs:allow-write-text-file', 'fs:allow-write-file']) {
      expect(scopes(id)).toEqual(
        expect.arrayContaining([
          '$APPDATA/lessons/**',
          '$APPDATA/lesson-grants.json',
          '$APPDATA/notebook.v1.json',
          '$APPLOG/lessons.log',
          '$APPLOG/lessons.log.1',
        ]),
      );
    }
  });

  it('› lesson folder reads, watch and mkdir cover the folder and below', () => {
    for (const id of [
      'fs:allow-read-dir',
      'fs:allow-read-text-file',
      'fs:allow-read-file',
      'fs:allow-exists',
      'fs:allow-stat',
      'fs:allow-watch',
      'fs:allow-unwatch',
      'fs:allow-mkdir',
    ]) {
      expect(scopes(id), id).toEqual(expect.arrayContaining(['$APPDATA/lessons', '$APPDATA/lessons/**']));
    }
  });
});
