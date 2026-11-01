import { Injectable } from '@nestjs/common';
import { RIDE_CATEGORIES, type RideCategory } from '../common/domain/ride-category.js';
import { roadDistanceMeters, type LatLng } from '../common/utils/geo.js';
import { FARE_CONFIG, type FareConfig } from './fare.config.js';

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  surge: number;
  /** True when the minimum fare, not the itemised sum, determined the total. */
  minimumFareApplied: boolean;
}

export interface FareQuote {
  currency: FareConfig['currency'];
  category: RideCategory;
  distanceM: number;
  durationS: number;
  breakdown: FareBreakdown;
  total: number;
}

/**
 * total = round(max(minimumFare, base + perKm·km + perMinute·min) × surge)
 *
 * Each component is rounded to whole rupees before summing, so the breakdown the rider sees
 * adds up exactly to the total (unless the minimum fare applies, which is flagged).
 * Pure and deterministic: same distance and category always give the same quote.
 */
export function quoteFareForDistance(
  distanceM: number,
  category: RideCategory,
  config: FareConfig = FARE_CONFIG,
): FareQuote {
  if (!Number.isInteger(distanceM) || distanceM <= 0) {
    throw new RangeError(`distanceM must be a positive integer, got ${distanceM}`);
  }
  const pricing = config.pricing[category];
  const metersPerSecond = (config.averageTripSpeedKmh * 1000) / 3600;
  const durationS = Math.max(1, Math.round(distanceM / metersPerSecond));

  const base = pricing.baseFare;
  const distance = Math.round((distanceM / 1000) * pricing.perKm);
  const time = Math.round((durationS / 60) * pricing.perMinute);
  const itemised = base + distance + time;
  const minimumFareApplied = itemised < pricing.minimumFare;
  const total = Math.round(Math.max(pricing.minimumFare, itemised) * config.surgeMultiplier);

  return {
    currency: config.currency,
    category,
    distanceM,
    durationS,
    breakdown: { base, distance, time, surge: config.surgeMultiplier, minimumFareApplied },
    total,
  };
}

export function quoteFare(
  pickup: LatLng,
  destination: LatLng,
  category: RideCategory,
  config: FareConfig = FARE_CONFIG,
): FareQuote {
  return quoteFareForDistance(roadDistanceMeters(pickup, destination), category, config);
}

@Injectable()
export class FareService {
  quote(pickup: LatLng, destination: LatLng, category: RideCategory): FareQuote {
    return quoteFare(pickup, destination, category);
  }

  /** Quotes for every category, so the UI can show the alternative's price for comparison. */
  quoteAll(pickup: LatLng, destination: LatLng): Record<RideCategory, FareQuote> {
    return Object.fromEntries(
      RIDE_CATEGORIES.map((category) => [category, this.quote(pickup, destination, category)]),
    ) as Record<RideCategory, FareQuote>;
  }
}
