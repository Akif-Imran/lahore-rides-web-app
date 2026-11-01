import { describe, expect, it } from 'vitest';
import { bookingSchema, formFieldFor, SAME_LOCATION_MESSAGE } from '@/components/booking-form';
import { filterLandmarks } from '@/components/location-picker';
import { LANDMARKS } from '@/lib/landmarks';
import { MAX_QUERY_RETRIES, retryDelay, shouldRetryQuery } from '@/lib/query-client';
import { ApiError } from '@/lib/errors';

describe('bookingSchema', () => {
  const valid = { pickupId: 'liberty-market', destinationId: 'lahore-fort', category: 'ECONOMY' };

  it('accepts two different landmarks and a category', () => {
    expect(bookingSchema.safeParse(valid).success).toBe(true);
  });

  it('requires both locations to be listed landmarks', () => {
    const result = bookingSchema.safeParse({ ...valid, pickupId: '', destinationId: 'atlantis' });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['pickupId', 'destinationId']));
  });

  it('rejects the same pickup and destination on the destination field', () => {
    const result = bookingSchema.safeParse({ ...valid, destinationId: valid.pickupId });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['destinationId'], message: SAME_LOCATION_MESSAGE }),
    ]);
  });

  it('rejects unknown categories', () => {
    expect(bookingSchema.safeParse({ ...valid, category: 'LUXURY' }).success).toBe(false);
  });
});

describe('formFieldFor', () => {
  it('maps backend validation paths to form fields', () => {
    expect(formFieldFor('pickup')).toBe('pickupId');
    expect(formFieldFor('pickup.lat')).toBe('pickupId');
    expect(formFieldFor('destination.name')).toBe('destinationId');
    expect(formFieldFor('category')).toBe('category');
    expect(formFieldFor('idempotencyKey')).toBeNull();
  });
});

describe('filterLandmarks', () => {
  it('matches name or area, case-insensitively, prefix matches first', () => {
    expect(filterLandmarks(LANDMARKS, 'MALL').map((l) => l.name)).toEqual([
      'Mall Road',
      'Emporium Mall',
      'Packages Mall',
    ]);
    expect(filterLandmarks(LANDMARKS, 'walled').map((l) => l.id)).toEqual([
      'lahore-fort',
      'badshahi-mosque',
    ]);
  });

  it('returns everything for an empty query and nothing for no match', () => {
    expect(filterLandmarks(LANDMARKS, '  ')).toHaveLength(LANDMARKS.length);
    expect(filterLandmarks(LANDMARKS, 'karachi')).toEqual([]);
  });
});

describe('query retry policy', () => {
  const network = new ApiError({ code: 'NETWORK_ERROR', message: 'x', status: 0 });
  const notFound = new ApiError({ code: 'NOT_FOUND', message: 'x', status: 404 });

  it('retries transient failures up to the limit with exponential backoff', () => {
    expect(shouldRetryQuery(0, network)).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, network)).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, network)).toBe(false);
    expect([0, 1, 2, 3, 4].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it('never retries a definitive 4xx answer', () => {
    expect(shouldRetryQuery(0, notFound)).toBe(false);
  });
});
