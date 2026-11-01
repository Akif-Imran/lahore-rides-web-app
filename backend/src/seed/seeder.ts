import type { Pool } from 'pg';
import { TransactionManager } from '../database/transaction-manager.js';
import { SEED_DRIVERS, SEED_RIDERS } from './seed-data.js';
import {
  insertDriversIfMissing,
  insertRidersIfMissing,
  refreshDriverLocationTimestamps,
  resetDrivers,
  truncateRideData,
} from './seed.repository.js';

export interface SeedOptions {
  /** Delete all rides and restore every seeded driver to its seed state. */
  reset?: boolean;
}

export interface SeedResult {
  mode: 'seed' | 'reset';
  ridersInserted: number;
  driversWritten: number;
}

/**
 * Idempotent: running it twice leaves the same rows. The default mode never changes the
 * availability of existing drivers, so it is safe to run on every `docker compose up` even
 * while a driver is mid-trip (BUSY with an active assignment).
 */
export async function runSeed(pool: Pool, options: SeedOptions = {}): Promise<SeedResult> {
  const tx = new TransactionManager(pool);
  return tx.run(async (db) => {
    if (options.reset) {
      await truncateRideData(db);
      const driversWritten = await resetDrivers(db, SEED_DRIVERS);
      const ridersInserted = await insertRidersIfMissing(db, SEED_RIDERS);
      return { mode: 'reset', ridersInserted, driversWritten };
    }

    const ridersInserted = await insertRidersIfMissing(db, SEED_RIDERS);
    const driversWritten = await insertDriversIfMissing(db, SEED_DRIVERS);
    await refreshDriverLocationTimestamps(
      db,
      SEED_DRIVERS.map((driver) => driver.id),
    );
    return { mode: 'seed', ridersInserted, driversWritten };
  });
}
