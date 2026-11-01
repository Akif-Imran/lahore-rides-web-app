import { toRideResponse } from './ride.mapper.js';
import type { RideDetails } from './ride.types.js';
import type { RideStatus } from './ride-status.js';

const T0 = new Date('2026-11-01T10:00:00.000Z');
const T1 = new Date('2026-11-01T10:05:00.000Z');

function details(
  overrides: {
    status?: RideStatus;
    withDriver?: boolean;
    fare?: Partial<RideDetails['fare']>;
  } = {},
): RideDetails {
  const status = overrides.status ?? 'ASSIGNED';
  return {
    ride: {
      id: 'ride-1',
      riderId: 'rider-1',
      driverId: overrides.withDriver === false ? null : 'driver-1',
      category: 'ECONOMY',
      status,
      pickup: { name: 'Liberty Market', lat: 31.5106, lng: 74.344 },
      destination: { name: 'Lahore Fort', lat: 31.588, lng: 74.315 },
      distanceM: 11873,
      durationS: 1781,
      etaMinutes: 4,
      cancelledBy: null,
      cancelReason: null,
      version: 2,
      requestedAt: T0,
      assignedAt: T1,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: T1,
    },
    fare: {
      currency: 'PKR',
      baseAmount: 150,
      distanceAmount: 475,
      timeAmount: 148,
      surgeMultiplier: 1,
      estimatedTotal: 773,
      finalTotal: null,
      ...overrides.fare,
    },
    driver:
      overrides.withDriver === false
        ? null
        : {
            id: 'driver-1',
            name: 'Usman Tariq',
            vehicleCategory: 'ECONOMY',
            vehicleModel: 'Suzuki Alto',
            vehiclePlate: 'LEA-1001',
            lat: 31.52,
            lng: 74.36,
          },
  };
}

describe('toRideResponse', () => {
  it('maps records to the public shape with ISO timestamps', () => {
    expect(toRideResponse(details())).toEqual({
      id: 'ride-1',
      status: 'ASSIGNED',
      category: 'ECONOMY',
      pickup: { name: 'Liberty Market', lat: 31.5106, lng: 74.344 },
      destination: { name: 'Lahore Fort', lat: 31.588, lng: 74.315 },
      distanceMeters: 11873,
      durationSeconds: 1781,
      etaMinutes: 4,
      fare: {
        currency: 'PKR',
        estimatedTotal: 773,
        finalTotal: null,
        breakdown: { base: 150, distance: 475, time: 148, surge: 1, minimumFareApplied: false },
      },
      driver: {
        id: 'driver-1',
        name: 'Usman Tariq',
        vehicle: 'Suzuki Alto',
        plate: 'LEA-1001',
        vehicleCategory: 'ECONOMY',
        location: { lat: 31.52, lng: 74.36 },
      },
      cancelledBy: null,
      cancelReason: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:05:00.000Z',
      assignedAt: '2026-11-01T10:05:00.000Z',
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      version: 2,
    });
  });

  it('survives a JSON round trip unchanged, so stored idempotent replays are identical', () => {
    const response = toRideResponse(details());
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });

  it('has no driver before assignment', () => {
    expect(toRideResponse(details({ status: 'REQUESTED', withDriver: false })).driver).toBeNull();
  });

  it.each<[RideStatus, boolean]>([
    ['ASSIGNED', true],
    ['IN_PROGRESS', true],
    ['COMPLETED', false],
    ['CANCELLED', false],
  ])('exposes the driver location while %s: %s', (status, visible) => {
    const { driver } = toRideResponse(details({ status }));
    expect(driver?.name).toBe('Usman Tariq');
    expect(driver?.location !== null).toBe(visible);
  });

  it('derives minimumFareApplied from the stored amounts', () => {
    const applied = toRideResponse(
      details({
        fare: { baseAmount: 150, distanceAmount: 40, timeAmount: 13, estimatedTotal: 250 },
      }),
    );
    expect(applied.fare.breakdown.minimumFareApplied).toBe(true);
  });
});
