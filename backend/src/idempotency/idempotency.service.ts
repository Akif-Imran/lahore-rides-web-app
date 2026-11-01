import { Injectable } from '@nestjs/common';
import { ConflictError, IdempotencyKeyReusedError } from '../common/errors/index.js';
import { sha256OfCanonicalJson } from '../common/utils/canonical-json.js';
import type { Queryable } from '../database/queryable.js';
import { IdempotencyRepository } from './idempotency.repository.js';

export type IdempotencyClaim = { kind: 'NEW' } | { kind: 'REPLAY'; status: number; body: unknown };

/**
 * Idempotency for ride creation. The claim, the ride insert and the stored response all
 * happen in the caller's single transaction, so a key is either fully processed with a
 * stored response or not claimed at all; there is no "half-done" state to recover from.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly repository: IdempotencyRepository) {}

  static hashRequest(payload: unknown): string {
    return sha256OfCanonicalJson(payload);
  }

  async claim(
    tx: Queryable,
    riderId: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyClaim> {
    if (await this.repository.tryClaim(tx, riderId, key, requestHash)) return { kind: 'NEW' };

    const existing = await this.repository.find(tx, riderId, key);
    if (existing && existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
    if (!existing || existing.responseStatus === null || existing.responseBody === null) {
      // Unreachable while claim and response share one transaction; kept as a safe answer
      // (retry) should a future change ever split them.
      throw new ConflictError('This request is still being processed. Please retry.', {
        retryable: true,
      });
    }
    return { kind: 'REPLAY', status: existing.responseStatus, body: existing.responseBody };
  }

  async complete(
    tx: Queryable,
    riderId: string,
    key: string,
    response: { status: number; body: unknown; rideId: string },
  ): Promise<void> {
    await this.repository.saveResponse(tx, riderId, key, response);
  }
}
