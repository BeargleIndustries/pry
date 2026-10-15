// Ways into the quick tour and Lessons from the page URL (plan T7b "Entry
// points"). `?tutorial=1` and `?demo=tour` start the quick tour,
// `?demo=induction-heads` opens the copying-heads lesson, `?lessons=open`
// opens Lessons (the welcome screen's "Open Lessons").

import { QUICK_TOUR_ID } from './progress';

/** The lesson `?demo=induction-heads` opens: catching a copying head. */
export const INDUCTION_LESSON_ID = 'pry.p2-2';

export type PageEntry = { kind: 'tour' } | { kind: 'lesson'; id: string } | { kind: 'lessons' };

export function entryFromParams(params: URLSearchParams): PageEntry | null {
  const demo = params.get('demo');
  if (demo === 'induction-heads') return { kind: 'lesson', id: INDUCTION_LESSON_ID };
  if (demo === 'tour' || params.get('tutorial') === '1') return { kind: 'tour' };
  if (params.get('lessons') === 'open') return { kind: 'lessons' };
  return null;
}

export { QUICK_TOUR_ID };
