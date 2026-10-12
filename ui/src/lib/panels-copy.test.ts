// Lane-local closure rows for T4c (pry-clarity 2026-10-12): panels, readouts,
// glossary, errors. They overlap the shared copy-closure test, which checks
// visible strings only; these check `mustNotContain` against the whole file
// with comments stripped.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(['/src/lib/components/*.svelte', '/src/lib/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function file(name: string): string {
  const key = Object.keys(sources).find((k) => k.endsWith('/' + name));
  if (!key) throw new Error(`no source file ${name}`);
  return sources[key];
}

/** File text without HTML, block and line comments (a rough stand-in for the visible-string extractor). */
function withoutComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

interface Row {
  id: string;
  file: string;
  mustContain?: string[];
  mustNotContain?: string[];
}

const rows: Row[] = [
  { id: 'copy:R4', file: 'DLAPanel.svelte', mustContain: ['explainingLabel('], mustNotContain: ['Target token', '(pos '] },
  { id: 'copy:R4 label', file: 'readouts.ts', mustContain: ['Explaining the guess after'] },
  { id: 'copy:R6', file: 'readouts.ts', mustContain: ['nothing comes after it'] },
  {
    id: 'copy:C1',
    file: 'PatchingPanel.svelte',
    mustContain: ['Swap test', 'Blue squares bring the original answer back', 'raised the score for', '<Term key="patching">'],
    mustNotContain: ['Activation Patching', 'Causal importance', 'Brightness = patching effect magnitude', 'Run Patching'],
  },
  { id: 'copy:C2', file: 'SteeringPanel.svelte', mustContain: ['Turn one concept up or down'] },
  { id: 'copy:C3', file: 'PanelB.svelte', mustContain: ['signedHex'], mustNotContain: ['class:text-red-400={d.delta', 'class:text-emerald-400={d.delta'] },
  { id: 'copy:C4 PanelA', file: 'PanelA.svelte', mustContain: [' pts'] },
  { id: 'copy:C4 PanelB', file: 'PanelB.svelte', mustContain: [' pts'] },
  { id: 'copy:C5', file: 'SteeringPanel.svelte', mustContain: ['turn the text to mush'], mustNotContain: ['degenerate'] },
  { id: 'copy:C6', file: 'CircuitPanel.svelte', mustContain: ['fills in on its own'] },
  { id: 'copy:C7', file: 'CircuitPanel.svelte', mustContain: ["'bg-fuchsia-900/40 text-fuchsia-300'"], mustNotContain: ['bg-amber-950 text-amber-400'] },
  {
    id: 'copy:C8 / copy:P9 heading',
    file: 'PredictionsPanel.svelte',
    mustContain: ['Next-word guesses (top 10)', "the model's chance for each"],
    mustNotContain: ['Top-k'],
  },
  { id: 'copy:C9', file: 'DLAPanel.svelte', mustContain: ["Help through other parts isn't counted", 'Why ('], mustNotContain: ['Direct Logit Attribution'] },
  { id: 'copy:C10 DLA', file: 'DLAPanel.svelte', mustContain: ['Press Run again.'], mustNotContain: ['No component attributions'] },
  { id: 'copy:C10 Predictions', file: 'PredictionsPanel.svelte', mustContain: ['Press Run again.'] },
  { id: 'copy:C10 Circuit', file: 'CircuitPanel.svelte', mustContain: ['Lower it and press Find key parts'] },
  { id: 'copy:C10 PanelB', file: 'PanelB.svelte', mustContain: ['concepts inside'], mustNotContain: ['SAE features'] },
  { id: 'copy:C11', file: 'PanelA.svelte', mustContain: ['Type at least two words'] },
  { id: 'copy:C11 last word', file: 'attention-agg.ts', mustContain: ['Nothing comes after the last word, so no later word looks back at it. Pick an earlier word.', 'Not defined for the first word'] },
  { id: 'copy:C11 last word PanelA', file: 'PanelA.svelte', mustContain: ['undefinedCellMessage(focusMode)', "undefinedCellMessage('to')"], mustNotContain: ['NOT_DEFINED_MSG'] },
  { id: 'copy:C12', file: 'PanelA.svelte', mustContain: [' layers, '], mustNotContain: ['L · '] },
  { id: 'copy:C13', file: 'PanelA.svelte', mustContain: ['the word doing the looking'], mustNotContain: ['query tokens'] },
  {
    id: 'copy:C14',
    file: 'PanelA.svelte',
    mustContain: ['Layer {tooltipLayer}, head {tooltipHead}', 'score'],
    mustNotContain: ['L{tooltipLayer} H{tooltipHead}'],
  },
  { id: 'copy:C15', file: 'PanelA.svelte', mustContain: ['Score by'], mustNotContain: ['>Agg<', 'the Agg question'] },
  { id: 'copy:C15 option', file: 'attention-agg.ts', mustNotContain: ["label: 'Strongest' }"] },
  { id: 'copy:C16', file: 'LogitLensPanel.svelte', mustContain: ['fills in on its own'] },
  { id: 'copy:C17', file: 'LogitLensPanel.svelte', mustContain: ['matches the final answer'], mustNotContain: ['!= final', '= final<'] },
  { id: 'copy:C18', file: 'SteeringPanel.svelte', mustContain: ['strength'], mustNotContain: ['alpha=', '(act:'] },
  {
    id: 'copy:C19',
    file: 'CircuitPanel.svelte',
    mustContain: ['Bigger shape, bigger push', 'Direct push'],
    mustNotContain: ['Node size =', 'Importance:', 'Nodes:'],
  },
  { id: 'copy:C20', file: 'NoFeaturesNotice.svelte', mustContain: ["Features don't work with this model."], mustNotContain: ['Swap &amp; Compare'] },
  { id: 'copy:C21', file: 'ModelSwitcher.svelte', mustContain: ['No models fit this computer yet.'], mustNotContain: ['presets'] },
  { id: 'copy:C22', file: 'ComparePanel.svelte', mustContain: ['Press Run both again.'], mustNotContain: ['Run Compare again'] },
  { id: 'copy:C23', file: 'errors.ts', mustContain: ['Press Retry'] },
  { id: 'copy:G3', file: 'glossary.ts', mustContain: ['leaves out help'] },
  { id: 'copy:G4', file: 'glossary.ts', mustContain: ['randomness'] },
  { id: 'crit:F14 DLA', file: 'DLAPanel.svelte', mustNotContain: ['Attention Layer'] },
  { id: 'crit:F14 Patching', file: 'PatchingPanel.svelte', mustNotContain: ['L{l}.H{h}'] },
  { id: 'rename: Swap test', file: 'glossary.ts', mustNotContain: ['swap & compare'] },
];

// Honesty caveats this lane owns (Principle 4). Exact phrases; only the Critic or the user may change them.
const caveats: Row[] = [
  { id: 'cav:dla-direct (panel)', file: 'DLAPanel.svelte', mustContain: ["Help through other parts isn't counted"] },
  { id: 'cav:dla-direct (readout)', file: 'readouts.ts', mustContain: ['most directly'] },
  { id: 'cav:edges-direct-value-path', file: 'CircuitPanel.svelte', mustContain: ['direct value path'] },
  { id: 'cav:compare-correlation', file: 'compare.ts', mustContain: ['On their own they don’t show what causes the model’s answer.'] },
  { id: 'cav:feature-labels (readout)', file: 'readouts.ts', mustContain: ['Labels are best guesses from Neuronpedia, not certainties.'] },
  { id: 'cav:feature-labels-steering', file: 'SteeringPanel.svelte', mustContain: ['Labels are written by an AI and can be wrong'] },
  { id: 'cav:neuronpedia', file: 'concept-search.ts', mustContain: ['Searching sends the words you type to Neuronpedia'] },
  { id: 'cav:logit-lens-early (panel)', file: 'LogitLensPanel.svelte', mustContain: ['Early layers are a rough read'] },
  { id: 'cav:logit-lens-early (readout)', file: 'readouts.ts', mustContain: ['a hint, not proof'] },
];

describe('T4c closure rows', () => {
  it.each([...rows, ...caveats])('$id ($file)', (row) => {
    const src = file(row.file);
    for (const s of row.mustContain ?? []) expect(src, `${row.file} must contain ${JSON.stringify(s)}`).toContain(s);
    const visible = withoutComments(src);
    for (const s of row.mustNotContain ?? []) {
      expect(visible, `${row.file} must not show ${JSON.stringify(s)}`).not.toContain(s);
    }
  });

  it('crit:F14: Swap test head cells are titled "L{l} H{h}: ... score change"', () => {
    const titles = [...file('PatchingPanel.svelte').matchAll(/title="(L\{l\}[^"]*)"/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t).toMatch(/^L\{l\} H\{h\}: .*score change/);
  });

  it('Gemma note shows only while real_weights_verified is false', () => {
    const note = 'On Gemma these numbers are still being checked against the real model.';
    for (const name of ['DLAPanel.svelte', 'CircuitPanel.svelte']) {
      const src = file(name);
      const at = src.indexOf(note);
      expect(at, name).toBeGreaterThan(0);
      const guard = src.lastIndexOf('{#if !realWeightsVerified(response)}', at);
      expect(guard, `${name}: note is inside the realWeightsVerified guard`).toBeGreaterThan(0);
      expect(src.slice(guard, at)).not.toContain('{/if}');
    }
  });

  it('code:A4: Key parts shows "Explaining the guess after" from targetLabel', () => {
    const src = file('CircuitPanel.svelte');
    expect(src).toContain('explainingLabel(targetLabel)');
    expect(src).not.toContain('TODO(pry-clarity T4c)');
  });

  it('copy:G1: each panel attaches a Term to its first jargon word', () => {
    const expected: Record<string, string> = {
      'DLAPanel.svelte': 'dla',
      'PatchingPanel.svelte': 'patching',
      'CircuitPanel.svelte': 'circuit',
      'PanelA.svelte': 'attention',
      'PanelB.svelte': 'feature',
      'FeatureCard.svelte': 'activation',
      'SteeringPanel.svelte': 'steering',
    };
    for (const [name, key] of Object.entries(expected)) {
      expect(file(name), name).toContain(`<Term key="${key}"`);
    }
  });

  it('copy:C24 (T4c files): no em dash in visible copy', () => {
    const names = [
      'DLAPanel.svelte', 'PatchingPanel.svelte', 'CircuitPanel.svelte', 'LogitLensPanel.svelte', 'PanelA.svelte',
      'PanelB.svelte', 'FeatureCard.svelte', 'SteeringPanel.svelte', 'PredictionsPanel.svelte', 'ComparePanel.svelte',
      'WatchItWrite.svelte', 'NoFeaturesNotice.svelte', 'ModelSwitcher.svelte', 'readouts.ts', 'glossary.ts', 'errors.ts',
    ];
    for (const name of names) expect(withoutComments(file(name)), name).not.toContain('—');
  });
});
