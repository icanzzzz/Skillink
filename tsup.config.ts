import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['apps/cli/src/index.ts'],
  format: ['esm'],
  outDir: 'apps/cli/dist',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  noExternal: [/^@skillink\//],
});
