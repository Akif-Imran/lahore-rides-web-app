import { RIDE_CATEGORIES, type RideCategory } from '../common/domain/ride-category.js';
import { DriverNotEligibleError, DriverUnavailableError } from '../common/errors/index.js';
import { ROAD_DISTANCE_FACTOR } from '../common/utils/geo.js';
import type { DriverAvailability } from '../drivers/driver-availability.js';

/** Higher rank can serve lower: a Comfort car may take an Economy ride, never the reverse. */
const CATEGORY_RANK: Readonly<Record<RideCategory, number>> = { ECONOMY: 1, COMFORT: 2 };

export function canServe(vehicleCategory: RideCategory, rideCategory: RideCategory): boolean {
  return CATEGORY_RANK[vehicleCategory] >= CATEGORY_RANK[rideCategory];
}

/** Vehicle categories that may serve a ride of `rideCategory` (for nearest-driver queries). */
export function vehicleCategoriesFor(rideCategory: RideCategory): RideCategory[] {
  return RIDE_CATEGORIES.filter((vehicle) => canServe(vehicle, rideCategory));
}

/** Ride categories a vehicle of `vehicleCategory` may take (for a driver's offer list). */
export function rideCategoriesFor(vehicleCategory: RideCategory): RideCategory[] {
  return RIDE_CATEGORIES.filter((ride) => canServe(vehicleCategory, ride));
}

export function isLocationFresh(
  locationUpdatedAt: Date | null,
  now: Date,
  ttlSeconds: number,
): boolean {
  if (locationUpdatedAt === null) return false;
  return now.getTime() - locationUpdatedAt.getTime() <= ttlSeconds * 1000;
}

/** Average urban speed for a driver heading to a pickup (blueprint 3.4). */
export const PICKUP_SPEED_KMH = 25;
/** Fixed allowance for the driver to set off and the rider to get in. */
export const PICKUP_BUFFER_MINUTES = 1;

/** Pickup ETA from the driver's straight-line distance to the pickup, whole minutes. */
export function pickupEtaMinutes(straightLineMeters: number): number {
  const roadMeters = straightLineMeters * ROAD_DISTANCE_FACTOR;
  const metersPerMinute = (PICKUP_SPEED_KMH * 1000) / 60;
  return Math.ceil(roadMeters / metersPerMinute) + PICKUP_BUFFER_MINUTES;
}

export interface DriverEligibilityView {
  vehicleCategory: RideCategory;
  availability: DriverAvailability;
  hasLocation: boolean;
  locationUpdatedAt: Date | null;
}

/**
 * Throws unless the driver may accept a ride of `rideCategory` right now. A permanent
 * mismatch (vehicle category, 403) is reported before a transient one (availability or
 * stale location, 409), because retrying can never fix the former.
 */
export function assertDriverCanAccept(
  driver: DriverEligibilityView,
  rideCategory: RideCategory,
  options: { now: Date; locationTtlSeconds: number },
): void {
  if (!canServe(driver.vehicleCategory, rideCategory)) {
    throw new DriverNotEligibleError(driver.vehicleCategory, rideCategory);
  }
  if (driver.availability === 'BUSY') throw new DriverUnavailableError('BUSY');
  if (driver.availability === 'OFFLINE') throw new DriverUnavailableError('OFFLINE');
  if (!driver.hasLocation) throw new DriverUnavailableError('NO_LOCATION');
  if (!isLocationFresh(driver.locationUpdatedAt, options.now, options.locationTtlSeconds)) {
    throw new DriverUnavailableError('LOCATION_STALE');
  }
}
