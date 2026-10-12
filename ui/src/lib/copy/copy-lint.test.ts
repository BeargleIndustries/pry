// Copy lint over user-visible strings only (plan pry-clarity T4e, copy:C24, copy:W6).
// Every `.svelte` file plus the `.ts` / `.json` copy files. Files owned by a lane
// in PENDING_LANES run as `test.todo` until that lane merges; each lane fixes its own.
import { describe, expect, it } from 'vitest';
import { COPY_FILES, FILE_OWNER, PENDING_LANES, allFiles, visible } from './copy-files';

/**
 * `banned_example_names` from the brad-voice skill's lint_rules.json (copied 2026-10-12).
 * Stock names that read as AI-generated examples.
 */
export const BANNED_EXAMPLE_NAMES = [
  'Aaron', 'Abara', 'Abdul', 'Adaeze', 'Adeyemi', 'Aisha', 'Alvarado', 'Amara', 'Andre', 'Anouk', 'Ansel', 'Ashcroft',
  'Astrid', 'Baptiste', 'Beaumont', 'Bennett', 'Berkowitz', 'Bethany', 'Bhatt', 'Bianca', 'Bianchi', 'Blake', 'Blythe',
  'Boyd', 'Brenner', 'Brooks', 'Bryce', 'Callahan', 'Camila', 'Carmen', 'Castillo', 'Chandra', 'Chao', 'Clara', 'Clarke',
  'Cole', 'Coleman', 'Colette', 'Cross', 'Cruz', 'Curtis', 'Cyrus', 'Damon', 'Darius', 'Delgado', 'Delphine', 'Desai',
  'Desmond', 'Devon', 'Dominic', 'Donovan', 'Dubois', 'Elena', 'Elias', 'Ellison', 'Emmanuel', 'Esposito', 'Ezra',
  'Faraday', 'Farah', 'Farooqi', 'Feldman', 'Felix', 'Fernando', 'Fischer', 'Fletcher', 'Frances', 'Freeman', 'Fuentes',
  'Gallagher', 'Garrett', 'Genevieve', 'Gideon', 'Gloria', 'Grant', 'Haddad', 'Hannah', 'Hargrove', 'Hartman', 'Hector',
  'Heidi', 'Holloway', 'Holt', 'Hugo', 'Iglesias', 'Imani', 'Ingram', 'Ingrid', 'Isaac', 'Johnson', 'Jonah', 'Julian',
  'Kai', 'Kaminski', 'Kenji', 'Kowalski', 'Kwon', 'Larsson', 'Laurent', 'Leah', 'Lin', 'Lindqvist', 'Lorenzo', 'Lucas',
  'Lucia', 'Mahoney', 'Malcolm', 'Malik', 'Marcus', 'Margot', 'Marlene', 'Marsh', 'McKenna', 'Mei', 'Mendez', 'Mensah',
  'Meredith', 'Merrick', 'Moreau', 'Nadia', 'Nair', 'Nakamura', 'Naomi', 'Nasser', 'Nathan', 'Nguyen', 'Noor',
  'Nordmann', 'Novak', 'Odette', 'Okafor', 'Omar', 'Ortega', 'Oscar', 'Osei', 'Pace', 'Petit', 'Petrov', 'Piper',
  'Priya', 'Pruitt', 'Quinn', 'Rahman', 'Rahul', 'Rashida', 'Ravenna', 'Reed', 'Renata', 'Reyes', 'Roland', 'Romano',
  'Rory', 'Rosa', 'Roux', 'Russo', 'Sasha', 'Sean', 'Selena', 'Siddiqui', 'Silva', 'Simon', 'Sinclair', 'Sofia',
  'Sterling', 'Sternberg', 'Sutton', 'Talia', 'Tamsin', 'Tanaka', 'Tanvi', 'Terrence', 'Theo', 'Thompson', 'Trevor',
  'Valentina', 'Vance', 'Vanessa', 'Vasquez', 'Vaughn', 'Vincent', 'Visser', 'Volkov', 'Watanabe', 'Wesley',
  'Whitaker', 'Whitfield', 'Whitlock', 'Willa', 'Winifred', 'Wray', 'Xavier', 'Yang', 'Yara', 'Yuki', 'Zoe',
];

/** Wrong spellings of names (naming table: Hugging Face is two words; copy:W6). */
const BANNED_SPELLINGS = ['HuggingFace'];

const bannedRe = new RegExp(`\\b(${[...BANNED_EXAMPLE_NAMES, ...BANNED_SPELLINGS].join('|')})\\b`);

const lintFiles = [...allFiles().filter((f) => f.endsWith('.svelte')), ...COPY_FILES].sort();

function perFile(name: string, check: (strings: string[], file: string) => void) {
  describe(name, () => {
    for (const f of lintFiles) {
      const owner = FILE_OWNER[f];
      if (owner && PENDING_LANES.has(owner)) {
        it.todo(`${f} [${owner}]`);
        continue;
      }
      it(f, () => check(visible(f), f));
    }
  });
}

describe('copy lint', () => {
  it('lints every .svelte file and every copy file', () => {
    expect(lintFiles.length).toBeGreaterThan(40);
    expect(lintFiles).toContain('routes/+page.svelte');
  });

  perFile('no em dash in user-visible strings', (strings, f) => {
    expect(
      strings.filter((s) => s.includes('—')),
      f,
    ).toEqual([]);
  });

  perFile('banned names', (strings, f) => {
    expect(
      strings.filter((s) => bannedRe.test(s)),
      f,
    ).toEqual([]);
  });
});
