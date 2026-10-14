import { describe, expect, it } from 'vitest';
import { formatIssue, makeIssue, MESSAGES, nearest, TOP_TEN } from './errors';
import { errors, lint } from './fixtures/helpers';

describe('errors', () => {
  it('formats as "Section N, step `id`, line L: <plain sentence>"', () => {
    const i = makeIssue('analogy-breaks', {}, { section: 2, step: 'a1', line: 40 });
    expect(formatIssue(i)).toBe('Section 2, step `a1`, line 40: This analogy needs a `breaks` line that says where the comparison stops being true.');
    expect(formatIssue({ ...i, file: 'my.lesson/lesson.md' })).toMatch(/^my\.lesson\/lesson\.md:40: Section 2, step `a1`, line 40: /);
    expect(formatIssue(makeIssue('draft', {}, { line: 1 }, 'warning'))).toBe('warning: line 1: This lesson is marked `draft: true`.');
  });

  it('has custom wording for the top ten mistakes', () => {
    expect(TOP_TEN).toHaveLength(10);
    for (const code of TOP_TEN) {
      const msg = MESSAGES[code]({ name: 'x', key: 'k', where: 'w', detail: 'd', missing: ['supports'] });
      expect(msg, code).toMatch(/[.?]$/);
      expect(msg, code).not.toContain('—');
    }
  });

  it('every message is a plain sentence without em dashes', () => {
    for (const [code, fn] of Object.entries(MESSAGES)) {
      const msg = fn({ name: 'x', key: 'k', where: 'in w', detail: 'd', missing: ['a'], terms: ['a', 'b'], chain: ['a', 'b'], ops: ['gt'], tools: ['dla'], models: ['m'] });
      expect(msg, code).not.toContain('—');
      expect(msg.length, code).toBeGreaterThan(5);
    }
  });

  it('lint issues carry section, step and line', () => {
    const issues = lint('## A\n\n## B\n\n:::analogy{id=a2}\n```yaml\nlike: x\nbecause: y\n```\n:::\n');
    expect(errors(issues)).toEqual(['analogy-breaks']);
    expect(issues[0]).toMatchObject({ section: 2, step: 'a2', line: 14 });
  });

  it('suggests the nearest name', () => {
    expect(nearest('set_promt', ['set_prompt', 'run'])).toBe('set_prompt');
    expect(nearest('zzzzzz', ['set_prompt', 'run'])).toBeUndefined();
  });
});
