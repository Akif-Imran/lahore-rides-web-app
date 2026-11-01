import { Logger, type Provider } from '@nestjs/common';
import { Pool } from 'pg';
import { describeError } from '../common/utils/describe-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig, DatabaseConfig } from '../config/env.schema.js';

/** DI token for the singleton pg Pool. Inject it typed as `Queryable` for plain reads. */
export const PG_POOL = Symbol('PG_POOL');

const logger = new Logger('PgPool');

/**
 * Creates the connection pool. Session-level timeouts make a stuck lock or runaway query fail
 * fast (mapped to 503 by the error filter) instead of silently exhausting the pool.
 */
export function createPool(db: DatabaseConfig, applicationName = 'ride-booking-api'): Pool {
  const pool = new Pool({
    connectionString: db.url,
    max: db.poolMax,
    application_name: applicationName,
    lock_timeout: db.lockTimeoutMs,
    statement_timeout: db.statementTimeoutMs,
    idle_in_transaction_session_timeout: 10_000,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  // An idle client can error (e.g. the server restarts). Without a listener the process crashes.
  pool.on('error', (error) => {
    logger.error(`Idle PostgreSQL client error: ${describeError(error)}`, error.stack);
  });

  return pool;
}

export const pgPoolProvider: Provider = {
  provide: PG_POOL,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): Pool => createPool(config.database),
};
