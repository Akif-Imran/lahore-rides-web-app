import {
  ForbiddenError,
  InvalidStateTransitionError,
  RideAlreadyAssignedError,
} from '../common/errors/index.js';
import type { RideStatus } from './ride-status.js';

/**
 * The caller's relationship to a specific ride (see `resolveRideActor`):
 * - RIDER:           the rider who requested this ride
 * - ASSIGNED_DRIVER: the driver currently (or last) assigned to this ride
 * - DRIVER:          any other driver, e.g. one accepting a REQUESTED ride
 * - SYSTEM:          background jobs (request expiry)
 */
export type RideActor = 'RIDER' | 'ASSIGNED_DRIVER' | 'DRIVER' | 'SYSTEM';

/**
 * The single source of truth for legal transitions and who may perform them.
 * Services call into this module; SQL re-enforces the same rules with conditional updates
 * (`WHERE status = <expected>`), so a transition is a compare-and-swap even under races.
 */
export const TRANSITIONS: Readonly<
  Record<RideStatus, Readonly<Partial<Record<RideStatus, readonly RideActor[]>>>>
> = {
  REQUESTED: { ASSIGNED: ['DRIVER'], CANCELLED: ['RIDER'], EXPIRED: ['SYSTEM'] },
  ASSIGNED: { IN_PROGRESS: ['ASSIGNED_DRIVER'], CANCELLED: ['RIDER', 'ASSIGNED_DRIVER'] },
  IN_PROGRESS: { COMPLETED: ['ASSIGNED_DRIVER'] },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return TRANSITIONS[from][to] !== undefined;
}

/**
 * Throws unless `actor` may move a ride from `from` to `to`.
 * State is checked before permission: an impossible transition is a 409 for everyone
 * (e.g. completing a REQUESTED ride), a legal transition by the wrong party is a 403
 * (e.g. a driver who is not assigned trying to start the trip).
 */
export function assertTransition(from: RideStatus, to: RideStatus, actor: RideActor): void {
  const allowedActors = TRANSITIONS[from][to];
  if (!allowedActors) throw new InvalidStateTransitionError(from, to);
  if (!allowedActors.includes(actor)) {
    throw new ForbiddenError(
      `Only ${allowedActors.join(' or ')} may move a ${from} ride to ${to}`,
      {
        currentStatus: from,
        attempted: to,
      },
    );
  }
}

/**
 * APPLY: perform the transition. ALREADY_DONE: the caller's own earlier request already
 * produced this state (a retry or double click), so return the current ride with 200 and
 * change nothing. Lifecycle calls are idempotent for the party that made them.
 */
export type TransitionDecision = 'APPLY' | 'ALREADY_DONE';

export interface RideStateView {
  id: string;
  status: RideStatus;
  driverId: string | null;
}

export function decideAccept(ride: RideStateView, driverId: string): TransitionDecision {
  const heldBySomeoneElse = ride.driverId !== null && ride.driverId !== driverId;
  if (ride.status === 'ASSIGNED' && !heldBySomeoneElse) return 'ALREADY_DONE';
  if ((ride.status === 'ASSIGNED' || ride.status === 'IN_PROGRESS') && heldBySomeoneElse) {
    throw new RideAlreadyAssignedError(ride.id);
  }
  assertTransition(ride.status, 'ASSIGNED', 'DRIVER');
  return 'APPLY';
}

export function decideStart(ride: RideStateView, actor: RideActor): TransitionDecision {
  if (ride.status === 'IN_PROGRESS' && actor === 'ASSIGNED_DRIVER') return 'ALREADY_DONE';
  assertTransition(ride.status, 'IN_PROGRESS', actor);
  return 'APPLY';
}

export function decideCancel(ride: RideStateView, actor: RideActor): TransitionDecision {
  if (ride.status === 'CANCELLED' && (actor === 'RIDER' || actor === 'ASSIGNED_DRIVER')) {
    return 'ALREADY_DONE';
  }
  assertTransition(ride.status, 'CANCELLED', actor);
  return 'APPLY';
}

export function decideComplete(ride: RideStateView, actor: RideActor): TransitionDecision {
  if (ride.status === 'COMPLETED' && actor === 'ASSIGNED_DRIVER') return 'ALREADY_DONE';
  assertTransition(ride.status, 'COMPLETED', actor);
  return 'APPLY';
}
