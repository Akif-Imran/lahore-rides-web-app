import { Injectable } from '@nestjs/common';
import type { Queryable } from '../database/queryable.js';
import type { FareQuote } from './fare.service.js';

@Injectable()
export class FaresRepository {
  /** Persists the quote shown to the rider, so what they saw is exactly what is stored. */
  async insertQuote(tx: Queryable, rideId: string, quote: FareQuote): Promise<void> {
    await tx.query(
      `INSERT INTO fares (ride_id, currency, base_amount, distance_amount, time_amount,
                          surge_multiplier, estimated_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        rideId,
        quote.currency,
        quote.breakdown.base,
        quote.breakdown.distance,
        quote.breakdown.time,
        quote.breakdown.surge,
        quote.total,
      ],
    );
  }

  /** In this scope the final fare equals the estimate (no metering, tolls or waiting time). */
  async finalizeAtEstimate(tx: Queryable, rideId: string): Promise<boolean> {
    const result = await tx.query(
      `UPDATE fares SET final_total = estimated_total WHERE ride_id = $1`,
      [rideId],
    );
    return result.rowCount === 1;
  }
}
