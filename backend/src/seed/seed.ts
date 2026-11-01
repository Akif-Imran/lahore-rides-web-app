/**
 * CLI: `seed [--reset]`
 *   dev:    npm run seed / npm run seed:reset   (tsx, loads backend/.env)
 *   docker: node dist/seed/seed.js [--reset]
 */
import { describeError } from '../common/utils/describe-error.js';
import { loadConfig } from '../config/env.schema.js';
import { createPool } from '../database/pg-pool.provider.js';
import { runSeed } from './seeder.js';

const reset = process.argv.includes('--reset');
const config = loadConfig();
const pool = createPool(config.database, 'ride-booking-seed');

try {
  const result = await runSeed(pool, { reset });
  console.log(
    result.mode === 'reset'
      ? `Seed reset: ride data cleared, ${result.driversWritten} drivers restored, ${result.ridersInserted} riders inserted.`
      : `Seed: ${result.ridersInserted} riders and ${result.driversWritten} drivers inserted (existing rows untouched).`,
  );
} catch (error) {
  console.error(`Seed failed: ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
