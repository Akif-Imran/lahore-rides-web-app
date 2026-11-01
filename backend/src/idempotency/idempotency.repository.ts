import { Injectable } from '@nestjs/common';
import type { Queryable } from '../database/queryable.js';

export interface IdempotencyRecord {
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  rideId: string | null;
}

@Injectable()
export class IdempotencyRepository {
  /**
   * Claims (rider, key). If another transaction holds an uncommitted claim on the same key,
   * Postgres blocks this INSERT until that transaction ends: on commit we get 0 rows (and
   * then read its stored response), on rollback our INSERT proceeds as the new owner.
   */
  async tryClaim(
    tx: Queryable,
    riderId: string,
    key: string,
    requestHash: string,
  ): Promise<boolean> {
    const result = await tx.query(
      `INSERT INTO idempotency_keys (rider_id, key, request_hash) VALUES ($1, $2, $3)
       ON CONFLICT (rider_id, key) DO NOTHING`,
      [riderId, key, requestHash],
    );
    return result.rowCount === 1;
  }

  async find(tx: Queryable, riderId: string, key: string): Promise<IdempotencyRecord | null> {
    const { rows } = await tx.query<{
      request_hash: string;
      response_status: number | null;
      response_body: unknown;
      ride_id: string | null;
    }>(
      `SELECT request_hash, response_status, response_body, ride_id
         FROM idempotency_keys WHERE rider_id = $1 AND key = $2`,
      [riderId, key],
    );
    const row = rows[0];
    return row
      ? {
          requestHash: row.request_hash,
          responseStatus: row.response_status,
          responseBody: row.response_body,
          rideId: row.ride_id,
        }
      : null;
  }

  async saveResponse(
    tx: Queryable,
    riderId: string,
    key: string,
    response: { status: number; body: unknown; rideId: string },
  ): Promise<void> {
    await tx.query(
      `UPDATE idempotency_keys SET response_status = $3, response_body = $4::jsonb, ride_id = $5
        WHERE rider_id = $1 AND key = $2`,
      [riderId, key, response.status, JSON.stringify(response.body), response.rideId],
    );
  }
}
