import { Injectable } from '@nestjs/common';
import type { Queryable } from '../database/queryable.js';

@Injectable()
export class HealthRepository {
  /** Round-trips to PostgreSQL; bounded by the pool's connection and statement timeouts. */
  async ping(db: Queryable): Promise<void> {
    await db.query('SELECT 1');
  }
}
