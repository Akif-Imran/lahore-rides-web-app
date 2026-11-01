import type { CategoryEstimate, FareEstimateResponse, RideCategory } from '@/types/api';
import { isApiError } from './errors';

export type EstimateStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; data: FareEstimateResponse };

export type RequestStatus =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; rideId: string };

export interface BookingInputs {
  /** Both landmarks chosen and different (the form's own validation). */
  tripValid: boolean;
  category: RideCategory;
  estimate: EstimateStatus;
  /** The ride request for the *current* trip; a request for an earlier trip is `idle`. */
  request: RequestStatus;
  hasActiveRide: boolean;
  rateLimitSecondsLeft: number;
}

export type BlockReason = 'active-ride' | 'rate-limited';

/**
 * The booking screen's single source of UI state (blueprint 5.4.2:
 * idle → estimating → ready → requesting → active). Derived from form, query and mutation
 * state on every render instead of being tracked in scattered booleans.
 */
export type BookingState =
  | { kind: 'idle' }
  | { kind: 'estimating' }
  | { kind: 'estimate-error'; error: unknown }
  | {
      kind: 'no-drivers';
      estimate: CategoryEstimate;
      /** The other category, when it does have a driver nearby. */
      alternative: CategoryEstimate | null;
    }
  | {
      kind: 'ready';
      estimate: CategoryEstimate;
      blockedBy: BlockReason | null;
      /** Last failed attempt for this trip; retrying reuses its Idempotency-Key. */
      requestError: unknown;
    }
  | { kind: 'requesting'; estimate: CategoryEstimate | null }
  | { kind: 'active'; rideId: string };

export function deriveBookingState(inputs: BookingInputs): BookingState {
  const { request, estimate } = inputs;

  if (request.status === 'success') return { kind: 'active', rideId: request.rideId };

  const selected =
    estimate.status === 'success'
      ? (estimate.data.estimates.find((e) => e.category === inputs.category) ?? null)
      : null;

  if (request.status === 'pending') return { kind: 'requesting', estimate: selected };
  if (!inputs.tripValid) return { kind: 'idle' };
  if (estimate.status === 'idle' || estimate.status === 'loading') return { kind: 'estimating' };
  if (estimate.status === 'error') return { kind: 'estimate-error', error: estimate.error };
  if (!selected) {
    return {
      kind: 'estimate-error',
      error: new Error(`No estimate returned for ${inputs.category}`),
    };
  }

  if (selected.etaMinutes === null) {
    const alternative =
      estimate.data.estimates.find(
        (e) => e.category !== inputs.category && e.etaMinutes !== null,
      ) ?? null;
    return { kind: 'no-drivers', estimate: selected, alternative };
  }

  const blockedBy: BlockReason | null = inputs.hasActiveRide
    ? 'active-ride'
    : inputs.rateLimitSecondsLeft > 0
      ? 'rate-limited'
      : null;

  // A 429 is shown as the countdown (blockedBy), not as an error message.
  const requestError =
    request.status === 'error' &&
    !(isApiError(request.error) && request.error.code === 'RATE_LIMITED')
      ? request.error
      : null;

  return { kind: 'ready', estimate: selected, blockedBy, requestError };
}

export function canRequest(state: BookingState): boolean {
  return state.kind === 'ready' && state.blockedBy === null;
}
