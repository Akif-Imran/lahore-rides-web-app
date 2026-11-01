import { DEMO_DRIVERS } from '@/lib/demo-actors';
import type {
  CategoryEstimate,
  Driver,
  FareEstimateResponse,
  Offer,
  Ride,
  RideDriver,
  RideStatus,
} from '@/types/api';

// Typed against the generated OpenAPI types: a contract change breaks these fixtures at compile
// time instead of letting the tests pass against a stale shape.

export const RIDE_ID = '33333333-3333-4333-8333-000000000001';
export const OTHER_RIDE_ID = '33333333-3333-4333-8333-000000000002';

const usman = DEMO_DRIVERS[0]!;

export const RIDE_DRIVER: RideDriver = {
  id: usman.id,
  name: usman.name,
  vehicle: usman.vehicle,
  plate: usman.plate,
  vehicleCategory: usman.vehicleCategory,
  location: { lat: 31.515, lng: 74.35 },
};

export function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: RIDE_ID,
    status: 'REQUESTED',
    category: 'ECONOMY',
    pickup: { name: 'Liberty Market', lat: 31.5106, lng: 74.344 },
    destination: { name: 'Lahore Fort', lat: 31.588, lng: 74.315 },
    distanceMeters: 11_750,
    durationSeconds: 1_763,
    etaMinutes: 7,
    fare: {
      currency: 'PKR',
      estimatedTotal: 767,
      finalTotal: null,
      breakdown: { base: 150, distance: 470, time: 147, surge: 1, minimumFareApplied: false },
    },
    driver: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

/** A ride whose fields are consistent with `status`, as the backend would return it. */
export function rideInStatus(status: RideStatus, overrides: Partial<Ride> = {}): Ride {
  const at = '2026-11-01T10:05:00.000Z';
  const byStatus: Record<RideStatus, Partial<Ride>> = {
    REQUESTED: {},
    ASSIGNED: { driver: RIDE_DRIVER, assignedAt: at, version: 2 },
    IN_PROGRESS: { driver: RIDE_DRIVER, assignedAt: at, startedAt: at, version: 3 },
    COMPLETED: {
      // The backend hides the driver's location once the trip is over (DECISIONS D19).
      driver: { ...RIDE_DRIVER, location: null },
      assignedAt: at,
      startedAt: at,
      completedAt: '2026-11-01T10:35:00.000Z',
      fare: { ...makeRide().fare, finalTotal: 767 },
      version: 4,
    },
    CANCELLED: { cancelledBy: 'RIDER', cancelledAt: at, version: 2 },
    EXPIRED: { cancelledBy: 'SYSTEM', cancelledAt: at, version: 2 },
  };
  return makeRide({ status, ...byStatus[status], ...overrides });
}

export function categoryEstimate(
  category: CategoryEstimate['category'],
  total: number,
  etaMinutes: number | null,
): CategoryEstimate {
  return {
    category,
    currency: 'PKR',
    total,
    etaMinutes,
    breakdown: { base: 150, distance: 470, time: 147, surge: 1, minimumFareApplied: false },
  };
}

export function makeEstimate(
  economyEta: number | null = 7,
  comfortEta: number | null = 14,
): FareEstimateResponse {
  return {
    distanceMeters: 11_750,
    durationSeconds: 1_763,
    estimates: [
      categoryEstimate('ECONOMY', 767, economyEta),
      categoryEstimate('COMFORT', 1248, comfortEta),
    ],
  };
}

export function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: usman.id,
    name: usman.name,
    vehicle: usman.vehicle,
    plate: usman.plate,
    vehicleCategory: usman.vehicleCategory,
    availability: 'AVAILABLE',
    location: usman.home,
    locationUpdatedAt: '2026-11-01T09:58:00.000Z',
    activeRide: null,
    ...overrides,
  };
}

export function makeOffer(ride: Ride = makeRide()): Offer {
  return { ride, distanceToPickupMeters: 1_800, pickupEtaMinutes: 7 };
}
