// Test helpers: build a lesson source from a body and front matter overrides,
// then load and lint it.

import { stringify } from 'yaml';
import { pryToolSet } from '../../registry/pry-set';
import type { ToolActionSet } from '../../registry/contract';
import { copyLint, type CopyLintOptions } from '../copy-lint';
import type { LessonIssue } from '../errors';
import { lintLesson, type LintOptions } from '../lint';
import { loadLessonSource, type NormaliseOptions } from '../normalise';

export const FM = { format: 1, id: 'test.lesson', title: 'A test', tool: 'pry', summary: 'One line.', minutes: 5 };

export function src(body: string, fm: Record<string, unknown> = {}): string {
  return `---\n${stringify({ ...FM, ...fm })}---\n\n${body.replace(/^\n+/, '')}`;
}

export function load(body: string, fm: Record<string, unknown> = {}, opts: NormaliseOptions = {}) {
  return loadLessonSource(src(body, fm), opts);
}

export function lint(
  body: string,
  fm: Record<string, unknown> = {},
  opts: Partial<LintOptions> = {},
  tool: ToolActionSet<any> = pryToolSet,
): LessonIssue[] {
  const { lesson, issues } = loadLessonSource(src(body, fm), { tool });
  if (!lesson) return issues;
  return [...issues, ...lintLesson(lesson, { tool, ...opts })];
}

export function copy(body: string, fm: Record<string, unknown>, opts: CopyLintOptions): LessonIssue[] {
  const { lesson, issues } = loadLessonSource(src(body, fm), { tool: pryToolSet });
  if (!lesson) return issues;
  return copyLint(lesson, opts);
}

/** Error codes only. */
export const errors = (issues: LessonIssue[]) => issues.filter((i) => i.severity === 'error').map((i) => i.code);
export const warnings = (issues: LessonIssue[]) => issues.filter((i) => i.severity === 'warning').map((i) => i.code);
