import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors/index.js';
import { isWithinBoundingBox } from '../common/utils/geo.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PG_POOL } from '../database/pg-pool.provider.js';
import type { Queryable } from '../database/queryable.js';
import { TransactionManager } from '../database/transaction-manager.js';
import { MatchingService } from '../matching/matching.service.js';
import { toRideResponse } from '../rides/ride.mapper.js';
import { RidesRepository } from '../rides/rides.repository.js';
import {
  toDriverResponse,
  toOfferResponse,
  type DriverResponse,
  type OfferResponse,
} from './driver.mapper.js';
import type { UpdateAvailabilityDto } from './dto/update-availability.dto.js';
import { DriversRepository } from './drivers.repository.js';

@Injectable()
export class DriversService {
  constructor(
    @InjectConfig() private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly db: Queryable,
    private readonly tx: TransactionManager,
    private readonly drivers: DriversRepository,
    private readonly rides: RidesRepository,
    private readonly matching: MatchingService,
    @InjectPinoLogger(DriversService.name) private readonly logger: PinoLogger,
  ) {}

  async getProfile(driverId: string): Promise<DriverResponse> {
    const driver = await this.drivers.findById(this.db, driverId);
    if (!driver) throw new NotFoundError('Driver', driverId);
    const active = await this.rides.findActiveDetailsByDriver(this.db, driverId);
    return toDriverResponse(driver, active ? toRideResponse(active) : null);
  }

  /**
   * Driver goes AVAILABLE/OFFLINE, optionally reporting a location. Locks only the driver
   * row: an accept that races this either sees the new availability or makes the driver
   * BUSY first, in which case this call is rejected with 409.
   */
  async setAvailability(driverId: string, dto: UpdateAvailabilityDto): Promise<DriverResponse> {
    const location =
      dto.lat !== undefined && dto.lng !== undefined ? { lat: dto.lat, lng: dto.lng } : null;
    if (location && !isWithinBoundingBox(location, this.config.serviceArea)) {
      throw new ValidationError([
        {
          field: 'lat',
          code: 'OUT_OF_SERVICE_AREA',
          message: 'Location is outside the service area',
        },
      ]);
    }

    const updated = await this.tx.run(async (tx) => {
      const current = await this.drivers.findByIdForUpdate(tx, driverId);
      if (!current) throw new NotFoundError('Driver', driverId);
      if (current.availability === 'BUSY') {
        throw new ConflictError('Availability cannot change during an active trip', {
          availability: 'BUSY',
        });
      }
      if (
        dto.status === 'AVAILABLE' &&
        !location &&
        (current.lat === null || current.lng === null)
      ) {
        throw new ValidationError([
          {
            field: 'lat',
            code: 'LOCATION_REQUIRED',
            message: 'Send your current location (lat, lng) to go AVAILABLE',
          },
        ]);
      }
      const result = await this.drivers.setAvailability(tx, driverId, dto.status, location);
      if (!result) throw new ConflictError('Availability cannot change during an active trip');
      return result;
    });

    this.logger.info(
      { event: 'driver.availability_changed', driverId, availability: updated.availability },
      'Driver availability changed',
    );
    // Not BUSY (checked above), so there is no active ride to attach.
    return toDriverResponse(updated, null);
  }

  async listOffers(driverId: string): Promise<OfferResponse[]> {
    const driver = await this.drivers.findById(this.db, driverId);
    if (!driver) throw new NotFoundError('Driver', driverId);
    return (await this.matching.listOffers(this.db, driver)).map(toOfferResponse);
  }
}
