import { ValidationError, type FieldError } from '../common/errors/index.js';
import {
  haversineMeters,
  isWithinBoundingBox,
  type BoundingBox,
  type LatLng,
} from '../common/utils/geo.js';

/** Pickup and destination closer than this are treated as the same place. */
export const MIN_TRIP_DISTANCE_M = 200;

export const TRIP_ERROR = {
  OUT_OF_SERVICE_AREA: 'OUT_OF_SERVICE_AREA',
  TRIP_TOO_SHORT: 'TRIP_TOO_SHORT',
} as const;

/**
 * Business validation of a trip, on top of the DTO's shape/range checks:
 * both ends inside the service area and at least MIN_TRIP_DISTANCE_M apart.
 * Collects every problem so the UI can show all field errors at once.
 */
export function validateTrip(pickup: LatLng, destination: LatLng, serviceArea: BoundingBox): void {
  const errors: FieldError[] = [];

  if (!isWithinBoundingBox(pickup, serviceArea)) {
    errors.push({
      field: 'pickup',
      code: TRIP_ERROR.OUT_OF_SERVICE_AREA,
      message: 'Pickup is outside the service area',
    });
  }
  if (!isWithinBoundingBox(destination, serviceArea)) {
    errors.push({
      field: 'destination',
      code: TRIP_ERROR.OUT_OF_SERVICE_AREA,
      message: 'Destination is outside the service area',
    });
  }
  if (haversineMeters(pickup, destination) < MIN_TRIP_DISTANCE_M) {
    errors.push({
      field: 'destination',
      code: TRIP_ERROR.TRIP_TOO_SHORT,
      message: `Pickup and destination must be at least ${MIN_TRIP_DISTANCE_M} m apart`,
    });
  }

  if (errors.length > 0) throw new ValidationError(errors);
}
