import { beforeEach, describe, expect, it } from 'vitest';
import { TutorialState } from './tutorial-store.svelte';
import type { TourChapter } from './tour-steps';
import { TOUR_PROGRESS_KEY, TOUR_SEEN_KEY } from './tour-progress';

function step(id: string) {
  return { id, blurb: id, why: null, target: null };
}

const chapters: TourChapter[] = [
  { id: 'one', title: 'One', summary: '', steps: [step('1a'), step('1b')] },
  { id: 'two', title: 'Two', summary: '', steps: [step('2a')] },
  { id: 'three', title: 'Three', summary: '', steps: [step('3a'), step('3b')] },
];

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

let storage: MemoryStorage;
const saved = () => JSON.parse(storage.getItem(TOUR_PROGRESS_KEY) ?? 'null');

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});

describe('TutorialState', () => {
  it('starts at the first step and saves its place as it goes', () => {
    const t = new TutorialState(chapters);
    t.start();
    expect(t.open).toBe(true);
    expect(t.currentStep?.id).toBe('1a');
    expect(t.isFirst).toBe(true);
    t.next();
    expect(saved()).toMatchObject({ chapterId: 'one', step: 1, completed: [] });
  });

  it('marks a chapter completed when leaving its last step', () => {
    const t = new TutorialState(chapters);
    t.start();
    t.next();
    t.next();
    expect(t.currentChapter?.id).toBe('two');
    expect(t.isCompleted('one')).toBe(true);
    expect(saved().completed).toEqual(['one']);
  });

  it('Back crosses into the previous chapter', () => {
    const t = new TutorialState(chapters);
    t.goToChapter(2);
    t.back();
    expect(t.currentStep?.id).toBe('2a');
    t.back();
    expect(t.currentStep?.id).toBe('1b');
  });

  it('jumps to a chapter, opening the tour if needed', () => {
    const t = new TutorialState(chapters);
    t.goToChapter(1);
    expect(t.open).toBe(true);
    expect(t.currentStep?.id).toBe('2a');
    t.goToChapter(99);
    expect(t.currentStep?.id).toBe('2a');
  });

  it('closing keeps the place, and resume returns to it', () => {
    const t = new TutorialState(chapters);
    t.goToChapter(2);
    t.next();
    t.close();
    expect(t.open).toBe(false);

    const later = new TutorialState(chapters);
    later.refresh();
    expect(later.resumeAt).toEqual({ chapter: 2, step: 1 });
    later.resume();
    expect(later.currentStep?.id).toBe('3b');
  });

  it('resume with nothing saved starts at the beginning', () => {
    const t = new TutorialState(chapters);
    t.resume();
    expect(t.currentStep?.id).toBe('1a');
  });

  it('finishing completes the last chapter and leaves nothing to resume', () => {
    const t = new TutorialState(chapters);
    t.goToChapter(2);
    t.next();
    expect(t.isFinal).toBe(true);
    t.finish();
    expect(t.open).toBe(false);
    expect(t.resumeAt).toBeNull();
    expect(t.isCompleted('three')).toBe(true);
    expect(saved().chapterId).toBeNull();
    // A close after finishing doesn't bring the old place back.
    t.close();
    expect(saved().chapterId).toBeNull();
  });

  it('restart clears progress and the seen flag, then starts over', () => {
    storage.setItem(TOUR_SEEN_KEY, 'true');
    const t = new TutorialState(chapters);
    t.goToChapter(2);
    t.next();
    t.restart();
    expect(storage.getItem(TOUR_SEEN_KEY)).toBeNull();
    expect(t.currentStep?.id).toBe('1a');
    expect(t.progress.completed).toEqual([]);
    expect(t.resumeAt).toBeNull();
  });

  it('resetProgress forgets everything without opening the tour', () => {
    const t = new TutorialState(chapters);
    t.goToChapter(1);
    t.next();
    t.close();
    t.resetProgress();
    expect(t.open).toBe(false);
    expect(storage.getItem(TOUR_PROGRESS_KEY)).toBeNull();
    t.refresh();
    expect(t.resumeAt).toBeNull();
    expect(t.progress.completed).toEqual([]);
  });

  it('asks for an attention view with a fresh request each time, cleared on close', () => {
    const t = new TutorialState(chapters);
    t.start();
    t.requestAttentionView('lines');
    const first = t.attentionRequest;
    t.requestAttentionView('lines');
    expect(t.attentionRequest).not.toBe(first);
    expect(t.attentionRequest).toEqual({ view: 'lines' });
    t.close();
    expect(t.attentionRequest).toBeNull();
  });
});
