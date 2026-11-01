import type { RideCategory } from '../common/domain/ride-category.js';
import { DriverNotEligibleError, DriverUnavailableError } from '../common/errors/index.js';
import {
  assertDriverCanAccept,
  canServe,
  isLocationFresh,
  pickupEtaMinutes,
  rideCategoriesFor,
  vehicleCategoriesFor,
  type DriverEligibilityView,
} from './eligibility.js';

describe('canServe (blueprint test 4)', () => {
  it.each<[RideCategory, RideCategory, boolean]>([
    ['ECONOMY', 'ECONOMY', true],
    ['COMFORT', 'COMFORT', true],
    ['COMFORT', 'ECONOMY', true],
    ['ECONOMY', 'COMFORT', false],
  ])('%s vehicle -> %s ride: %s', (vehicle, rideCategory, expected) => {
    expect(canServe(vehicle, rideCategory)).toBe(expected);
  });

  it('derives the category lists used by queries from the same rule', () => {
    expect(vehicleCategoriesFor('ECONOMY')).toEqual(['ECONOMY', 'COMFORT']);
    expect(vehicleCategoriesFor('COMFORT')).toEqual(['COMFORT']);
    expect(rideCategoriesFor('ECONOMY')).toEqual(['ECONOMY']);
    expect(rideCategoriesFor('COMFORT')).toEqual(['ECONOMY', 'COMFORT']);
  });
});

describe('isLocationFresh', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

  it('is false when the driver never reported a location', () => {
    expect(isLocationFresh(null, now, 120)).toBe(false);
  });

  it('is true up to and including the TTL, false after it', () => {
    expect(isLocationFresh(secondsAgo(60), now, 120)).toBe(true);
    expect(isLocationFresh(secondsAgo(120), now, 120)).toBe(true);
    expect(isLocationFresh(new Date(secondsAgo(120).getTime() - 1), now, 120)).toBe(false);
  });

  it('tolerates small clock skew (timestamp slightly in the future)', () => {
    expect(isLocationFresh(secondsAgo(-2), now, 120)).toBe(true);
  });
});

describe('pickupEtaMinutes', () => {
  // road = straight × 1.3 at 25 km/h (416.67 m/min), rounded up, plus 1 minute buffer
  it.each<[number, number]>([
    [0, 1],
    [1_000, 5], // 1300 m / 416.67 = 3.12 -> 4 + 1
    [5_000, 17], // 6500 m / 416.67 = 15.6 -> 16 + 1
  ])('%i m straight-line -> %i min', (meters, minutes) => {
    expect(pickupEtaMinutes(meters)).toBe(minutes);
  });

  it('never decreases as the driver gets further away', () => {
    let previous = 0;
    for (let meters = 0; meters <= 10_000; meters += 250) {
      const eta = pickupEtaMinutes(meters);
      expect(eta).toBeGreaterThanOrEqual(previous);
      previous = eta;
    }
  });
});

describe('assertDriverCanAccept', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  const options = { now, locationTtlSeconds: 120 };
  const driver = (overrides: Partial<DriverEligibilityView> = {}): DriverEligibilityView => ({
    vehicleCategory: 'ECONOMY',
    availability: 'AVAILABLE',
    hasLocation: true,
    locationUpdatedAt: new Date(now.getTime() - 30_000),
    ...overrides,
  });

  it('allows an available, nearby-fresh, category-compatible driver', () => {
    expect(() => assertDriverCanAccept(driver(), 'ECONOMY', options)).not.toThrow();
    expect(() =>
      assertDriverCanAccept(driver({ vehicleCategory: 'COMFORT' }), 'ECONOMY', options),
    ).not.toThrow();
  });

  it('rejects an Economy vehicle for a Comfort ride with 403 DRIVER_NOT_ELIGIBLE', () => {
    expect(() => assertDriverCanAccept(driver(), 'COMFORT', options)).toThrow(
      expect.objectContaining({
        code: 'DRIVER_NOT_ELIGIBLE',
        httpStatus: 403,
        details: { vehicleCategory: 'ECONOMY', rideCategory: 'COMFORT' },
      }),
    );
  });

  it.each<[string, Partial<DriverEligibilityView>, string]>([
    ['busy', { availability: 'BUSY' }, 'BUSY'],
    ['offline', { availability: 'OFFLINE' }, 'OFFLINE'],
    ['without a location', { hasLocation: false, locationUpdatedAt: null }, 'NO_LOCATION'],
    [
      'with a stale location',
      { locationUpdatedAt: new Date(now.getTime() - 121_000) },
      'LOCATION_STALE',
    ],
  ])('rejects a driver %s with 409 DRIVER_UNAVAILABLE', (_label, overrides, reason) => {
    expect(() => assertDriverCanAccept(driver(overrides), 'ECONOMY', options)).toThrow(
      expect.objectContaining({ code: 'DRIVER_UNAVAILABLE', httpStatus: 409, details: { reason } }),
    );
  });

  it('reports a permanent category mismatch before a transient unavailability', () => {
    expect(() =>
      assertDriverCanAccept(driver({ availability: 'OFFLINE' }), 'COMFORT', options),
    ).toThrow(DriverNotEligibleError);
    expect(() =>
      assertDriverCanAccept(driver({ availability: 'OFFLINE' }), 'ECONOMY', options),
    ).toThrow(DriverUnavailableError);
  });
});
