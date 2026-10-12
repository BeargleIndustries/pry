import { describe, it, expect, vi } from 'vitest';
import raw from './experiments.json';
import {
  applyExperiment,
  isHttpUrl,
  loadExperiments,
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
    };
    return { a, calls };
  }
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
