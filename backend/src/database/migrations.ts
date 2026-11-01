import path from 'node:path';
import { runner } from 'node-pg-migrate';

/** `backend/migrations`, resolved the same way from `src/` (tsx, tests) and `dist/` (Docker). */
export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');
export const MIGRATIONS_TABLE = 'pgmigrations';

export type MigrationDirection = 'up' | 'down';

export interface RunMigrationsOptions {
  /** Number of migrations to apply; defaults to all for `up` and one for `down`. */
  count?: number;
  log?: (message: string) => void;
}

/**
 * Applies SQL migrations with node-pg-migrate's programmatic runner. Shared by the CLI script,
 * the Docker `migrate` service and the integration-test global setup.
 * Each run holds an advisory lock, so concurrent runners cannot apply the same migration twice.
 */
export async function runMigrations(
  databaseUrl: string,
  direction: MigrationDirection,
  options: RunMigrationsOptions = {},
): Promise<string[]> {
  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    count: options.count ?? (direction === 'up' ? Infinity : 1),
    migrationsTable: MIGRATIONS_TABLE,
    checkOrder: true,
    singleTransaction: true,
    log: options.log ?? (() => undefined),
  });
  return applied.map((migration) => migration.name);
}
