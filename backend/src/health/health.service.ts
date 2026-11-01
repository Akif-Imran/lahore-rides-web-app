import { Inject, Injectable, Logger } from '@nestjs/common';
import { describeError } from '../common/utils/describe-error.js';
import { PG_POOL } from '../database/pg-pool.provider.js';
import type { Queryable } from '../database/queryable.js';
import { HealthRepository } from './health.repository.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Queryable,
    private readonly repository: HealthRepository,
  ) {}

  async isDatabaseReady(): Promise<boolean> {
    try {
      await this.repository.ping(this.db);
      return true;
    } catch (error) {
      this.logger.warn(`Readiness check failed: ${describeError(error)}`);
      return false;
    }
  }
}
