import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';

@Module({
  imports: [MatchingModule],
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
