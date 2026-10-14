// Builds the lesson linter for Node 18 in lib mode, every dependency inlined:
// ui/build-cli/lessons-lint.mjs (a Tauri resource; plan T1 "CLI").
// The lessons:* scripts also run under vite-node with this config.

import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  // Tests import the scripts with VITEST set; the built CLI always runs its main.
  define: { 'process.env.VITEST': 'undefined' },
  resolve: { conditions: ['node'] },
  build: {
    outDir: 'build-cli',
    emptyOutDir: true,
    target: 'node18',
    minify: false,
    lib: {
      entry: 'scripts/lessons-lint.ts',
      formats: ['es'],
      fileName: () => 'lessons-lint.mjs',
    },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { inlineDynamicImports: true },
    },
  },
});
