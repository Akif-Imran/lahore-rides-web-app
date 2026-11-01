import type { RideCategory } from '../common/domain/ride-category.js';
import type { LatLng } from '../common/utils/geo.js';
import type { Offer } from '../matching/matching.service.js';
import { toRideResponse, type RideResponse } from '../rides/ride.mapper.js';
import type { DriverAvailability } from './driver-availability.js';
import type { DriverRecord } from './driver.types.js';

export interface DriverResponse {
  id: string;
  name: string;
  vehicle: string;
  plate: string;
  vehicleCategory: RideCategory;
  availability: DriverAvailability;
  location: LatLng | null;
  locationUpdatedAt: string | null;
  /** The ride the driver is currently assigned to or driving, if any. */
  activeRide: RideResponse | null;
}

export interface OfferResponse {
  ride: RideResponse;
  distanceToPickupMeters: number;
  pickupEtaMinutes: number;
}

export function toDriverResponse(
  driver: DriverRecord,
  activeRide: RideResponse | null,
): DriverResponse {
  return {
    id: driver.id,
    name: driver.name,
    vehicle: driver.vehicleModel,
    plate: driver.vehiclePlate,
    vehicleCategory: driver.vehicleCategory,
    availability: driver.availability,
    location:
      driver.lat !== null && driver.lng !== null ? { lat: driver.lat, lng: driver.lng } : null,
    locationUpdatedAt: driver.locationUpdatedAt ? driver.locationUpdatedAt.toISOString() : null,
    activeRide,
  };
}

export function toOfferResponse(offer: Offer): OfferResponse {
  return {
    ride: toRideResponse(offer.details),
    distanceToPickupMeters: offer.distanceToPickupM,
    pickupEtaMinutes: offer.pickupEtaMinutes,
  };
}
