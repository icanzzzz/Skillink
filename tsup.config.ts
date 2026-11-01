import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['apps/cli/src/index.ts'],
  format: ['esm'],
  outDir: 'apps/cli/dist',
  clean: true,
  sourcemap: true,
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __skillinkCreateRequire } from 'node:module';",
      'const require = __skillinkCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  noExternal: [/^@skillink\//],
});
