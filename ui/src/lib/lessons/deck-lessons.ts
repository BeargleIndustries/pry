// The bundled lessons the loading screen's deck offers (plan T7b: the deck
// reads lesson titles and questions from the loader). A lesson's title is its
// question ("Is there a database in there?"); its summary says what you'll do.
// The quick tour (an overlay) and drafts are left out.

import { bundledSources } from './loader';
import { loadLessonSource } from './format/normalise';
import { parseIndex } from './format/parse';

/** A bundled lesson as the loading screen's deck offers it. */
export interface DeckLesson {
  id: string;
  /** The lesson's title (most are its question). */
  title: string;
  summary: string;
  /** The model the lesson runs on (front matter `model`). */
  model: string | null;
}

export function deckLessons(src: { lessons: Record<string, string>; index?: string } = bundledSources()): DeckLesson[] {
  const order = src.index ? parseIndex(src.index) : [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const out: DeckLesson[] = [];
  for (const [file, text] of Object.entries(src.lessons)) {
    const { lesson } = loadLessonSource(text, { mode: 'lenient', file });
    const m = lesson?.meta;
    if (!m || m.presentation === 'overlay' || m.draft === true) continue;
    out.push({ id: m.id, title: m.title, summary: m.summary ?? '', model: m.model ?? null });
  }
  return out.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
