import { Global, Module } from '@nestjs/common';
import { DriversRepository } from '../drivers/drivers.repository.js';
import { FaresRepository } from '../fares/fares.repository.js';
import { IdempotencyRepository } from '../idempotency/idempotency.repository.js';
import { RidersRepository } from '../riders/riders.repository.js';
import { RideAssignmentsRepository } from '../rides/ride-assignments.repository.js';
import { RidesRepository } from '../rides/rides.repository.js';

const REPOSITORIES = [
  RidersRepository,
  DriversRepository,
  RidesRepository,
  RideAssignmentsRepository,
  FaresRepository,
  IdempotencyRepository,
];

/**
 * Repositories are stateless SQL adapters that several features share (e.g. matching reads
 * drivers and rides). Registering them once here keeps the feature-module graph acyclic.
 */
@Global()
@Module({ providers: REPOSITORIES, exports: REPOSITORIES })
export class RepositoriesModule {}
