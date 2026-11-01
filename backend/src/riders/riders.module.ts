import { Module } from '@nestjs/common';
import { RidesModule } from '../rides/rides.module.js';
import { RidersController } from './riders.controller.js';

@Module({ imports: [RidesModule], controllers: [RidersController] })
export class RidersModule {}
