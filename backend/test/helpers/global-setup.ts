import { runMigrations } from '../../src/database/migrations.js';
import { assertTestDatabase, TEST_DATABASE_URL } from './test-config.js';

/** Runs once before all integration test files: bring the test database schema up to date. */
export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  await runMigrations(TEST_DATABASE_URL, 'up');
}
