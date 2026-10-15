import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { errors, load } from './fixtures/helpers';

describe('migrate', () => {
  it('› format 3 says "Update Pry"', () => {
    const r = migrate({ format: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.message).toBe('This lesson uses lesson format 3. Update Pry to open it.');
    const { lesson, issues } = load('## A\n\nHi.\n', { format: 3 });
    expect(lesson).toBeNull();
    expect(issues[0].message).toContain('Update Pry');
  });

  it('passes the current format through unchanged', () => {
    expect(migrate({ format: 1, id: 'a.b' })).toEqual({ ok: true, frontMatter: { format: 1, id: 'a.b' } });
  });

  it('leaves a format below 1 to the schema', () => {
    expect(errors(load('## A\n\nHi.\n', { format: -1 }).issues)).toContain('bad-field');
  });
});
