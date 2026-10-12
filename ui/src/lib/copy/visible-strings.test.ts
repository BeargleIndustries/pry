import { describe, expect, it } from 'vitest';
import { visibleFromCode, visibleFromJson, visibleFromSvelte, visibleHits, visibleStrings } from './visible-strings';

const svelteFixture = `<script lang="ts">
  import { probeHardware } from '$lib/hardware-probe';
  // diagnostic: probe the GPU before showing anything
  /* runtime diagnostic block */
  let diagnosticPath = $state('logs/diagnostic.txt');
  let error = $state<string | null>(null);
  async function run() {
    try {
      await probeHardware();
    } catch {
      error = "Couldn't check your graphics card. Pry will use the CPU.";
    }
  }
</script>

<!-- diagnostic heatmap comment -->
<div data-tip="x-heatmap" data-tour="panel-a-heatmap" class="flex gap-2 text-sm">
  <h2 title="Check your graphics card">Checking your computer</h2>
  <p>{error ?? 'Looking for a graphics card'}</p>
  <button aria-label="Copy error details" onclick={() => navigator.clipboard.writeText(diagnosticPath)}>Copy</button>
  <input placeholder="Type a prompt" bind:value={diagnosticPath} />
  <p>Layer {tooltipLayer}, head {tooltipHead}: score change</p>
  <span class={on ? 'text-blue-600 font-medium' : 'text-slate-500'}>Swap &amp; test</span>
  {#if diagnosticPath}<span>Setup log</span>{/if}
</div>

<style>
  .heatmap { color: red; }
</style>
`;

const tsFixture = `import { probeHardware } from './probe';
// diagnostic: not visible
export const tips = [
  {
    id: 'panel-a-heatmap',
    target: '[data-tip="panel-a-heatmap"]',
    title: 'Attention',
    blurb: "Couldn't check your graphics card",
    why: \`Brighter cells mean \${n} more attention.\`,
    placement: 'right',
  },
];
const re = /heatmap's "quote"/g;
export function readout(word: string): string {
  return \`For the last word, \${word} wins.\`;
}
probeHardware('diagnosticPath');
`;

describe('visible-strings extractor', () => {
  it('copy-closure › extractor ignores identifiers and comments (svelte)', () => {
    const v = visibleFromSvelte(svelteFixture);
    const all = v.join('\n');
    for (const hidden of ['probeHardware', 'diagnosticPath', 'heatmap', 'diagnostic', 'hardware-probe', 'text-blue-600'])
      expect(all, hidden).not.toContain(hidden);
    expect(v).toContain("Couldn't check your graphics card. Pry will use the CPU.");
    expect(v).toContain('Check your graphics card');
    expect(v).toContain('Checking your computer');
    expect(v).toContain('Looking for a graphics card');
    expect(v).toContain('Copy error details');
    expect(v).toContain('Type a prompt');
    expect(v).toContain('Layer {tooltipLayer}, head {tooltipHead}: score change');
    expect(v).toContain('Swap & test');
    expect(v).toContain('Setup log');
  });

  it('copy-closure › extractor ignores identifiers and comments (ts)', () => {
    const v = visibleFromCode(tsFixture);
    const all = v.join('\n');
    for (const hidden of ['probeHardware', 'diagnosticPath', 'heatmap', 'diagnostic'])
      expect(all, hidden).not.toContain(hidden);
    expect(v).not.toContain('right');
    expect(v).toContain("Couldn't check your graphics card");
    expect(v).toContain('Attention');
    expect(v).toContain('Brighter cells mean ${n} more attention.');
    expect(v).toContain('For the last word, ${word} wins.');
  });

  it('json: keeps copy fields, drops ids and anchors', () => {
    const v = visibleFromJson(
      JSON.stringify({
        experiments: [
          {
            id: 'heatmap-demo',
            tab: 'patching',
            title: 'Copying heads',
            steps: ['Press Run.'],
            next: { reset: 'Back to normal', try: 'Try another' },
            prompt: 'John gave a drink to',
          },
        ],
      }),
    );
    expect(v.join('\n')).not.toContain('heatmap');
    expect(v).not.toContain('patching');
    expect(v).toEqual(expect.arrayContaining(['Copying heads', 'Press Run.', 'Back to normal', 'Try another', 'John gave a drink to']));
  });

  it('visibleHits ignores identifiers inside interpolations unless the phrase names a template', () => {
    const v = visibleFromSvelte('<p>Saved to {diagnosticPath}</p><p>L{tooltipLayer} H{tooltipHead}</p>');
    expect(visibleHits(v, 'diagnostic')).toEqual([]);
    expect(visibleHits(v, 'Saved to')).toHaveLength(1);
    expect(visibleHits(v, 'L{tooltipLayer} H{tooltipHead}')).toHaveLength(1);
  });

  it('dispatches on extension', () => {
    expect(visibleStrings('<p>Hi there</p>', 'x.svelte')).toEqual(['Hi there']);
    expect(visibleStrings('{"title":"Hi"}', 'x.json')).toEqual(['Hi']);
    expect(visibleStrings("const x = { label: 'Hi' };", 'x.ts')).toEqual(['Hi']);
  });
});
