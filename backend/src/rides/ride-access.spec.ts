import type { Caller } from '../common/domain/caller.js';
import type { RideCategory } from '../common/domain/ride-category.js';
import { canViewRide, resolveRideActor, type RideAccessView } from './ride-access.js';
import type { RideStatus } from './ride-status.js';

const OWNER = 'rider-owner';
const OTHER_RIDER = 'rider-other';
const ASSIGNED = 'driver-assigned';
const OTHER_DRIVER = 'driver-other';

const rider = (id: string): Caller => ({ kind: 'RIDER', id });
const driver = (id: string, vehicleCategory: RideCategory = 'ECONOMY'): Caller => ({
  kind: 'DRIVER',
  id,
  vehicleCategory,
});

const ride = (
  status: RideStatus,
  driverId: string | null,
  category: RideCategory = 'ECONOMY',
): RideAccessView => ({ riderId: OWNER, driverId, status, category });

describe('resolveRideActor', () => {
  it('identifies the owning rider and hides the ride from other riders', () => {
    expect(resolveRideActor(ride('REQUESTED', null), rider(OWNER))).toBe('RIDER');
    expect(resolveRideActor(ride('REQUESTED', null), rider(OTHER_RIDER))).toBeNull();
  });

  it('distinguishes the assigned driver from every other driver', () => {
    expect(resolveRideActor(ride('ASSIGNED', ASSIGNED), driver(ASSIGNED))).toBe('ASSIGNED_DRIVER');
    expect(resolveRideActor(ride('ASSIGNED', ASSIGNED), driver(OTHER_DRIVER))).toBe('DRIVER');
    expect(resolveRideActor(ride('REQUESTED', null), driver(OTHER_DRIVER))).toBe('DRIVER');
  });

  it('never treats a rider id as a driver id, even if the values collide', () => {
    const collision = ride('ASSIGNED', OWNER);
    expect(resolveRideActor(collision, rider(OWNER))).toBe('RIDER');
    expect(resolveRideActor({ ...collision, riderId: 'x' }, rider(OWNER))).toBeNull();
  });
});

describe('canViewRide', () => {
  it.each<[string, RideAccessView, Caller, boolean]>([
    ['owner, any status', ride('COMPLETED', ASSIGNED), rider(OWNER), true],
    ['another rider', ride('REQUESTED', null), rider(OTHER_RIDER), false],
    ['assigned driver, active', ride('IN_PROGRESS', ASSIGNED), driver(ASSIGNED), true],
    ['assigned driver, after cancel', ride('CANCELLED', ASSIGNED), driver(ASSIGNED), true],
    ['prospective driver, open ride', ride('REQUESTED', null), driver(OTHER_DRIVER), true],
    [
      'Comfort driver, open Economy ride',
      ride('REQUESTED', null, 'ECONOMY'),
      driver(OTHER_DRIVER, 'COMFORT'),
      true,
    ],
    [
      'Economy driver, open Comfort ride',
      ride('REQUESTED', null, 'COMFORT'),
      driver(OTHER_DRIVER, 'ECONOMY'),
      false,
    ],
    ['other driver, ride taken', ride('ASSIGNED', ASSIGNED), driver(OTHER_DRIVER), false],
    ['other driver, finished ride', ride('COMPLETED', ASSIGNED), driver(OTHER_DRIVER), false],
    ['other driver, cancelled open ride', ride('CANCELLED', null), driver(OTHER_DRIVER), false],
  ])('%s -> %s', (_label, view, caller, expected) => {
    expect(canViewRide(view, caller)).toBe(expected);
  });
});
