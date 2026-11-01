import { ConflictError, IdempotencyKeyReusedError } from '../common/errors/index.js';
import type { Queryable } from '../database/queryable.js';
import type { IdempotencyRecord, IdempotencyRepository } from './idempotency.repository.js';
import { IdempotencyService } from './idempotency.service.js';

const tx = {} as Queryable;
const HASH = 'a'.repeat(64);

function serviceWith(claimed: boolean, existing: IdempotencyRecord | null) {
  const repository = {
    tryClaim: vi.fn(async () => claimed),
    find: vi.fn(async () => existing),
    saveResponse: vi.fn(async () => undefined),
  };
  return {
    repository,
    service: new IdempotencyService(repository as unknown as IdempotencyRepository),
  };
}

describe('IdempotencyService.claim', () => {
  it('returns NEW when this request claims the key', async () => {
    const { service, repository } = serviceWith(true, null);
    await expect(service.claim(tx, 'rider', 'key', HASH)).resolves.toEqual({ kind: 'NEW' });
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('replays the stored response for the same key and body', async () => {
    const body = { id: 'ride-1', status: 'REQUESTED' };
    const { service } = serviceWith(false, {
      requestHash: HASH,
      responseStatus: 201,
      responseBody: body,
      rideId: 'ride-1',
    });
    await expect(service.claim(tx, 'rider', 'key', HASH)).resolves.toEqual({
      kind: 'REPLAY',
      status: 201,
      body,
    });
  });

  it('rejects the same key with a different body (422)', async () => {
    const { service } = serviceWith(false, {
      requestHash: 'b'.repeat(64),
      responseStatus: 201,
      responseBody: {},
      rideId: 'ride-1',
    });
    await expect(service.claim(tx, 'rider', 'key', HASH)).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
  });

  it('answers "retry" rather than guessing if a claimed key has no stored response', async () => {
    const { service } = serviceWith(false, {
      requestHash: HASH,
      responseStatus: null,
      responseBody: null,
      rideId: null,
    });
    await expect(service.claim(tx, 'rider', 'key', HASH)).rejects.toBeInstanceOf(ConflictError);
    const { service: vanished } = serviceWith(false, null);
    await expect(vanished.claim(tx, 'rider', 'key', HASH)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('IdempotencyService.hashRequest', () => {
  it('is independent of key order and sensitive to values', () => {
    const a = IdempotencyService.hashRequest({ category: 'ECONOMY', pickup: { lat: 1, lng: 2 } });
    const b = IdempotencyService.hashRequest({ pickup: { lng: 2, lat: 1 }, category: 'ECONOMY' });
    const c = IdempotencyService.hashRequest({ pickup: { lng: 2, lat: 1 }, category: 'COMFORT' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
