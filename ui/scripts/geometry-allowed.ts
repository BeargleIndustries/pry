// Writes scripts/dev/geometry-allowed-additions.json from pry-anchors.ts (plan
// Step 0, R5-3): `lessons-toggle` plus every app-resident anchor and hideable
// region 0.4.0 adds. geometry.mjs --diff passes an added [data-tour]/[data-tip]
// element only when its name is here; an allowed element that's absent in the
// recorded state isn't a failure, and added elements' positions aren't compared
// (critic C5-2). geometry-allowed.test.ts fails when this file is stale.
//
//   npx vite-node -c vite.cli.config.ts scripts/geometry-allowed.ts --write

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ADDED_ANCHORS, HIDEABLE_ANCHORS, SIDEBAR_ANCHORS } from '../src/lib/lessons/registry/pry-anchors';

export const ALLOWED_FILE = fileURLToPath(new URL('../../scripts/dev/geometry-allowed-additions.json', import.meta.url));

export function allowedAdditions(): { about: string; allowed: string[] } {
  const names = new Set<string>(['lessons-toggle', ...ADDED_ANCHORS, ...HIDEABLE_ANCHORS]);
  for (const s of SIDEBAR_ANCHORS) names.delete(s);
  return {
    about: 'Generated from ui/src/lib/lessons/registry/pry-anchors.ts by ui/scripts/geometry-allowed.ts. Do not edit by hand.',
    allowed: [...names].sort(),
  };
}

export function allowedJson(): string {
  return `${JSON.stringify(allowedAdditions(), null, 2)}\n`;
}

if (process.argv.includes('--write')) {
  writeFileSync(ALLOWED_FILE, allowedJson());
  console.log(`wrote ${ALLOWED_FILE}`);
}
