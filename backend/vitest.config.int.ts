import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const DEFAULT_TEST_DATABASE_URL =
  'postgres://ridebooking:change_me@localhost:5432/ridebooking_test';

// Integration tests: the real Nest app against a real PostgreSQL (row locks and partial
// unique indexes are the behaviour under test, so no mocks or in-memory databases).
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  // Set on the main process so globalSetup (migrations) and the workers agree.
  process.env['TEST_DATABASE_URL'] ??= fileEnv['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;

  return {
    resolve: { tsconfigPaths: true },
    test: {
      globals: true,
      root: './',
      include: ['test/**/*.int-spec.ts'],
      globalSetup: ['./test/helpers/global-setup.ts'],
      // One shared database, truncated between tests: never run two files at once.
      fileParallelism: false,
      testTimeout: 60_000,
      hookTimeout: 60_000,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/scripts/**', 'src/seed/**'],
      },
    },
  };
});
