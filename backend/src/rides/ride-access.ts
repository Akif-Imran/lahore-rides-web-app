import type { Caller } from '../common/domain/caller.js';
import type { RideCategory } from '../common/domain/ride-category.js';
import { canServe } from '../matching/eligibility.js';
import type { RideActor } from './ride-state-machine.js';
import type { RideStatus } from './ride-status.js';

export interface RideAccessView {
  riderId: string;
  driverId: string | null;
  status: RideStatus;
  category: RideCategory;
}

/**
 * Maps the caller to their relationship with this ride. Returns null for a rider who does
 * not own it: the service answers 404 so other riders cannot probe which ride ids exist.
 */
export function resolveRideActor(ride: RideAccessView, caller: Caller): RideActor | null {
  if (caller.kind === 'RIDER') return caller.id === ride.riderId ? 'RIDER' : null;
  return ride.driverId !== null && caller.id === ride.driverId ? 'ASSIGNED_DRIVER' : 'DRIVER';
}

/**
 * Read access: the ride's rider, its assigned driver, or a driver who could accept it right
 * now (REQUESTED and category-compatible, i.e. it would appear in their offers).
 */
export function canViewRide(ride: RideAccessView, caller: Caller): boolean {
  const actor = resolveRideActor(ride, caller);
  if (actor === 'RIDER' || actor === 'ASSIGNED_DRIVER') return true;
  if (actor === 'DRIVER' && caller.kind === 'DRIVER') {
    return ride.status === 'REQUESTED' && canServe(caller.vehicleCategory, ride.category);
  }
  return false;
}
