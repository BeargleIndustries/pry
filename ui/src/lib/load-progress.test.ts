import { describe, it, expect } from 'vitest';
import type { LoadProgress } from './sidecar';
import {
  applyEvent,
  formatElapsed,
  formatEta,
  historyFromTrack,
  historyKey,
  initialPlan,
  mappedFraction,
  parseHistory,
  readHistory,
  recordEvent,
  reduceLoad,
  stageNote,
  stageSteps,
  startLoad,
  viewAt,
  writeHistory,
  type LoadTrack,
  type TimingHistory,
} from './load-progress';

const ev = (stage: string, extra: Partial<LoadProgress> = {}): LoadProgress => ({
  stage,
  message: extra.message ?? `${stage}…`,
  progress: extra.progress ?? 0,
  ...extra,
});

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}

/** Sample the bar every `step` ms from `from` to `to`, returning fractions. */
function sample(t: LoadTrack, from: number, to: number, step = 250): number[] {
  const out: number[] = [];
  for (let now = from; now <= to; now += step) out.push(mappedFraction(t, now));
  return out;
}

function isNonDecreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-12);
}

// Gemma-like cold load: 30 s warmup, 0.5 s check, 14 s weights, 0.4 s SAE.
const GEMMA: TimingHistory = {
  v: 1,
  stages: { warmup: 30, check_files: 0.5, load_model: 14, to_device: 2, load_sae: 0.4 },
};

describe('history storage', () => {
  it('round-trips through storage under a per-preset key', () => {
    const s = memStorage();
    writeHistory('gemma-2-2b', GEMMA, s);
    expect(s.map.has(historyKey('gemma-2-2b'))).toBe(true);
    expect(readHistory('gemma-2-2b', s)).toEqual(GEMMA);
    expect(readHistory('gpt2-small', s)).toBeNull();
  });

  it('survives storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readHistory('x', bad)).toBeNull();
    expect(() => writeHistory('x', GEMMA, bad)).not.toThrow();
    expect(readHistory('x', null)).toBeNull();
  });

  it('rejects junk', () => {
    expect(parseHistory('not json')).toBeNull();
    expect(parseHistory('{"v":2,"stages":{"a":1}}')).toBeNull();
    expect(parseHistory('{"v":1,"stages":{"a":"x","b":-1}}')).toBeNull();
    expect(parseHistory('{"v":1,"stages":{"a":1,"b":"x"}}')).toEqual({ v: 1, stages: { a: 1 } });
  });
});

describe('plan', () => {
  it('without history expects every regular stage, but no downloads or unload', () => {
    expect(initialPlan(null)).toEqual(['warmup', 'check_files', 'load_model', 'to_device', 'load_sae']);
  });

  it('with history expects what happened last time', () => {
    expect(initialPlan({ v: 1, stages: { check_files: 1, load_model: 3, load_sae: 1 } })).toEqual([
      'check_files',
      'load_model',
      'load_sae',
    ]);
  });

  it('drops skipped stages and adds unplanned ones in order', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('check_files'), 100); // warmup skipped (engine already warm)
    t = applyEvent(t, ev('download_model', { bytes_done: 0, bytes_total: 100 }), 200);
    expect(t.plan).toEqual(['check_files', 'download_model', 'load_model', 'to_device', 'load_sae']);
    t = applyEvent(t, ev('load_model'), 300);
    t = applyEvent(t, ev('load_sae'), 400); // to_device skipped (CPU)
    expect(t.plan).toEqual(['check_files', 'download_model', 'load_model', 'load_sae']);
  });

  it('tolerates unknown stage names', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('warmup'), 0);
    t = applyEvent(t, ev('mystery_step'), 1000);
    expect(t.current).toBe('mystery_step');
    expect(t.plan[0]).toBe('warmup');
    expect(t.plan).toContain('mystery_step');
    expect(mappedFraction(t, 2000)).toBeGreaterThan(0);
  });
});

describe('bar without history', () => {
  it('keeps moving during a long stage but never fills the stage share', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('warmup'), 0);
    const xs = sample(t, 0, 120_000, 1000);
    expect(isNonDecreasing(xs)).toBe(true);
    // still moving after a minute
    expect(mappedFraction(t, 60_000)).toBeGreaterThan(mappedFraction(t, 50_000));
    // warmup's share (20 of 39 default seconds) is never reached
    const share = 20 / (20 + 1 + 12 + 3 + 3);
    expect(Math.max(...xs)).toBeLessThan(share);
  });

  it('has no time estimate, and says nothing it cannot back up', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('load_model'), 0);
    const v = viewAt(t, 5000);
    expect(v.etaSeconds).toBeNull();
    expect(v.hasHistory).toBe(false);
    expect(v.overEstimate).toBe(false);
  });
});

describe('bar with history', () => {
  it('fills a stage on schedule, up to (not past) its share', () => {
    let t = startLoad('gemma', 0, GEMMA);
    t = applyEvent(t, ev('warmup'), 0);
    const total = 30 + 0.5 + 14 + 2 + 0.4;
    const share = 30 / total;
    expect(mappedFraction(t, 15_000)).toBeCloseTo(0.45 * share, 5);
    expect(mappedFraction(t, 30_000)).toBeCloseTo(0.9 * share, 5);
    expect(mappedFraction(t, 300_000)).toBeLessThan(share);
  });

  it('estimates time left and counts down smoothly', () => {
    let t = startLoad('gemma', 0, GEMMA);
    t = applyEvent(t, ev('warmup'), 0);
    expect(viewAt(t, 10_000).etaSeconds).toBeCloseTo(20 + 0.5 + 14 + 2 + 0.4, 5);
    expect(viewAt(t, 20_000).etaSeconds).toBeCloseTo(10 + 16.9, 5);
  });

  it('admits when a stage runs long instead of inventing a number', () => {
    let t = startLoad('gemma', 0, GEMMA);
    t = applyEvent(t, ev('warmup'), 0);
    const v = viewAt(t, 45_000);
    expect(v.etaSeconds).toBeNull();
    expect(v.overEstimate).toBe(true);
    expect(stageNote(t, v)).toMatch(/busy with something else/);
  });

  it('jumps forward when a stage ends early and never goes back', () => {
    let t = startLoad('gemma', 0, GEMMA);
    t = applyEvent(t, ev('warmup'), 0);
    const before = mappedFraction(t, 5000);
    t = applyEvent(t, ev('check_files'), 5000); // warm engine: imports were quick
    expect(mappedFraction(t, 5000)).toBeGreaterThanOrEqual(before);
  });
});

describe('monotonic across a whole load', () => {
  it('never moves backwards through skips, downloads and heartbeats', () => {
    let t = startLoad('gemma', 0, GEMMA);
    const xs: number[] = [];
    const run = (from: number, to: number) => xs.push(...sample(t, from, to, 200));
    t = applyEvent(t, ev('warmup', { elapsed_s: 0 }), 0);
    run(0, 50_000); // much slower than last time
    t = applyEvent(t, ev('check_files'), 50_000);
    run(50_000, 51_000);
    // an unplanned download appears; its weight could shrink earlier shares
    t = applyEvent(t, ev('download_model', { bytes_done: 0, bytes_total: 1000 }), 51_000);
    for (let i = 1; i <= 10; i++) {
      run(51_000 + (i - 1) * 1000, 51_000 + i * 1000);
      t = applyEvent(t, ev('download_model', { bytes_done: i * 100, bytes_total: 1000 }), 51_000 + i * 1000);
    }
    t = applyEvent(t, ev('load_model', { elapsed_s: 0 }), 61_000);
    for (let i = 1; i <= 20; i++) {
      t = applyEvent(t, ev('load_model', { elapsed_s: i }), 61_000 + i * 1000);
      run(61_000 + (i - 1) * 1000, 61_000 + i * 1000);
    }
    t = applyEvent(t, ev('load_sae'), 81_000); // to_device skipped
    run(81_000, 82_000);
    expect(isNonDecreasing(xs)).toBe(true);
    expect(Math.max(...xs)).toBeLessThan(1);
    t = applyEvent(t, ev('ready'), 82_000);
    expect(mappedFraction(t, 82_000)).toBe(1);
  });
});

describe('heartbeats', () => {
  it('trust the engine clock when it says the stage started earlier', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('warmup'), 5000); // first event arrives late
    t = applyEvent(t, ev('warmup', { elapsed_s: 8 }), 8000);
    expect(viewAt(t, 8000).stageElapsed).toBeCloseTo(8, 5);
  });

  it('carry download bytes (new and old field names)', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('download_model', { bytes_done: 10, bytes_total: 100 }), 0);
    expect(t.bytes).toEqual({ done: 10, total: 100 });
    t = applyEvent(t, ev('download_model', { bytes_downloaded: 50, bytes_total: 100 }), 1000);
    expect(t.bytes).toEqual({ done: 50, total: 100 });
  });
});

describe('finishing', () => {
  it('remembers stage times on ready, without downloads or unload', () => {
    const s = memStorage();
    let t = startLoad('gemma', 0, null);
    t = recordEvent(t, ev('unload'), 0, s);
    t = recordEvent(t, ev('warmup'), 1000, s);
    t = recordEvent(t, ev('check_files'), 31_000, s);
    t = recordEvent(t, ev('download_sae', { bytes_done: 1, bytes_total: 2 }), 31_500, s);
    t = recordEvent(t, ev('load_model'), 40_000, s);
    t = recordEvent(t, ev('load_sae'), 54_000, s);
    expect(s.map.size).toBe(0);
    t = recordEvent(t, ev('ready'), 54_400, s);
    expect(readHistory('gemma', s)).toEqual({
      v: 1,
      stages: { warmup: 30, check_files: 0.5, load_model: 14, load_sae: 0.4 },
    });
  });

  it('does not overwrite history on already_loaded', () => {
    const s = memStorage();
    let t = startLoad('p', 0, null);
    t = recordEvent(t, ev('already_loaded'), 10, s);
    expect(t.done).toBe(true);
    expect(s.map.size).toBe(0);
  });

  it('marks errors failed and ignores events after', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('warmup'), 0);
    t = applyEvent(t, ev('error', { message: 'boom' }), 10);
    expect(t.failed).toBe(true);
    expect(applyEvent(t, ev('ready'), 20)).toBe(t);
    expect(historyFromTrack(t)).toBeNull();
  });
});

describe('reducer', () => {
  it('starts and applies events', () => {
    let t = reduceLoad(null, { type: 'start', presetId: 'p', now: 0, history: null });
    t = reduceLoad(t, { type: 'event', ev: ev('warmup'), now: 0 });
    expect(t?.current).toBe('warmup');
    expect(reduceLoad(null, { type: 'event', ev: ev('warmup'), now: 0 })).toBeNull();
  });
});

describe('stage steps', () => {
  it('marks done, current and next', () => {
    let t = startLoad('p', 0, null);
    t = applyEvent(t, ev('warmup'), 0);
    t = applyEvent(t, ev('check_files'), 12_000);
    const steps = stageSteps(t);
    expect(steps.map((s) => s.status)).toEqual(['done', 'current', 'next', 'next', 'next']);
    expect(steps[0].seconds).toBe(12);
    expect(steps[0].label).toBe('Starting the math libraries');
  });
});

describe('formatting', () => {
  it('formats time left in plain, rounded words', () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(2)).toBe('a few seconds left');
    expect(formatEta(12)).toBe('about 10 s left');
    expect(formatEta(43)).toBe('about 45 s left');
    expect(formatEta(130)).toBe('about 2 min left');
  });

  it('formats elapsed time as m:ss', () => {
    expect(formatElapsed(7.9)).toBe('0:07');
    expect(formatElapsed(92)).toBe('1:32');
    expect(formatElapsed(-1)).toBe('0:00');
  });
});
