import type { Response } from 'supertest';
import {
  accept,
  asRider,
  cancel,
  createAssignedRide,
  createRequestedRide,
  expectError,
  start,
} from './helpers/api.js';
import {
  assertInvariants,
  assignmentsFor,
  driverAvailability,
  resetDatabase,
  rideRow,
} from './helpers/db.js';
import { createDriver, createDrivers, createRider } from './helpers/factories.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

/** Each race is repeated to flush out timing-dependent flakiness (blueprint 5.5, test 8). */
const ITERATIONS = 20;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

async function raceTenDriversForOneRide(app: TestApp): Promise<void> {
  const rider = await createRider(app.pool);
  const drivers = await createDrivers(app.pool, 10);
  const ride = await createRequestedRide(app.http, rider);

  const responses = await Promise.all(drivers.map((driver) => accept(app.http, ride.id, driver)));

  const winners = responses.filter((res) => res.status === 200);
  expect(winners).toHaveLength(1);
  for (const loser of responses.filter((res) => res.status !== 200)) {
    expectError(loser, 409, 'RIDE_ALREADY_ASSIGNED');
  }
  const winner = winners[0]?.body.driver.id as string;
  expect(await rideRow(app.pool, ride.id)).toMatchObject({
    status: 'ASSIGNED',
    driver_id: winner,
    version: 2,
  });
  expect(await assignmentsFor(app.pool, ride.id)).toEqual([
    { driver_id: winner, status: 'ACTIVE', ended_at: null },
  ]);
  for (const driver of drivers) {
    expect(await driverAvailability(app.pool, driver)).toBe(
      driver === winner ? 'BUSY' : 'AVAILABLE',
    );
  }
  await assertInvariants(app.pool);
}

describe('concurrent driver acceptance (blueprint test 8)', () => {
  it(`exactly one of 10 drivers wins the same ride, ${ITERATIONS} times in a row`, async () => {
    for (let i = 0; i < ITERATIONS; i++) await raceTenDriversForOneRide(t);
  });

  it('still has exactly one winner when requests outnumber database connections', async () => {
    // 10 concurrent accepts, 3 connections: requests queue for the pool as well as the lock.
    const small = await createTestApp({ env: { DB_POOL_MAX: '3' } });
    try {
      for (let i = 0; i < 5; i++) await raceTenDriversForOneRide(small);
    } finally {
      await small.close();
    }
  });

  it('blocks a second accepter on the ride row lock, then it sees the committed winner (sequence 4.5)', async () => {
    const rider = await createRider(t.pool);
    const [driverA, driverB] = await createDrivers(t.pool, 2);
    const ride = await createRequestedRide(t.http, rider);

    // Play "driver B's transaction" by hand: take the ride lock and hold it.
    const tx = await t.pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query('SELECT id FROM rides WHERE id = $1 FOR UPDATE', [ride.id]);

      const pending = accept(t.http, ride.id, driverA as string).then((res) => res);

      // Prove driver A's request is really waiting on our row lock, not racing past it.
      await waitFor(async () => {
        const { rows } = await t.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE application_name = 'ride-booking-api' AND wait_event_type = 'Lock'`,
        );
        return (rows[0]?.n ?? 0) >= 1;
      });

      // Driver B wins and commits, exactly as RidesService.accept would.
      await tx.query(
        `UPDATE rides SET status = 'ASSIGNED', driver_id = $2, assigned_at = now(), version = version + 1
          WHERE id = $1 AND status = 'REQUESTED'`,
        [ride.id, driverB],
      );
      await tx.query(`UPDATE drivers SET availability = 'BUSY' WHERE id = $1`, [driverB]);
      await tx.query('INSERT INTO ride_assignments (ride_id, driver_id) VALUES ($1, $2)', [
        ride.id,
        driverB,
      ]);
      await tx.query('COMMIT');

      // A's SELECT ... FOR UPDATE is granted, re-reads the committed row and loses cleanly.
      expectError(await pending, 409, 'RIDE_ALREADY_ASSIGNED');
    } finally {
      tx.release();
    }
    expect(await driverAvailability(t.pool, driverA as string)).toBe('AVAILABLE');
    await assertInvariants(t.pool);
  });
});

describe('one driver, two rides at once (blueprint test 9)', () => {
  it(`the driver ends up on exactly one ride, ${ITERATIONS} times in a row`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const driver = await createDriver(t.pool);
      const rideA = await createRequestedRide(t.http, await createRider(t.pool));
      const rideB = await createRequestedRide(t.http, await createRider(t.pool));

      const responses = await Promise.all([
        accept(t.http, rideA.id, driver),
        accept(t.http, rideB.id, driver),
      ]);

      expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
      const loser = responses.find((res) => res.status !== 200);
      if (!loser) throw new Error('expected one accept to lose');
      expect(expectError(loser, 409, 'DRIVER_UNAVAILABLE').details).toEqual({ reason: 'BUSY' });
      const statuses = [
        (await rideRow(t.pool, rideA.id)).status,
        (await rideRow(t.pool, rideB.id)).status,
      ];
      expect(statuses.sort()).toEqual(['ASSIGNED', 'REQUESTED']);
      expect(await driverAvailability(t.pool, driver)).toBe('BUSY');
      await assertInvariants(t.pool);
    }
  });
});

describe('accept vs cancel races (blueprint test 10)', () => {
  it(`accept racing a rider cancel always ends consistent, ${ITERATIONS} times in a row`, async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < ITERATIONS; i++) {
      const rider = await createRider(t.pool);
      const driver = await createDriver(t.pool);
      const ride = await createRequestedRide(t.http, rider);

      // Alternate which request is sent first so both interleavings get a chance to occur.
      const sendAccept = () => accept(t.http, ride.id, driver);
      const sendCancel = () => cancel(t.http, ride.id, asRider(rider));
      const [accepted, cancelled] =
        i % 2 === 0
          ? await Promise.all([sendAccept(), sendCancel()])
          : await Promise.all([sendCancel(), sendAccept()]).then(([c, a]) => [a, c] as const);

      // A rider may cancel both REQUESTED and ASSIGNED rides, so the cancel always wins in
      // the end. What matters is that the two orders leave fully consistent states:
      const row = await rideRow(t.pool, ride.id);
      expect(cancelled.status).toBe(200);
      expect(row.status).toBe('CANCELLED');
      expect(row.cancelled_by).toBe('RIDER');
      if (accepted.status === 200) {
        // accept committed first: the cancel then ended the assignment and freed the driver
        outcomes.add('accept-then-cancel');
        expect(row.driver_id).toBe(driver);
        expect(await assignmentsFor(t.pool, ride.id)).toEqual([
          expect.objectContaining({
            driver_id: driver,
            status: 'CANCELLED',
            ended_at: expect.any(Date),
          }),
        ]);
      } else {
        // cancel committed first: the accept saw a CANCELLED ride
        outcomes.add('cancel-then-accept');
        expectError(accepted, 409, 'INVALID_STATE_TRANSITION');
        expect(row.driver_id).toBeNull();
        expect(await assignmentsFor(t.pool, ride.id)).toEqual([]);
      }
      expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
      await assertInvariants(t.pool);
    }
    // Not asserted (timing-dependent), but useful when reading the test output.
    console.info(`accept/cancel race outcomes seen: ${[...outcomes].join(', ')}`);
  });

  // The random race above cannot choose its interleaving. These two force each order exactly:
  // hold the ride's row lock, queue the two requests behind it in a chosen order (verified via
  // pg_stat_activity), then release. Postgres grants queued row-lock waiters in arrival order.
  it('interleaving 1: accept queued before cancel -> accept wins, then the cancel frees the driver', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createRequestedRide(t.http, rider);

    const [accepted, cancelled] = await queueBehindRideLock(t, ride.id, [
      () => accept(t.http, ride.id, driver),
      () => cancel(t.http, ride.id, asRider(rider)),
    ]);

    expect(accepted?.status).toBe(200);
    expect(cancelled?.status).toBe(200);
    expect(cancelled?.body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'RIDER' });
    expect(await assignmentsFor(t.pool, ride.id)).toEqual([
      expect.objectContaining({ driver_id: driver, status: 'CANCELLED' }),
    ]);
    expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
    await assertInvariants(t.pool);
  });

  it('interleaving 2: cancel queued before accept -> cancel wins, accept is rejected', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createRequestedRide(t.http, rider);

    const [cancelled, accepted] = await queueBehindRideLock(t, ride.id, [
      () => cancel(t.http, ride.id, asRider(rider)),
      () => accept(t.http, ride.id, driver),
    ]);

    expect(cancelled?.status).toBe(200);
    if (!accepted) throw new Error('missing accept response');
    expectError(accepted, 409, 'INVALID_STATE_TRANSITION');
    expect(await rideRow(t.pool, ride.id)).toMatchObject({ status: 'CANCELLED', driver_id: null });
    expect(await assignmentsFor(t.pool, ride.id)).toEqual([]);
    expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
    await assertInvariants(t.pool);
  });

  it(`start racing a cancel: exactly one succeeds, never both, ${ITERATIONS} times in a row`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const rider = await createRider(t.pool);
      const driver = await createDriver(t.pool);
      const ride = await createAssignedRide(t.http, rider, driver);

      const [started, cancelled] = await Promise.all([
        start(t.http, ride.id, driver),
        cancel(t.http, ride.id, asRider(rider)),
      ]);

      const successes = [started, cancelled].filter((res) => res.status === 200);
      expect(successes).toHaveLength(1);
      const row = await rideRow(t.pool, ride.id);
      if (started.status === 200) {
        expectError(cancelled, 409, 'INVALID_STATE_TRANSITION');
        expect(row.status).toBe('IN_PROGRESS');
        expect(await driverAvailability(t.pool, driver)).toBe('BUSY');
      } else {
        expectError(started, 409, 'INVALID_STATE_TRANSITION');
        expect(row.status).toBe('CANCELLED');
        expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
      }
      await assertInvariants(t.pool);
    }
  });
});

/** Number of API database sessions currently blocked waiting for a lock. */
async function lockWaiters(app: TestApp): Promise<number> {
  const { rows } = await app.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE application_name = 'ride-booking-api' AND wait_event_type = 'Lock'`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Holds the ride's row lock, sends each request in order (waiting until it is blocked on the
 * lock before sending the next), then releases the lock and returns the responses in order.
 */
async function queueBehindRideLock(
  app: TestApp,
  rideId: string,
  requests: Array<() => PromiseLike<Response>>,
): Promise<Response[]> {
  const holder = await app.pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM rides WHERE id = $1 FOR UPDATE', [rideId]);
    const pending: Array<Promise<Response>> = [];
    for (const [index, send] of requests.entries()) {
      pending.push(Promise.resolve(send()));
      await waitFor(async () => (await lockWaiters(app)) >= index + 1);
    }
    await holder.query('ROLLBACK');
    return await Promise.all(pending);
  } finally {
    holder.release();
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Condition not met in time');
}
