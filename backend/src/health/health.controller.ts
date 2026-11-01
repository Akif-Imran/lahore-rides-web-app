import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';

export interface HealthResponse {
  status: 'ok';
  checks?: { database: 'up' };
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up and serving HTTP. Never touches dependencies. */
  @Get('live')
  live(): HealthResponse {
    return { status: 'ok' };
  }

  /** Readiness: the instance can serve traffic (database reachable). 503 otherwise. */
  @Get('ready')
  async ready(): Promise<HealthResponse> {
    if (!(await this.health.isDatabaseReady())) {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
