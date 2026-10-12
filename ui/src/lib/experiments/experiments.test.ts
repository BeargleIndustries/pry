import { describe, it, expect, vi } from 'vitest';
import raw from './experiments.json';
import { TutorialState } from '../tutorial/tutorial-store.svelte';
import {
  AGGREGATIONS,
  applyExperiment,
  isHttpUrl,
  loadExperiments,
  resetExperiment,
  tabLabel,
  validateExperiment,
  validateExperiments,
  type Experiment,
  type ExperimentActions,
} from './experiments';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('experiments.json', () => {
  it('is valid against the schema', () => {
    expect(validateExperiments(raw)).toEqual([]);
  });

  it('has 6 to 8 experiments and loads all of them', () => {
    const n = raw.experiments.length;
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(8);
    expect(loadExperiments()).toHaveLength(n);
  });

  it('has unique ids', () => {
    const ids = raw.experiments.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cites at least one http(s) URL in every "what researchers found"', () => {
    for (const e of raw.experiments) {
      expect(e.found.citations.length, e.id).toBeGreaterThan(0);
      for (const c of e.found.citations) expect(isHttpUrl(c.url), `${e.id}: ${c.url}`).toBe(true);
    }
  });

  it('runs the clean prompt of every patching experiment', () => {
    for (const e of loadExperiments()) {
      if (e.patching) expect(e.prompt, e.id).toBe(e.patching.clean);
    }
  });

  it('every experiment has hook, why, prompt, lookFor, found and next.reset/next.try', () => {
    expect(loadExperiments()).toHaveLength(8);
    for (const e of loadExperiments()) {
      for (const s of [e.hook, e.why, e.prompt, e.found.summary, e.next.reset, e.next.try]) {
        expect(typeof s === 'string' && s.trim().length > 0, e.id).toBe(true);
      }
      expect(e.lookFor.length, e.id).toBeGreaterThan(0);
    }
    const noWhy = clone(raw.experiments[0]) as Record<string, unknown>;
    delete noWhy.why;
    expect(validateExperiment(noWhy).join()).toMatch(/why is required/);
    const noNext = clone(raw.experiments[0]) as Record<string, unknown>;
    noNext.next = { reset: 'Back to normal.' };
    expect(validateExperiment(noNext).join()).toMatch(/next needs reset and try/);
  });

  it('next.tryId names an existing experiment', () => {
    const ids = new Set(raw.experiments.map((e) => e.id));
    for (const e of loadExperiments()) {
      if (e.next.tryId) {
        expect(ids.has(e.next.tryId), e.id).toBe(true);
        expect(e.next.tryId, e.id).not.toBe(e.id);
      }
    }
    const data = clone(raw);
    (data.experiments[0] as { next: { tryId?: string } }).next.tryId = 'no-such-experiment';
    expect(validateExperiments(data).join()).toMatch(/no-such-experiment is not an experiment/);
  });

  it('no experiment uses demoLink', () => {
    for (const e of raw.experiments) expect('demoLink' in e, e.id).toBe(false);
    const e = clone(raw.experiments[0]) as Record<string, unknown>;
    e.demoLink = '?demo=induction-heads';
    expect(validateExperiment(e).join()).toMatch(/demoLink/);
  });

  it('tabLabel is defined for every experiment', () => {
    const labels = Object.fromEntries(loadExperiments().map((e) => [e.id, tabLabel(e)]));
    for (const [id, label] of Object.entries(labels)) expect(label.length, id).toBeGreaterThan(0);
    expect(labels['logit-lens']).toBe('Logit Lens');
    expect(labels['he-or-she']).toBe('Why (DLA)');
    expect(labels['features-steering']).toBe('Features');
    expect(labels['ioi-knockout']).toBe('Attention');
  });

  it("rejects the 'mean' aggregation (it only exists in the TO view)", () => {
    expect(AGGREGATIONS).not.toContain('mean');
    const e = clone(raw.experiments[0]) as Record<string, unknown>;
    e.aggregation = 'mean';
    expect(validateExperiment(e).join()).toMatch(/unknown aggregation/);
    e.aggregation = 'max';
    expect(validateExperiment(e)).toEqual([]);
  });
});

describe('resetExperiment', () => {
  it('resetExperiment turns off head ablation and clears the patching preset', () => {
    const page = {
      headAblations: [{ layer: 9, head: 9 }] as { layer: number; head: number }[],
      headAblationMode: true,
      headScoresMode: true,
      patchingPreset: { clean: 'a', corrupted: 'b', patchType: 'head' } as unknown,
      guide: 'ioi-knockout' as string | null,
      prompt: 'my prompt',
    };
    resetExperiment({
      clearHeadAblations: () => { page.headAblations = []; page.headAblationMode = false; },
      hideHeadScores: () => { page.headScoresMode = false; },
      clearPatchingPreset: () => { page.patchingPreset = null; },
      dismissGuide: () => { page.guide = null; },
    });
    expect(page).toEqual({
      headAblations: [],
      headAblationMode: false,
      headScoresMode: false,
      patchingPreset: null,
      guide: null,
      prompt: 'my prompt',
    });
  });
});

describe('validation', () => {
  const good = () => clone(raw.experiments[0]) as Record<string, unknown>;

  it('flags a citation without an http(s) url', () => {
    const e = good();
    (e.found as { citations: { url: string }[] }).citations[0].url = 'arxiv 2211.00593';
    expect(validateExperiment(e).join()).toMatch(/http\(s\) url/);
    (e.found as { citations: { url: string }[] }).citations[0].url = 'javascript:alert(1)';
    expect(validateExperiment(e).join()).toMatch(/http\(s\) url/);
  });

  it('flags a missing citation list', () => {
    const e = good();
    (e.found as { citations: unknown[] }).citations = [];
    expect(validateExperiment(e).join()).toMatch(/at least one citation/);
  });

  it('flags unknown tabs and patch types', () => {
    const e = good();
    e.open = { left: 'nope' };
    (e.patching as { patchType: string }).patchType = 'neuron';
    const errs = validateExperiment(e).join();
    expect(errs).toMatch(/unknown left tab/);
    expect(errs).toMatch(/patchType/);
  });

  it('flags duplicate ids and drops the duplicate on load', () => {
    const data = { experiments: [good(), good()] };
    expect(validateExperiments(data).join()).toMatch(/duplicate id/);
    expect(loadExperiments(data)).toHaveLength(1);
  });

  it('drops invalid entries on load', () => {
    const bad = good();
    delete bad.lookFor;
    expect(loadExperiments({ experiments: [bad] })).toEqual([]);
    expect(loadExperiments(null)).toEqual([]);
  });
});

describe('applyExperiment', () => {
  function mockActions(active: string | null) {
    const calls: string[] = [];
    const a: ExperimentActions = {
      activePresetId: () => active,
      switchModel: vi.fn(async (id: string) => void calls.push(`switch:${id}`)),
      setPrompt: (t) => void calls.push(`prompt:${t}`),
      runGenerate: vi.fn(async () => void calls.push('run')),
      openLeftTab: (t) => void calls.push(`left:${t}`),
      openRightTab: (t) => void calls.push(`right:${t}`),
      setAggregation: (g) => void calls.push(`agg:${g}`),
      presetPatching: (p) => void calls.push(`patch:${p.patchType}`),
      presetHeadAblations: (h) => void calls.push(`ablate:${h.length}`),
      endTour: vi.fn(),
    };
    return { a, calls };
  }

  it('starting an experiment closes the tour', async () => {
    const tour = new TutorialState([
      { id: 'one', title: 'One', summary: '', steps: [{ id: '1a', blurb: '1a', why: null, target: null }] },
    ]);
    tour.start();
    const { a } = mockActions('gpt2-small');
    a.endTour = () => tour.endForExperiment();
    await applyExperiment(byId('logit-lens'), a);
    expect(tour.open).toBe(false);

    // It ends the tour before anything else, even when the model switch then fails.
    tour.start();
    const failed = mockActions('pythia-70m');
    failed.a.endTour = () => tour.endForExperiment();
    expect((await applyExperiment(byId('logit-lens'), failed.a)).ok).toBe(false);
    expect(tour.open).toBe(false);
  });
  const byId = (id: string) => loadExperiments().find((e) => e.id === id) as Experiment;

  it('sets the prompt, runs, then opens tabs (ablations after the run)', async () => {
    const { a, calls } = mockActions('gpt2-small');
    const exp = byId('ioi-knockout');
    await applyExperiment(exp, a);
    expect(calls).toEqual([
      `prompt:${exp.prompt}`,
      'run',
      'ablate:3',
      'right:predictions',
      'left:attention',
    ]);
  });

  it('pre-fills the patching pair', async () => {
    const { a, calls } = mockActions('gpt2-small');
    await applyExperiment(byId('ioi-swap'), a);
    expect(calls).toContain('patch:head');
    expect(calls.at(-1)).toBe('left:patching');
  });

  it('switches model only when a different one is loaded', async () => {
    const other = mockActions('pythia-70m');
    await applyExperiment(byId('logit-lens'), other.a);
    expect(other.calls[0]).toBe('switch:gpt2-small');

    const none = mockActions(null);
    await applyExperiment(byId('logit-lens'), none.a);
    expect(none.a.switchModel).not.toHaveBeenCalled();
    expect(none.a.runGenerate).toHaveBeenCalledOnce();
  });

  it('applyExperiment reports a failed model switch', async () => {
    // The switch "finishes" but the other model is still the loaded one.
    const { a, calls } = mockActions('pythia-70m');
    const result = await applyExperiment(byId('logit-lens'), a);
    expect(result).toEqual({ ok: false, reason: 'model-switch-failed', preset: 'gpt2-small' });
    expect(calls).toEqual(['switch:gpt2-small']);
    expect(a.runGenerate).not.toHaveBeenCalled();
  });

  it('applyExperiment reports success after a switch that worked', async () => {
    let active: string | null = 'pythia-70m';
    const { a } = mockActions(null);
    a.activePresetId = () => active;
    a.switchModel = vi.fn(async (id: string) => { active = id; });
    expect(await applyExperiment(byId('logit-lens'), a)).toEqual({ ok: true });
    expect(a.runGenerate).toHaveBeenCalledOnce();
  });
});
