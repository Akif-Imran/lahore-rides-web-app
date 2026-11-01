import { defineConfig } from 'vitest/config';

// Unit tests: pure logic, no database. Integration tests have their own config.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/scripts/**', 'src/seed/seed.ts'],
    },
  },
});
