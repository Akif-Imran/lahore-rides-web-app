/**
 * CLI: `migrate up|down [count]`
 *   dev:    npm run migrate:up / npm run migrate:down   (tsx, loads backend/.env)
 *   docker: node dist/scripts/migrate.js up
 */
import { describeError } from '../common/utils/describe-error.js';
import { loadConfig } from '../config/env.schema.js';
import { runMigrations, type MigrationDirection } from '../database/migrations.js';

function parseArgs(argv: string[]): { direction: MigrationDirection; count?: number } {
  const [direction = 'up', countArg] = argv;
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`Unknown direction "${direction}". Usage: migrate <up|down> [count]`);
  }
  if (countArg === undefined) return { direction };
  const count = Number(countArg);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got "${countArg}"`);
  }
  return { direction, count };
}

try {
  const { direction, count } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const applied = await runMigrations(config.database.url, direction, {
    count,
    log: (message) => console.log(message),
  });
  console.log(
    applied.length > 0
      ? `Migrations ${direction}: ${applied.join(', ')}`
      : `No migrations to run (${direction}).`,
  );
} catch (error) {
  console.error(`Migration failed: ${describeError(error)}`);
  process.exitCode = 1;
}
