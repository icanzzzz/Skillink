import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@skillink/shared': `${root}packages/shared/src/index.ts`,
      '@skillink/core': `${root}packages/core/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
