import { Injectable } from '@nestjs/common';
import type { RideCategory } from '../common/domain/ride-category.js';
import type { LatLng } from '../common/utils/geo.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import type { Queryable } from '../database/queryable.js';
import type { DriverRecord } from '../drivers/driver.types.js';
import { DriversRepository } from '../drivers/drivers.repository.js';
import type { RideDetails } from '../rides/ride.types.js';
import { RidesRepository } from '../rides/rides.repository.js';
import {
  isLocationFresh,
  pickupEtaMinutes,
  rideCategoriesFor,
  vehicleCategoriesFor,
} from './eligibility.js';

export interface Offer {
  details: RideDetails;
  distanceToPickupM: number;
  pickupEtaMinutes: number;
}

const MAX_OFFERS = 20;

/**
 * Simplified, pull-based matching: open rides wait in REQUESTED and any eligible driver within
 * the radius may accept. The same radius bounds both the rider's ETA and the driver's offers,
 * so a rider is never shown an ETA for a driver who would not see the ride.
 */
@Injectable()
export class MatchingService {
  constructor(
    @InjectConfig() private readonly config: AppConfig,
    private readonly drivers: DriversRepository,
    private readonly rides: RidesRepository,
  ) {}

  private get radiusM(): number {
    return this.config.matching.maxOfferRadiusKm * 1000;
  }

  /** Pickup ETA from the nearest eligible driver, or null when nobody is within range. */
  async estimatePickupEta(
    db: Queryable,
    rideCategory: RideCategory,
    pickup: LatLng,
  ): Promise<number | null> {
    const [nearest] = await this.drivers.findNearestAvailable(db, {
      vehicleCategories: vehicleCategoriesFor(rideCategory),
      center: pickup,
      radiusM: this.radiusM,
      locationTtlSeconds: this.config.matching.driverLocationTtlSeconds,
      limit: 1,
    });
    return nearest ? pickupEtaMinutes(nearest.distanceM) : null;
  }

  /** Open rides this driver could accept now, nearest pickup first. Empty unless available. */
  async listOffers(db: Queryable, driver: DriverRecord, now = new Date()): Promise<Offer[]> {
    if (
      driver.availability !== 'AVAILABLE' ||
      driver.lat === null ||
      driver.lng === null ||
      !isLocationFresh(driver.locationUpdatedAt, now, this.config.matching.driverLocationTtlSeconds)
    ) {
      return [];
    }
    const open = await this.rides.findOpenNear(db, {
      rideCategories: rideCategoriesFor(driver.vehicleCategory),
      center: { lat: driver.lat, lng: driver.lng },
      radiusM: this.radiusM,
      limit: MAX_OFFERS,
    });
    return open.map(({ details, distanceM }) => ({
      details,
      distanceToPickupM: Math.round(distanceM),
      pickupEtaMinutes: pickupEtaMinutes(distanceM),
    }));
  }
}
