import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module.js';
import { FareEstimatesController } from './fare-estimates.controller.js';
import { FareEstimatesService } from './fare-estimates.service.js';
import { FareService } from './fare.service.js';

@Module({
  imports: [MatchingModule],
  controllers: [FareEstimatesController],
  providers: [FareService, FareEstimatesService],
  exports: [FareService],
})
export class FaresModule {}
