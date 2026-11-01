import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL, pgPoolProvider } from './pg-pool.provider.js';
import { TransactionManager } from './transaction-manager.js';

@Global()
@Module({
  providers: [pgPoolProvider, TransactionManager],
  exports: [PG_POOL, TransactionManager],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Drains the pool on app.close() / SIGTERM so in-flight queries finish cleanly. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
