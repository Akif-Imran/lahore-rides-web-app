import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { RidesService } from './rides.service.js';

export const RIDE_EXPIRY_INTERVAL_MS = 30_000;
const INTERVAL_NAME = 'ride-expiry-sweep';

/**
 * Moves REQUESTED rides nobody accepted within RIDE_REQUEST_TTL_SECONDS to EXPIRED, so a
 * rider is never left waiting forever. Safe to run on every replica at once: the work is a
 * single conditional UPDATE, so concurrent sweeps (and accepts) cannot double-transition.
 * Only scheduled when RIDE_EXPIRY_SWEEP_ENABLED (tests call `sweep()` directly instead).
 */
@Injectable()
export class RideExpiryScheduler implements OnApplicationBootstrap {
  private running = false;

  constructor(
    @InjectConfig() private readonly config: AppConfig,
    private readonly rides: RidesService,
    private readonly registry: SchedulerRegistry,
    @InjectPinoLogger(RideExpiryScheduler.name) private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.rides.expirySweepEnabled) return;
    const handle = setInterval(() => void this.sweep(), RIDE_EXPIRY_INTERVAL_MS);
    handle.unref();
    // Registered so ScheduleModule clears it on shutdown.
    this.registry.addInterval(INTERVAL_NAME, handle);
  }

  /** Returns how many rides were expired. Skips if a previous sweep is still running. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return (await this.rides.expireStaleRequests()).length;
    } catch (error) {
      this.logger.error({ err: error }, 'Ride expiry sweep failed');
      return 0;
    } finally {
      this.running = false;
    }
  }
}
