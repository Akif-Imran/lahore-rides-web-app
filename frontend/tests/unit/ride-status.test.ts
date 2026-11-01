import { describe, expect, it } from 'vitest';
import { POLL_INTERVAL_MS } from '@/lib/config';
import { ApiError } from '@/lib/errors';
import {
  ERROR_POLL_INTERVAL_MS,
  riderCanCancel,
  ridePollInterval,
  stepStates,
} from '@/lib/ride-status';
import type { Ride, RideStatus } from '@/types/api';

const ALL: RideStatus[] = [
  'REQUESTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
];
const rideWith = (status: RideStatus) => ({ status }) as Ride;

describe('stepStates', () => {
  it('marks earlier steps done, the current one current, later ones upcoming', () => {
    expect(stepStates('REQUESTED')).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(stepStates('ASSIGNED')).toEqual(['complete', 'current', 'upcoming', 'upcoming']);
    expect(stepStates('IN_PROGRESS')).toEqual(['complete', 'complete', 'current', 'upcoming']);
    expect(stepStates('COMPLETED')).toEqual(['complete', 'complete', 'complete', 'complete']);
  });

  it('has no progress for rides that left the happy path', () => {
    expect(stepStates('CANCELLED')).toBeNull();
    expect(stepStates('EXPIRED')).toBeNull();
  });
});

describe('riderCanCancel', () => {
  it('allows cancelling only before the trip starts (backend rule)', () => {
    expect(ALL.filter(riderCanCancel)).toEqual(['REQUESTED', 'ASSIGNED']);
  });
});

describe('ridePollInterval', () => {
  it('polls every few seconds while the ride can still change', () => {
    for (const status of ['REQUESTED', 'ASSIGNED', 'IN_PROGRESS'] as const) {
      expect(ridePollInterval({ data: rideWith(status), status: 'success', error: null })).toBe(
        POLL_INTERVAL_MS,
      );
    }
  });

  it('stops polling on a terminal status', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(ridePollInterval({ data: rideWith(status), status: 'success', error: null })).toBe(
        false,
      );
    }
  });

  it('slows down while the server is unreachable, keeping the last data', () => {
    const error = new ApiError({ code: 'NETWORK_ERROR', message: 'x', status: 0 });
    expect(ridePollInterval({ data: rideWith('ASSIGNED'), status: 'error', error })).toBe(
      ERROR_POLL_INTERVAL_MS,
    );
    const serverError = new ApiError({ code: 'INTERNAL_ERROR', message: 'x', status: 500 });
    expect(ridePollInterval({ data: undefined, status: 'error', error: serverError })).toBe(
      ERROR_POLL_INTERVAL_MS,
    );
  });

  it('stops on a definitive error such as 404', () => {
    const error = new ApiError({ code: 'NOT_FOUND', message: 'x', status: 404 });
    expect(ridePollInterval({ data: undefined, status: 'error', error })).toBe(false);
  });

  it('a terminal status wins even if the last poll failed', () => {
    const error = new ApiError({ code: 'NETWORK_ERROR', message: 'x', status: 0 });
    expect(ridePollInterval({ data: rideWith('COMPLETED'), status: 'error', error })).toBe(false);
  });
});
