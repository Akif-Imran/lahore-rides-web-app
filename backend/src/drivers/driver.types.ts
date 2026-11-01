import type { RideCategory } from '../common/domain/ride-category.js';
import type { DriverAvailability } from './driver-availability.js';

export interface DriverRecord {
  id: string;
  name: string;
  vehicleCategory: RideCategory;
  vehicleModel: string;
  vehiclePlate: string;
  availability: DriverAvailability;
  lat: number | null;
  lng: number | null;
  locationUpdatedAt: Date | null;
  updatedAt: Date;
}

export interface NearbyDriver {
  id: string;
  /** Straight-line distance to the reference point, metres. */
  distanceM: number;
}
