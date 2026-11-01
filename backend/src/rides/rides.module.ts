import { Module } from '@nestjs/common';
import { FaresModule } from '../fares/fares.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { MatchingModule } from '../matching/matching.module.js';
import { RideExpiryScheduler } from './ride-expiry.scheduler.js';
import { RidesController } from './rides.controller.js';
import { RidesService } from './rides.service.js';

@Module({
  imports: [FaresModule, MatchingModule, IdempotencyModule],
  controllers: [RidesController],
  providers: [RidesService, RideExpiryScheduler],
  exports: [RidesService, RideExpiryScheduler],
})
export class RidesModule {}
