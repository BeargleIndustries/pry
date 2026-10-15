import { describe, expect, it } from 'vitest';
import { entryFromParams, INDUCTION_LESSON_ID } from './entry';

const at = (q: string) => entryFromParams(new URLSearchParams(q));

describe('demo params', () => {
  it('› induction-heads opens pry.p2-2; tour and tutorial=1 start the quick tour', () => {
    expect(INDUCTION_LESSON_ID).toBe('pry.p2-2');
    expect(at('demo=induction-heads')).toEqual({ kind: 'lesson', id: 'pry.p2-2' });
    expect(at('demo=tour')).toEqual({ kind: 'tour' });
    expect(at('tutorial=1')).toEqual({ kind: 'tour' });
  });

  it('opens Lessons for the welcome screen, and nothing for anything else', () => {
    expect(at('lessons=open')).toEqual({ kind: 'lessons' });
    expect(at('')).toBeNull();
    expect(at('demo=other')).toBeNull();
    expect(at('tutorial=0')).toBeNull();
    // The popup audit's ?lessons=right is not an entry point.
    expect(at('lessons=right')).toBeNull();
  });
});
