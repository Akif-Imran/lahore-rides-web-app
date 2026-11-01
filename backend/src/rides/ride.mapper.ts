import type { RideCategory } from '../common/domain/ride-category.js';
import type { LatLng } from '../common/utils/geo.js';
import type { RideStatus } from './ride-status.js';
import type { CancelledBy, NamedLocation, RideDetails } from './ride.types.js';

export interface FareBreakdownView {
  base: number;
  distance: number;
  time: number;
  surge: number;
  minimumFareApplied: boolean;
}

export interface RideFareView {
  currency: string;
  estimatedTotal: number;
  /** Set when the ride is completed. */
  finalTotal: number | null;
  breakdown: FareBreakdownView;
}

export interface RideDriverView {
  id: string;
  name: string;
  vehicle: string;
  plate: string;
  vehicleCategory: RideCategory;
  /** Live position, only while the driver is on the way or on the trip. */
  location: LatLng | null;
}

/** Public representation of a ride (the `RideResponse` schema). */
export interface RideResponse {
  id: string;
  status: RideStatus;
  category: RideCategory;
  pickup: NamedLocation;
  destination: NamedLocation;
  distanceMeters: number;
  durationSeconds: number;
  etaMinutes: number | null;
  fare: RideFareView;
  driver: RideDriverView | null;
  cancelledBy: CancelledBy | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
}

const LIVE_LOCATION_STATUSES: readonly RideStatus[] = ['ASSIGNED', 'IN_PROGRESS'];

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * Pure mapping from persistence records to the API shape. Produces only JSON-native values
 * (ISO strings, numbers) so a stored idempotent response replays byte-for-byte identical.
 */
export function toRideResponse({ ride, fare, driver }: RideDetails): RideResponse {
  const itemised = fare.baseAmount + fare.distanceAmount + fare.timeAmount;
  const showDriverLocation =
    LIVE_LOCATION_STATUSES.includes(ride.status) &&
    driver !== null &&
    driver.lat !== null &&
    driver.lng !== null;

  return {
    id: ride.id,
    status: ride.status,
    category: ride.category,
    pickup: { ...ride.pickup },
    destination: { ...ride.destination },
    distanceMeters: ride.distanceM,
    durationSeconds: ride.durationS,
    etaMinutes: ride.etaMinutes,
    fare: {
      currency: fare.currency,
      estimatedTotal: fare.estimatedTotal,
      finalTotal: fare.finalTotal,
      breakdown: {
        base: fare.baseAmount,
        distance: fare.distanceAmount,
        time: fare.timeAmount,
        surge: fare.surgeMultiplier,
        minimumFareApplied: fare.estimatedTotal > Math.round(itemised * fare.surgeMultiplier),
      },
    },
    driver: driver
      ? {
          id: driver.id,
          name: driver.name,
          vehicle: driver.vehicleModel,
          plate: driver.vehiclePlate,
          vehicleCategory: driver.vehicleCategory,
          location: showDriverLocation
            ? { lat: driver.lat as number, lng: driver.lng as number }
            : null,
        }
      : null,
    cancelledBy: ride.cancelledBy,
    cancelReason: ride.cancelReason,
    createdAt: ride.requestedAt.toISOString(),
    updatedAt: ride.updatedAt.toISOString(),
    assignedAt: iso(ride.assignedAt),
    startedAt: iso(ride.startedAt),
    completedAt: iso(ride.completedAt),
    cancelledAt: iso(ride.cancelledAt),
    version: ride.version,
  };
}
