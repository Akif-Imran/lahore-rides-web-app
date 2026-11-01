import { Inject, Injectable } from '@nestjs/common';
import { RIDE_CATEGORIES, type RideCategory } from '../common/domain/ride-category.js';
import type { LatLng } from '../common/utils/geo.js';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PG_POOL } from '../database/pg-pool.provider.js';
import type { Queryable } from '../database/queryable.js';
import { MatchingService } from '../matching/matching.service.js';
import { validateTrip } from '../rides/trip-validation.js';
import { FareService, type FareBreakdown } from './fare.service.js';

export interface CategoryEstimate {
  category: RideCategory;
  currency: string;
  total: number;
  breakdown: FareBreakdown;
  etaMinutes: number | null;
}

export interface FareEstimateResponse {
  distanceMeters: number;
  durationSeconds: number;
  estimates: CategoryEstimate[];
}

/** Pre-request quote for every category, so the rider can compare before booking. */
@Injectable()
export class FareEstimatesService {
  constructor(
    @InjectConfig() private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly db: Queryable,
    private readonly fares: FareService,
    private readonly matching: MatchingService,
  ) {}

  async estimate(pickup: LatLng, destination: LatLng): Promise<FareEstimateResponse> {
    validateTrip(pickup, destination, this.config.serviceArea);
    const quotes = this.fares.quoteAll(pickup, destination);
    const estimates = await Promise.all(
      RIDE_CATEGORIES.map(async (category) => ({
        category,
        currency: quotes[category].currency,
        total: quotes[category].total,
        breakdown: quotes[category].breakdown,
        etaMinutes: await this.matching.estimatePickupEta(this.db, category, pickup),
      })),
    );
    // Distance and duration depend only on the route, not the category.
    return {
      distanceMeters: quotes.ECONOMY.distanceM,
      durationSeconds: quotes.ECONOMY.durationS,
      estimates,
    };
  }
}
