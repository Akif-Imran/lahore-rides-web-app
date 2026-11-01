import type { RideCategory } from '../common/domain/ride-category.js';
import type { LatLng } from '../common/utils/geo.js';
import type { RideStatus } from './ride-status.js';

export type CancelledBy = 'RIDER' | 'DRIVER' | 'SYSTEM';

export interface NamedLocation extends LatLng {
  name: string;
}

export interface RideRecord {
  id: string;
  riderId: string;
  driverId: string | null;
  category: RideCategory;
  status: RideStatus;
  pickup: NamedLocation;
  destination: NamedLocation;
  distanceM: number;
  durationS: number;
  etaMinutes: number | null;
  cancelledBy: CancelledBy | null;
  cancelReason: string | null;
  version: number;
  requestedAt: Date;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date;
}

export interface FareRecord {
  currency: string;
  baseAmount: number;
  distanceAmount: number;
  timeAmount: number;
  surgeMultiplier: number;
  estimatedTotal: number;
  finalTotal: number | null;
}

export interface RideDriverSummary {
  id: string;
  name: string;
  vehicleCategory: RideCategory;
  vehicleModel: string;
  vehiclePlate: string;
  lat: number | null;
  lng: number | null;
}

/** A ride with everything needed to render it: the fare quote and the assigned driver. */
export interface RideDetails {
  ride: RideRecord;
  fare: FareRecord;
  driver: RideDriverSummary | null;
}

export interface NewRide {
  riderId: string;
  category: RideCategory;
  pickup: NamedLocation;
  destination: NamedLocation;
  distanceM: number;
  durationS: number;
  etaMinutes: number | null;
}

export interface OpenRideNearby {
  details: RideDetails;
  /** Straight-line distance from the driver to the pickup, metres. */
  distanceM: number;
}
