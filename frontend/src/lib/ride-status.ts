import { isTerminalStatus, type Ride, type RideStatus } from '@/types/api';
import { POLL_INTERVAL_MS } from './config';
import { isTransientError } from './errors';

export interface StatusCopy {
  title: string;
  description: string;
}

/** Rider-facing copy for each status. */
export const RIDER_STATUS_COPY: Record<RideStatus, StatusCopy> = {
  REQUESTED: {
    title: 'Looking for a driver',
    description: 'We have sent your request to drivers nearby.',
  },
  ASSIGNED: { title: 'Driver on the way', description: 'Your driver is heading to the pickup.' },
  IN_PROGRESS: { title: 'On trip', description: 'Enjoy the ride.' },
  COMPLETED: { title: 'Trip completed', description: 'Thanks for riding with us.' },
  CANCELLED: { title: 'Ride cancelled', description: 'This ride was cancelled.' },
  EXPIRED: {
    title: 'No driver found',
    description: 'No driver accepted your request in time. You were not charged.',
  },
};

export const STATUS_STEPS = [
  { status: 'REQUESTED', label: 'Requested' },
  { status: 'ASSIGNED', label: 'Driver assigned' },
  { status: 'IN_PROGRESS', label: 'On trip' },
  { status: 'COMPLETED', label: 'Completed' },
] as const satisfies readonly { status: RideStatus; label: string }[];

export type StepState = 'complete' | 'current' | 'upcoming';

/** Progress of the happy path; `null` for CANCELLED/EXPIRED, which leave it. */
export function stepStates(status: RideStatus): StepState[] | null {
  const index = STATUS_STEPS.findIndex((step) => step.status === status);
  if (index === -1) return null;
  return STATUS_STEPS.map((_, i) => {
    if (i < index) return 'complete';
    if (i === index) return status === 'COMPLETED' ? 'complete' : 'current';
    return 'upcoming';
  });
}

/** Mirrors the backend rule: a rider may cancel only before the trip starts. */
export function riderCanCancel(status: RideStatus): boolean {
  return status === 'REQUESTED' || status === 'ASSIGNED';
}

/** Poll interval while the backend is unreachable, after the query's own retries gave up. */
export const ERROR_POLL_INTERVAL_MS = 10_000;

export interface PollableState {
  data: Ride | undefined;
  status: 'pending' | 'error' | 'success';
  error: unknown;
}

/**
 * Ride status polling policy (blueprint 4.4):
 * - stop for good on a terminal status;
 * - stop on a definitive error (404, 403, ...);
 * - slow down while the server is unreachable (each fetch already retries with backoff);
 * - otherwise every POLL_INTERVAL_MS. Hidden tabs are paused by TanStack Query itself.
 */
export function ridePollInterval(state: PollableState): number | false {
  if (state.data && isTerminalStatus(state.data.status)) return false;
  if (state.status === 'error') {
    return isTransientError(state.error) ? ERROR_POLL_INTERVAL_MS : false;
  }
  return POLL_INTERVAL_MS;
}
