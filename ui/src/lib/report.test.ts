import { describe, expect, it } from 'vitest';
import { buildEntry, type JournalEntry, type NotebookEntry } from './notebook';
import { fullExtras, fullRun } from './__fixtures__/provenance';
import { buildReport, escapeHtml, reportFileName } from './report';
import type { DLAResponse, GenerateResponse, LogitLensResponse } from './types';
import generateJson from './__fixtures__/readouts/generate.json';
import logitLensJson from './__fixtures__/readouts/logit-lens.json';
import dlaJson from './__fixtures__/readouts/dla.json';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const XSS = '<script>alert(1)</script>';
const CITATION = 'https://arxiv.org/abs/2209.11895';

function entry(over: Partial<NotebookEntry> = {}, response?: GenerateResponse): NotebookEntry {
  const e = buildEntry({
    id: 'abc-123',
    now: new Date('2026-10-11T12:00:00Z'),
    modelName: 'GPT-2 small',
    display: { neuronpedia_model_id: 'gpt2-small', neuronpedia_release_suffix: 'res-jb' },
    experiment: {
      id: 'induction',
      title: 'Copying heads',
      citations: [
        { label: 'In-context learning and induction heads', url: CITATION },
        { label: 'Bad link', url: 'javascript:alert(1)' },
      ],
    },
    run: {
      response: response ?? (clone(generateJson) as GenerateResponse),
      saeLayer: 8,
      activePresetId: 'gpt2-small',
      logitLensResponse: logitLensJson as LogitLensResponse,
      dlaResponse: dlaJson as DLAResponse,
      steerResponse: null,
      headAblateResponse: null,
      featureAblateResponse: null,
      patchResponse: null,
      circuitResponse: null,
    },
  });
  return { ...e, ...over };
}

/** The markup only: every `<...>` tag. Escaped text has no literal `<`, so it is left out. */
function tags(html: string): string {
  return (html.match(/<[^>]*>/g) ?? []).join('\n');
}

/** Every URL-ish reference in the document: src=, href= (in tags), url( and @import (anywhere). */
function references(html: string): string[] {
  const out: string[] = [];
  for (const m of tags(html).matchAll(/\b(?:src|href|action|poster|srcset)\s*=\s*["']?([^"'\s>]+)/gi)) out.push(m[1]);
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)/gi)) out.push(m[1]);
  for (const m of html.matchAll(/@import/gi)) out.push(m[0]);
  return out;
}

function isAllowed(ref: string): boolean {
  if (ref.startsWith('#')) return true;
  if (/^https:\/\/www\.neuronpedia\.org\/[\w.-]+\/\d+-[\w.-]+\/\d+$/.test(ref)) return true;
  return ref === CITATION;
}

describe('buildReport', () => {
  const nasty = (() => {
    const r = clone(generateJson) as GenerateResponse;
    r.prompt = `Hi ${XSS} "quoted" & 'single'`;
    r.tokens[r.tokens.length - 1].text = '<img src=x onerror=alert(1)>';
    if (r.top_predictions?.[0]) r.top_predictions[0].token = '<b>bold</b>';
    return r;
  })();
  const e = entry({ note: `My note ${XSS}`, title: `Title ${XSS}` }, nasty);
  const html = buildReport([e, entry({ id: 'second' })], { generatedAt: new Date('2026-10-11T13:00:00Z') });

  it('is a complete document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<meta charset="utf-8">/);
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<title>[^<]*<\/title>/);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('has no scripts and blocks loads with a CSP', () => {
    expect(html).not.toMatch(/<script/i);
    expect(tags(html)).not.toMatch(/\son\w+\s*=/i);
    expect(html).toMatch(/Content-Security-Policy" content="default-src 'none'/);
  });

  it('has no external URLs except citation and Neuronpedia links', () => {
    const refs = references(html);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((r) => !isAllowed(r))).toEqual([]);
    expect(html).toContain(`href="${CITATION}"`);
    expect(html).toContain('href="https://www.neuronpedia.org/gpt2-small/8-res-jb/');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<(img|link|iframe|object|embed|video|audio)\b/i);
  });

  it('escapes user and model text', () => {
    expect(html).not.toContain(XSS);
    expect(html).toContain('My note &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Title &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &#39;single&#39;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('<b>bold</b>');
  });

  it('includes the plain-language sections', () => {
    const one = buildReport([entry({ note: 'A note' })]);
    expect(one).toContain('<h3>Prompt</h3>');
    expect(one).toContain('<h3>Notes</h3>');
    expect(one).toContain('A note');
    expect(one).toContain('What the model guessed next');
    expect(one).toContain(escapeHtml(e.readouts.dla ?? 'missing'));
    expect(one).toContain('Features on the last word');
    expect(one).toContain('Copying heads');
    // Single entry: no table of contents.
    expect(one).not.toContain('In this report');
    expect(html).toContain('In this report');
    expect(html).toContain('href="#entry-abc-123"');
  });

  it('handles an empty notebook', () => {
    expect(buildReport([])).toContain('no saved runs yet');
  });

  it('names the patching run "Swap test"', () => {
    const withPatch = entry();
    withPatch.run.patchResponse = {
      preset_id: 'gpt2-small',
      clean_prompt: 'John gave a drink to',
      corrupted_prompt: 'Mary gave a drink to',
      patch_type: 'heads',
      target_token_index: 4,
      clean_predicted_token: ' Mary',
      corrupted_predicted_token: ' John',
      components: [
        { name: 'L9 H9', layer: 9, head: 9, effect: 0.8, clean_logit: 0, corrupted_logit: 0, patched_logit: 0 },
      ],
      timing_ms: {},
    };
    const out = buildReport([withPatch]);
    expect(out).toContain('Swap test (heads)');
    expect(out).not.toContain('Swap &amp; Compare');
  });
});

describe('How this was run', () => {
  const full = buildEntry({
    id: 'full',
    now: new Date('2026-10-11T12:00:00Z'),
    modelName: 'GPT-2 small',
    display: null,
    run: fullRun(),
    provenance: { ...fullExtras(), compare: { a: 'A <b>', b: 'B' } },
  });

  it('lists every recorded setting of the run', () => {
    const out = buildReport([full]);
    expect(out).toContain('<h3>How this was run</h3>');
    for (const text of [
      'Pry version</th><td>0.4.0',
      'Engine version</th><td>0.4.0',
      'Device</th><td>cuda',
      'PyTorch</th><td>2.5.1+cu124',
      'CUDA</th><td>12.4',
      'TransformerLens</th><td>2.15.4',
      'SAELens</th><td>6.5.1',
      'transformers</th><td>4.46.3',
      'Model</th><td>gpt2-small',
      'Model revision</th><td>607a30d783dfa663caf39e06633721c8d4cfcd7e',
      'SAE</th><td>gpt2-small-res-jb / blocks.8.hook_resid_pre, layer 8',
      'Temperature</th><td>0.7',
      'Seed</th><td>42',
      'Heads knocked out</th><td>9.9',
      'Features knocked out</th><td>#1234',
      'feature #1234 at strength 8, layer 8, with a control feature; also tried on: I went to the',
      'Why (DLA) target',
      'patching head',
      'Key parts threshold</th><td>0.05',
    ]) {
      expect(out).toContain(text);
    }
    // Compare prompts are user text: escaped.
    expect(out).toContain('&quot;A &lt;b&gt;&quot;');
  });

  it('is left out for a run migrated from v1, which has no provenance', () => {
    expect(buildReport([entry({ provenance: null })])).not.toContain('How this was run');
  });
});

describe('Your predictions and what happened', () => {
  const base = buildEntry({
    id: 'r', now: new Date('2026-10-11T12:00:00Z'), modelName: 'GPT-2 small', display: null, run: fullRun(),
  });
  const step = (over: Partial<JournalEntry>): JournalEntry => ({
    id: 'j',
    at: '2026-10-11T12:00:00.000Z',
    lesson: { id: 'pry.p3-2', version: '1', source: 'bundled' },
    sectionId: 's1',
    stepId: 'guess',
    kind: 'predict',
    question: 'Which name comes next?',
    answer: { choice: ' Mary' },
    skipped: false,
    committedAt: '2026-10-11T12:00:00.000Z',
    provenance: base.provenance!,
    ...over,
  });

  it('shows each prediction, the check Pry ran and what it measured', () => {
    const out = buildReport([base], {
      journal: [
        step({
          id: 'a',
          check: { read: 'top_guess.prob', op: 'gt', binding: 'answer', expected: 0.5, actual: 0.62, agrees: true },
        }),
        step({ id: 'b', stepId: 'second', question: `Guess <i>again</i>`, skipped: true, answer: {} }),
        step({ id: 'c', kind: 'recall', question: 'Not a prediction' }),
      ],
    });
    expect(out).toContain('<h2>Your predictions and what happened</h2>');
    expect(out).toContain('pry.p3-2, step guess');
    expect(out).toContain('You said</span>  Mary');
    expect(out).toContain('top_guess.prob gt 0.5');
    expect(out).toContain('<code>0.62</code> (matches your answer)');
    expect(out).toContain('You said</span> skipped');
    expect(out).toContain('Guess &lt;i&gt;again&lt;/i&gt;');
    expect(out).not.toContain('Not a prediction');
    expect(tags(out)).not.toMatch(/<script/i);
  });

  it('is left out when there are no predictions', () => {
    expect(buildReport([base])).not.toContain('Your predictions and what happened');
    expect(buildReport([base], { journal: [step({ kind: 'recall' })] })).not.toContain('Your predictions');
  });
});

describe('escapeHtml / reportFileName', () => {
  it('escapes the five HTML specials', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('names .html files', () => {
    expect(reportFileName(new Date('2026-10-11T12:00:00Z'))).toBe('pry-report-2026-10-11T12-00-00-000Z.html');
  });
});
