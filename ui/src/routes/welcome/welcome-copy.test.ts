// Lane-local copy checks for the welcome/setup screens (T4d, copy:W1-W6).
// T4e folds these into the shared closure test.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const welcome = (p: string) => read(`routes/welcome/${p}`);

/** Visible text only: drop script blocks and comments, keep markup text and attribute strings. */
function visible(src: string): string {
  return src
    .replace(/<script[\s\S]*?<\/script>/g, (m) => (m.match(/(['"`])((?:(?!\1).)*)\1/g) ?? []).join(' '))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const files = [
  '+page.svelte',
  '+layout.svelte',
  'hardware/+page.svelte',
  'installing/+page.svelte',
  'preset/+page.svelte',
  'hf-token/+page.svelte',
  'downloading/+page.svelte',
  'done/+page.svelte',
];

describe('welcome copy', () => {
  it('W1: done screen describes the nine-chapter tour', () => {
    const s = welcome('done/+page.svelte');
    expect(s).not.toContain('two guided demos');
    expect(s).toContain('nine short');
  });

  it('W2: welcome page does not use unglossed "transformer"', () => {
    expect(visible(welcome('+page.svelte'))).not.toContain('transformer');
  });

  it('W3: hardware screen speaks plainly', () => {
    const s = welcome('hardware/+page.svelte');
    expect(s).toContain("Couldn't check your graphics card");
    expect(visible(s)).not.toMatch(/probe|probing/i);
  });

  it('W4: installing screen drops runtime/diagnostic jargon', () => {
    const s = welcome('installing/+page.svelte');
    expect(s).toContain("Installing Pry's engine");
    expect(s).toContain('Copy error details');
    expect(s).toContain('Setup log');
    const v = visible(s);
    // Identifiers (diagnosticPath, copyDiagnostic, bootstrapRuntime) stay; visible strings must not use the words.
    expect(v).not.toMatch(/Installing the runtime|Copy diagnostic|install log|Runtime already/);
  });

  it('W5: Gemma token explanation is plain', () => {
    const s = welcome('hf-token/+page.svelte');
    expect(s).toContain('needs permission before you can download it');
    expect(s).not.toContain('gated model');
  });

  it('W6: Hugging Face is spelled with a space', () => {
    for (const f of files) expect(welcome(f), f).not.toContain('HuggingFace');
    expect(read('lib/components/CustomModelDialog.svelte')).not.toMatch(/HuggingFace/);
  });

  it('no em dashes in welcome visible copy', () => {
    for (const f of files) expect(visible(welcome(f)), f).not.toContain('—');
  });
});
