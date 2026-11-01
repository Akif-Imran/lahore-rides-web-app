import type { RideCategory } from '../common/domain/ride-category.js';

export interface CategoryPricing {
  /** PKR charged on every trip. */
  baseFare: number;
  /** PKR per estimated road kilometre. */
  perKm: number;
  /** PKR per estimated trip minute. */
  perMinute: number;
  /** Lower bound on the total, PKR. */
  minimumFare: number;
}

export interface FareConfig {
  currency: 'PKR';
  /** Fixed at 1.0 in this scope; production would derive it per area and time. */
  surgeMultiplier: number;
  /** Average in-trip speed used to estimate duration from road distance. */
  averageTripSpeedKmh: number;
  pricing: Readonly<Record<RideCategory, CategoryPricing>>;
}

/** Blueprint 3.4 pricing. Amounts are whole Pakistani rupees. */
export const FARE_CONFIG: FareConfig = {
  currency: 'PKR',
  surgeMultiplier: 1,
  averageTripSpeedKmh: 24,
  pricing: {
    ECONOMY: { baseFare: 150, perKm: 40, perMinute: 5, minimumFare: 250 },
    COMFORT: { baseFare: 250, perKm: 65, perMinute: 8, minimumFare: 400 },
  },
};
