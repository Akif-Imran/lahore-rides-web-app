import { describe, expect, it } from 'vitest';
import {
  type BookingInputs,
  canRequest,
  deriveBookingState,
  type EstimateStatus,
} from '@/lib/booking-state';
import { ApiError } from '@/lib/errors';
import type { CategoryEstimate, FareEstimateResponse } from '@/types/api';

const breakdown = { base: 150, distance: 360, time: 130, surge: 1, minimumFareApplied: false };

function category(
  name: CategoryEstimate['category'],
  total: number,
  etaMinutes: number | null,
): CategoryEstimate {
  return { category: name, currency: 'PKR', total, breakdown, etaMinutes };
}

function estimateOf(economyEta: number | null, comfortEta: number | null): EstimateStatus {
  const data: FareEstimateResponse = {
    distanceMeters: 9000,
    durationSeconds: 1350,
    estimates: [category('ECONOMY', 640, economyEta), category('COMFORT', 1040, comfortEta)],
  };
  return { status: 'success', data };
}

const base: BookingInputs = {
  tripValid: true,
  category: 'ECONOMY',
  estimate: estimateOf(4, 7),
  request: { status: 'idle' },
  hasActiveRide: false,
  rateLimitSecondsLeft: 0,
};

const derive = (overrides: Partial<BookingInputs>) => deriveBookingState({ ...base, ...overrides });

describe('deriveBookingState', () => {
  it('is idle while the trip is incomplete or invalid', () => {
    expect(derive({ tripValid: false, estimate: { status: 'idle' } })).toEqual({ kind: 'idle' });
    // Even with a (stale) estimate around, an invalid trip cannot be requested.
    expect(derive({ tripValid: false }).kind).toBe('idle');
  });

  it('is estimating while the estimate loads or is debouncing', () => {
    expect(derive({ estimate: { status: 'loading' } })).toEqual({ kind: 'estimating' });
    expect(derive({ estimate: { status: 'idle' } })).toEqual({ kind: 'estimating' });
  });

  it('surfaces an estimate failure', () => {
    const error = new ApiError({ code: 'NETWORK_ERROR', message: 'down', status: 0 });
    expect(derive({ estimate: { status: 'error', error } })).toEqual({
      kind: 'estimate-error',
      error,
    });
  });

  it('treats a response without the selected category as an estimate error', () => {
    const estimate: EstimateStatus = {
      status: 'success',
      data: { distanceMeters: 1, durationSeconds: 1, estimates: [category('COMFORT', 400, 3)] },
    };
    expect(derive({ estimate }).kind).toBe('estimate-error');
  });

  it('reports no drivers for the selected category, with the other category as alternative', () => {
    const state = derive({ estimate: estimateOf(null, 6) });
    expect(state).toMatchObject({
      kind: 'no-drivers',
      estimate: { category: 'ECONOMY', etaMinutes: null },
      alternative: { category: 'COMFORT', etaMinutes: 6 },
    });
    expect(canRequest(state)).toBe(false);
  });

  it('offers no alternative when no category has a driver', () => {
    expect(derive({ estimate: estimateOf(null, null) })).toMatchObject({
      kind: 'no-drivers',
      alternative: null,
    });
  });

  it('is ready with the selected category estimate', () => {
    const state = derive({ category: 'COMFORT' });
    expect(state).toMatchObject({
      kind: 'ready',
      estimate: { category: 'COMFORT', total: 1040 },
      blockedBy: null,
      requestError: null,
    });
    expect(canRequest(state)).toBe(true);
  });

  it('blocks requesting while the rider has an active ride', () => {
    const state = derive({ hasActiveRide: true });
    expect(state).toMatchObject({ kind: 'ready', blockedBy: 'active-ride' });
    expect(canRequest(state)).toBe(false);
  });

  it('blocks requesting during a rate-limit countdown and hides the 429 as an error', () => {
    const error = new ApiError({ code: 'RATE_LIMITED', message: 'slow down', status: 429 });
    const state = derive({ rateLimitSecondsLeft: 12, request: { status: 'error', error } });
    expect(state).toMatchObject({ kind: 'ready', blockedBy: 'rate-limited', requestError: null });
    expect(canRequest(state)).toBe(false);
  });

  it('allows a retry after a failed request and exposes the error', () => {
    const error = new ApiError({ code: 'NETWORK_ERROR', message: 'down', status: 0 });
    const state = derive({ request: { status: 'error', error } });
    expect(state).toMatchObject({ kind: 'ready', blockedBy: null, requestError: error });
    expect(canRequest(state)).toBe(true);
  });

  it('is requesting while the request is in flight, whatever the estimate does', () => {
    expect(derive({ request: { status: 'pending' } })).toMatchObject({
      kind: 'requesting',
      estimate: { category: 'ECONOMY' },
    });
    expect(derive({ request: { status: 'pending' }, estimate: { status: 'loading' } })).toEqual({
      kind: 'requesting',
      estimate: null,
    });
    expect(canRequest(derive({ request: { status: 'pending' } }))).toBe(false);
  });

  it('is active once the ride was created, taking precedence over everything else', () => {
    expect(
      derive({
        request: { status: 'success', rideId: 'r1' },
        tripValid: false,
        hasActiveRide: true,
      }),
    ).toEqual({ kind: 'active', rideId: 'r1' });
  });
});
