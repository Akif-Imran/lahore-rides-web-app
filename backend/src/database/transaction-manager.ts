import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from './pg-pool.provider.js';
import type { Queryable } from './queryable.js';

/** A client bound to an open transaction. Pass it to repository methods. */
export type TxClient = Queryable;

type ConnectablePool = Pick<Pool, 'connect'>;

/**
 * Runs a unit of work in a single READ COMMITTED transaction on one pooled connection.
 *
 * The transaction client is passed explicitly to `fn` (no AsyncLocalStorage), so it is always
 * visible at the call site which statements share a transaction and which row locks are held.
 */
@Injectable()
export class TransactionManager {
  constructor(@Inject(PG_POOL) private readonly pool: ConnectablePool) {}

  async run<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (error) {
      await rollbackAndRelease(client);
      throw error;
    }
  }
}

async function rollbackAndRelease(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
    client.release();
  } catch (rollbackError) {
    // The connection is in an unknown state: destroy it instead of returning it to the pool.
    client.release(
      rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
    );
  }
}
