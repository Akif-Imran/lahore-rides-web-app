import {
  DomainError,
  ForbiddenError,
  InvalidStateTransitionError,
  RideAlreadyAssignedError,
} from '../common/errors/index.js';
import {
  assertTransition,
  canTransition,
  decideAccept,
  decideCancel,
  decideComplete,
  decideStart,
  type RideActor,
  type RideStateView,
  type TransitionDecision,
} from './ride-state-machine.js';
import {
  ACTIVE_RIDE_STATUSES,
  isTerminalStatus,
  RIDE_STATUSES,
  TERMINAL_RIDE_STATUSES,
  type RideStatus,
} from './ride-status.js';

const ACTORS: readonly RideActor[] = ['RIDER', 'ASSIGNED_DRIVER', 'DRIVER', 'SYSTEM'];

// The specification, written out independently of TRANSITIONS so this test is not a tautology.
const PERMITTED: ReadonlyArray<readonly [RideStatus, RideStatus, RideActor]> = [
  ['REQUESTED', 'ASSIGNED', 'DRIVER'],
  ['REQUESTED', 'CANCELLED', 'RIDER'],
  ['REQUESTED', 'EXPIRED', 'SYSTEM'],
  ['ASSIGNED', 'IN_PROGRESS', 'ASSIGNED_DRIVER'],
  ['ASSIGNED', 'CANCELLED', 'RIDER'],
  ['ASSIGNED', 'CANCELLED', 'ASSIGNED_DRIVER'],
  ['IN_PROGRESS', 'COMPLETED', 'ASSIGNED_DRIVER'],
];

const isPermitted = (from: RideStatus, to: RideStatus, actor: RideActor) =>
  PERMITTED.some(([f, t, a]) => f === from && t === to && a === actor);
const isLegalEdge = (from: RideStatus, to: RideStatus) =>
  PERMITTED.some(([f, t]) => f === from && t === to);

const ALL_COMBINATIONS = RIDE_STATUSES.flatMap((from) =>
  RIDE_STATUSES.flatMap((to) => ACTORS.map((actor) => [from, to, actor] as const)),
);

describe('ride statuses', () => {
  it('partitions every status into active or terminal', () => {
    const active: readonly RideStatus[] = ACTIVE_RIDE_STATUSES;
    const terminal: readonly RideStatus[] = TERMINAL_RIDE_STATUSES;
    expect([...active, ...terminal].sort()).toEqual([...RIDE_STATUSES].sort());
    expect(active.filter((status) => terminal.includes(status))).toEqual([]);
  });

  it.each(RIDE_STATUSES)('%s: terminal states have no exits, active states have some', (from) => {
    const exits = RIDE_STATUSES.filter((to) => canTransition(from, to));
    expect(isTerminalStatus(from)).toBe(exits.length === 0);
  });
});

describe('canTransition', () => {
  it.each(RIDE_STATUSES.flatMap((from) => RIDE_STATUSES.map((to) => [from, to] as const)))(
    '%s -> %s matches the specification',
    (from, to) => {
      expect(canTransition(from, to)).toBe(isLegalEdge(from, to));
    },
  );
});

describe('assertTransition: every status x status x actor', () => {
  it.each(ALL_COMBINATIONS)('%s -> %s by %s', (from, to, actor) => {
    const attempt = () => assertTransition(from, to, actor);
    if (isPermitted(from, to, actor)) {
      expect(attempt).not.toThrow();
    } else if (isLegalEdge(from, to)) {
      // Legal transition, wrong party: permission problem.
      expect(attempt).toThrow(ForbiddenError);
    } else {
      // Impossible transition for anyone: state problem (checked before permission).
      expect(attempt).toThrow(InvalidStateTransitionError);
    }
  });

  it('reports the current and attempted status (blueprint error example)', () => {
    let caught: unknown;
    try {
      assertTransition('CANCELLED', 'COMPLETED', 'ASSIGNED_DRIVER');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidStateTransitionError);
    expect(caught).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      httpStatus: 409,
      message: 'Ride cannot move from CANCELLED to COMPLETED',
      details: { currentStatus: 'CANCELLED', attempted: 'COMPLETED' },
    });
  });

  it('uses 403 for a legal transition attempted by the wrong party', () => {
    expect(() => assertTransition('ASSIGNED', 'IN_PROGRESS', 'DRIVER')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', httpStatus: 403 }),
    );
  });
});

type Expected = TransitionDecision | (new (...args: never[]) => DomainError);

function expectDecision(decide: () => TransitionDecision, expected: Expected): void {
  if (typeof expected === 'string') {
    expect(decide()).toBe(expected);
  } else {
    expect(decide).toThrow(expected);
  }
}

const DRIVER_A = 'driver-a';
const DRIVER_B = 'driver-b';
const ride = (status: RideStatus, driverId: string | null): RideStateView => ({
  id: 'ride-1',
  status,
  driverId,
});

describe('decideAccept', () => {
  it.each<[RideStatus, string | null, string, Expected]>([
    ['REQUESTED', null, DRIVER_A, 'APPLY'],
    // Retry or double click by the winner: idempotent.
    ['ASSIGNED', DRIVER_A, DRIVER_A, 'ALREADY_DONE'],
    // Lost the race: someone else holds the ride.
    ['ASSIGNED', DRIVER_A, DRIVER_B, RideAlreadyAssignedError],
    ['IN_PROGRESS', DRIVER_A, DRIVER_B, RideAlreadyAssignedError],
    // Own trip already started: accepting again is not a meaningful replay.
    ['IN_PROGRESS', DRIVER_A, DRIVER_A, InvalidStateTransitionError],
    ['COMPLETED', DRIVER_A, DRIVER_B, InvalidStateTransitionError],
    ['CANCELLED', null, DRIVER_A, InvalidStateTransitionError],
    ['CANCELLED', DRIVER_A, DRIVER_B, InvalidStateTransitionError],
    ['EXPIRED', null, DRIVER_A, InvalidStateTransitionError],
  ])('%s ride held by %s, accepted by %s -> %s', (status, holder, caller, expected) => {
    expectDecision(() => decideAccept(ride(status, holder), caller), expected);
  });

  it('names the ride in RIDE_ALREADY_ASSIGNED', () => {
    expect(() => decideAccept(ride('ASSIGNED', DRIVER_A), DRIVER_B)).toThrow(
      expect.objectContaining({ code: 'RIDE_ALREADY_ASSIGNED', details: { rideId: 'ride-1' } }),
    );
  });
});

describe('decideStart', () => {
  it.each<[RideStatus, RideActor, Expected]>([
    ['ASSIGNED', 'ASSIGNED_DRIVER', 'APPLY'],
    ['IN_PROGRESS', 'ASSIGNED_DRIVER', 'ALREADY_DONE'],
    ['ASSIGNED', 'DRIVER', ForbiddenError],
    ['ASSIGNED', 'RIDER', ForbiddenError],
    ['REQUESTED', 'DRIVER', InvalidStateTransitionError],
    ['COMPLETED', 'ASSIGNED_DRIVER', InvalidStateTransitionError],
    ['CANCELLED', 'ASSIGNED_DRIVER', InvalidStateTransitionError],
  ])('%s by %s -> %s', (status, actor, expected) => {
    expectDecision(() => decideStart(ride(status, DRIVER_A), actor), expected);
  });
});

describe('decideCancel', () => {
  it.each<[RideStatus, RideActor, Expected]>([
    ['REQUESTED', 'RIDER', 'APPLY'],
    ['REQUESTED', 'DRIVER', ForbiddenError],
    ['ASSIGNED', 'RIDER', 'APPLY'],
    ['ASSIGNED', 'ASSIGNED_DRIVER', 'APPLY'],
    ['ASSIGNED', 'DRIVER', ForbiddenError],
    // Once the trip has started it can no longer be cancelled.
    ['IN_PROGRESS', 'RIDER', InvalidStateTransitionError],
    ['IN_PROGRESS', 'ASSIGNED_DRIVER', InvalidStateTransitionError],
    ['COMPLETED', 'RIDER', InvalidStateTransitionError],
    ['EXPIRED', 'RIDER', InvalidStateTransitionError],
    // Repeated cancel by a participant: idempotent.
    ['CANCELLED', 'RIDER', 'ALREADY_DONE'],
    ['CANCELLED', 'ASSIGNED_DRIVER', 'ALREADY_DONE'],
    ['CANCELLED', 'DRIVER', InvalidStateTransitionError],
  ])('%s by %s -> %s', (status, actor, expected) => {
    expectDecision(() => decideCancel(ride(status, DRIVER_A), actor), expected);
  });
});

describe('decideComplete', () => {
  it.each<[RideStatus, RideActor, Expected]>([
    ['IN_PROGRESS', 'ASSIGNED_DRIVER', 'APPLY'],
    ['COMPLETED', 'ASSIGNED_DRIVER', 'ALREADY_DONE'],
    ['REQUESTED', 'DRIVER', InvalidStateTransitionError],
    // Must be started first.
    ['ASSIGNED', 'ASSIGNED_DRIVER', InvalidStateTransitionError],
    ['CANCELLED', 'ASSIGNED_DRIVER', InvalidStateTransitionError],
    ['EXPIRED', 'DRIVER', InvalidStateTransitionError],
    ['IN_PROGRESS', 'DRIVER', ForbiddenError],
    ['IN_PROGRESS', 'RIDER', ForbiddenError],
  ])('%s by %s -> %s', (status, actor, expected) => {
    expectDecision(() => decideComplete(ride(status, DRIVER_A), actor), expected);
  });
});
