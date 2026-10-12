import { describe, expect, it } from 'vitest';
import { occupied } from './occupied.svelte';

describe('occupied', () => {
  it('measures registered sources on demand and forgets them on unregister', () => {
    let r = { left: 0, top: 0, width: 10, height: 10 };
    const off = occupied.register('a', () => r);
    const offB = occupied.register('b', () => null);
    expect(occupied.rects()).toEqual([r]);
    r = { left: 5, top: 5, width: 10, height: 10 };
    expect(occupied.rects()).toEqual([r]); // never stale
    expect(occupied.rects(['a'])).toEqual([]);
    off();
    offB();
    expect(occupied.rects()).toEqual([]);
  });

  it('an old unregister does not remove a newer registration under the same id', () => {
    const off1 = occupied.register('x', () => ({ left: 0, top: 0, width: 1, height: 1 }));
    const off2 = occupied.register('x', () => ({ left: 2, top: 2, width: 1, height: 1 }));
    off1();
    expect(occupied.entries().map(([id]) => id)).toEqual(['x']);
    off2();
    expect(occupied.entries()).toEqual([]);
  });
});
