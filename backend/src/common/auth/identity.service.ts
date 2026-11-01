import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PG_POOL } from '../../database/pg-pool.provider.js';
import type { Queryable } from '../../database/queryable.js';
import { DriversRepository } from '../../drivers/drivers.repository.js';
import { RidersRepository } from '../../riders/riders.repository.js';
import type { Caller } from '../domain/caller.js';
import { UnauthenticatedError } from '../errors/domain-errors.js';
import type { ActorKind } from './actor.decorators.js';

/**
 * Resolves a claimed identity to a known user. This is the seam where real authentication
 * (verifying a JWT/OIDC token) would replace the demo's trusted headers.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(PG_POOL) private readonly db: Queryable,
    private readonly riders: RidersRepository,
    private readonly drivers: DriversRepository,
  ) {}

  async resolve(kind: ActorKind, id: string): Promise<Caller> {
    const header = kind === 'RIDER' ? 'X-Rider-Id' : 'X-Driver-Id';
    if (!isUUID(id)) throw new UnauthenticatedError(`${header} must be a valid UUID`);

    if (kind === 'RIDER') {
      const rider = await this.riders.findById(this.db, id);
      if (!rider) throw new UnauthenticatedError('Unknown rider');
      // Use the database's canonical (lower-case) id so ownership checks compare equal.
      return { kind: 'RIDER', id: rider.id };
    }

    const driver = await this.drivers.findById(this.db, id);
    if (!driver) throw new UnauthenticatedError('Unknown driver');
    return { kind: 'DRIVER', id: driver.id, vehicleCategory: driver.vehicleCategory };
  }
}
