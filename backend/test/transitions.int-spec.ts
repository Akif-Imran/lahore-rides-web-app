import type { Response } from 'supertest';
import type { ErrorCode } from '../src/common/errors/error-codes.js';
import { RideExpiryScheduler } from '../src/rides/ride-expiry.scheduler.js';
import {
  accept,
  asDriver,
  asRider,
  cancel,
  complete,
  createAssignedRide,
  createCompletedRide,
  createInProgressRide,
  createRequestedRide,
  expectError,
  start,
} from './helpers/api.js';
import { assertInvariants, backdateRide, resetDatabase, snapshot } from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { createTestApp, type Http, type TestApp } from './helpers/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

type State = 'REQUESTED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

interface Scenario {
  rideId: string;
  rider: string;
  /** Assigned driver for ASSIGNED and later; an available candidate otherwise. */
  driver: string;
  /** A driver with no relationship to the ride. */
  otherDriver: string;
}

/** Brings a fresh ride into `state` through the public API (and the sweeper for EXPIRED). */
async function rideIn(state: State): Promise<Scenario> {
  const rider = await createRider(t.pool);
  const driver = await createDriver(t.pool);
  const otherDriver = await createDriver(t.pool);
  const make: Record<State, () => Promise<{ id: string }>> = {
    REQUESTED: () => createRequestedRide(t.http, rider),
    ASSIGNED: () => createAssignedRide(t.http, rider, driver),
    IN_PROGRESS: () => createInProgressRide(t.http, rider, driver),
    COMPLETED: () => createCompletedRide(t.http, rider, driver),
    CANCELLED: async () => {
      const ride = await createRequestedRide(t.http, rider);
      expect((await cancel(t.http, ride.id, asRider(rider))).status).toBe(200);
      return ride;
    },
    EXPIRED: async () => {
      const ride = await createRequestedRide(t.http, rider);
      await backdateRide(t.pool, ride.id, t.config.rides.requestTtlSeconds + 60);
      expect(await t.app.get(RideExpiryScheduler).sweep()).toBe(1);
      return ride;
    },
  };
  const ride = await make[state]();
  return { rideId: ride.id, rider, driver, otherDriver };
}

type Action = (http: Http, s: Scenario) => PromiseLike<Response>;
const by = {
  completeByDriver: ((http, s) => complete(http, s.rideId, s.driver)) as Action,
  completeByOther: ((http, s) => complete(http, s.rideId, s.otherDriver)) as Action,
  startByDriver: ((http, s) => start(http, s.rideId, s.driver)) as Action,
  startByOther: ((http, s) => start(http, s.rideId, s.otherDriver)) as Action,
  acceptByDriver: ((http, s) => accept(http, s.rideId, s.driver)) as Action,
  acceptByOther: ((http, s) => accept(http, s.rideId, s.otherDriver)) as Action,
  cancelByRider: ((http, s) => cancel(http, s.rideId, asRider(s.rider))) as Action,
  cancelByDriver: ((http, s) => cancel(http, s.rideId, asDriver(s.driver))) as Action,
  cancelByOther: ((http, s) => cancel(http, s.rideId, asDriver(s.otherDriver))) as Action,
};

describe('invalid ride-state transitions are rejected and change nothing (blueprint test 11)', () => {
  it.each<[string, State, Action, number, ErrorCode]>([
    // Impossible for anyone: 409 INVALID_STATE_TRANSITION.
    [
      'complete a REQUESTED ride',
      'REQUESTED',
      by.completeByDriver,
      409,
      'INVALID_STATE_TRANSITION',
    ],
    [
      'complete an ASSIGNED ride (not started)',
      'ASSIGNED',
      by.completeByDriver,
      409,
      'INVALID_STATE_TRANSITION',
    ],
    [
      'complete a CANCELLED ride',
      'CANCELLED',
      by.completeByDriver,
      409,
      'INVALID_STATE_TRANSITION',
    ],
    ['start a REQUESTED ride', 'REQUESTED', by.startByDriver, 409, 'INVALID_STATE_TRANSITION'],
    ['start a COMPLETED ride', 'COMPLETED', by.startByDriver, 409, 'INVALID_STATE_TRANSITION'],
    [
      'rider cancels an IN_PROGRESS ride',
      'IN_PROGRESS',
      by.cancelByRider,
      409,
      'INVALID_STATE_TRANSITION',
    ],
    [
      'driver cancels an IN_PROGRESS ride',
      'IN_PROGRESS',
      by.cancelByDriver,
      409,
      'INVALID_STATE_TRANSITION',
    ],
    ['cancel a COMPLETED ride', 'COMPLETED', by.cancelByRider, 409, 'INVALID_STATE_TRANSITION'],
    ['cancel an EXPIRED ride', 'EXPIRED', by.cancelByRider, 409, 'INVALID_STATE_TRANSITION'],
    ['accept a CANCELLED ride', 'CANCELLED', by.acceptByDriver, 409, 'INVALID_STATE_TRANSITION'],
    ['accept an EXPIRED ride', 'EXPIRED', by.acceptByDriver, 409, 'INVALID_STATE_TRANSITION'],
    ['accept a COMPLETED ride', 'COMPLETED', by.acceptByOther, 409, 'INVALID_STATE_TRANSITION'],
    // Legal transition, wrong party: 403 FORBIDDEN.
    ['start by a driver who is not assigned', 'ASSIGNED', by.startByOther, 403, 'FORBIDDEN'],
    [
      'complete by a driver who is not assigned',
      'IN_PROGRESS',
      by.completeByOther,
      403,
      'FORBIDDEN',
    ],
    ["a driver cancels someone's REQUESTED ride", 'REQUESTED', by.cancelByOther, 403, 'FORBIDDEN'],
    [
      'an unrelated driver cancels an ASSIGNED ride',
      'ASSIGNED',
      by.cancelByOther,
      403,
      'FORBIDDEN',
    ],
    // Someone else holds the ride.
    [
      'another driver accepts an ASSIGNED ride',
      'ASSIGNED',
      by.acceptByOther,
      409,
      'RIDE_ALREADY_ASSIGNED',
    ],
    [
      'another driver accepts an IN_PROGRESS ride',
      'IN_PROGRESS',
      by.acceptByOther,
      409,
      'RIDE_ALREADY_ASSIGNED',
    ],
  ])('%s -> %i %s', async (_label, state, action, status, code) => {
    const scenario = await rideIn(state);
    const drivers = [scenario.driver, scenario.otherDriver];
    const before = await snapshot(t.pool, scenario.rideId, drivers);

    const res = await action(t.http, scenario);

    const error = expectError(res, status, code);
    if (code === 'INVALID_STATE_TRANSITION') {
      expect(error.details).toEqual({ currentStatus: state, attempted: expect.any(String) });
    }
    expect(await snapshot(t.pool, scenario.rideId, drivers)).toEqual(before);
    await assertInvariants(t.pool);
  });
});
