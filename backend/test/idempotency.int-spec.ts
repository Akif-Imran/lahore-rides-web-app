import { randomUUID } from 'node:crypto';
import {
  accept,
  asRider,
  cancel,
  complete,
  createAssignedRide,
  createInProgressRide,
  createRequestedRide,
  expectError,
  requestRide,
} from './helpers/api.js';
import { assertInvariants, assignmentsFor, count, queryOne, resetDatabase } from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { GADDAFI, MODEL_TOWN, tripBody } from './helpers/fixtures.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

const ridesOf = (rider: string) =>
  count(t.pool, 'SELECT 1 FROM rides WHERE rider_id = $1', [rider]);

describe('duplicate requests and retries (blueprint test 12)', () => {
  it('replays the original response for a retried request: one ride, identical body', async () => {
    const rider = await createRider(t.pool);
    const key = randomUUID();

    const first = await requestRide(t.http, rider, { key });
    const retry = await requestRide(t.http, rider, { key });

    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await ridesOf(rider)).toBe(1);
    expect(await count(t.pool, 'SELECT 1 FROM idempotency_keys WHERE rider_id = $1', [rider])).toBe(
      1,
    );
  });

  it('turns 10 parallel identical requests (a double-click storm) into exactly one ride, 10 times', async () => {
    for (let i = 0; i < 10; i++) {
      const rider = await createRider(t.pool);
      const key = randomUUID();

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => requestRide(t.http, rider, { key })),
      );

      expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
      const replays = responses.filter((res) => res.status === 200);
      expect(replays).toHaveLength(9);
      for (const replay of replays) expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(new Set(responses.map((res) => res.body.id)).size).toBe(1);
      expect(await ridesOf(rider)).toBe(1);
    }
    await assertInvariants(t.pool);
  });

  it('allows only one active ride when 10 different keys race for the same rider', async () => {
    const rider = await createRider(t.pool);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => requestRide(t.http, rider)),
    );

    const created = responses.filter((res) => res.status === 201);
    expect(created).toHaveLength(1);
    const createdId = created[0]?.body.id as string;
    for (const res of responses.filter((r) => r.status !== 201)) {
      expect(expectError(res, 409, 'ACTIVE_RIDE_EXISTS').details).toEqual({
        activeRideId: createdId,
      });
    }
    expect(await ridesOf(rider)).toBe(1);
  });

  it('rejects the same key with a different body (422) and creates nothing new', async () => {
    const rider = await createRider(t.pool);
    const key = randomUUID();
    expect((await requestRide(t.http, rider, { key })).status).toBe(201);

    const changed = await requestRide(t.http, rider, {
      key,
      body: tripBody({ category: 'COMFORT' }),
    });

    expectError(changed, 422, 'IDEMPOTENCY_KEY_REUSED');
    expect(await ridesOf(rider)).toBe(1);
  });

  it('rejects a new request while a ride is active (409 ACTIVE_RIDE_EXISTS with its id)', async () => {
    const rider = await createRider(t.pool);
    const active = await createRequestedRide(t.http, rider);

    const second = await requestRide(t.http, rider, {
      body: tripBody({ pickup: GADDAFI, destination: MODEL_TOWN }),
    });

    expect(expectError(second, 409, 'ACTIVE_RIDE_EXISTS').details).toEqual({
      activeRideId: active.id,
    });
  });

  it('scopes keys per rider: two riders may use the same key independently', async () => {
    const key = randomUUID();
    const [a, b] = [await createRider(t.pool), await createRider(t.pool)];
    const resA = await requestRide(t.http, a, { key });
    const resB = await requestRide(t.http, b, { key });
    expect([resA.status, resB.status]).toEqual([201, 201]);
    expect(resA.body.id).not.toBe(resB.body.id);
  });

  it('a request rejected with ACTIVE_RIDE_EXISTS does not consume its key', async () => {
    const rider = await createRider(t.pool);
    const active = await createRequestedRide(t.http, rider);
    const key = randomUUID();
    expect((await requestRide(t.http, rider, { key })).status).toBe(409);

    await cancel(t.http, active.id, asRider(rider));

    // The failed attempt rolled back entirely, so the same key now creates the ride.
    expect((await requestRide(t.http, rider, { key })).status).toBe(201);
  });

  it('replays the original snapshot even after the ride has moved on', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const key = randomUUID();
    const first = await requestRide(t.http, rider, { key });
    await accept(t.http, first.body.id, driver);

    const retry = await requestRide(t.http, rider, { key });

    // Idempotency replays the response to *that request*; current state is GET /rides/{id}.
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(retry.body.status).toBe('REQUESTED');
  });
});

describe('idempotent lifecycle calls (blueprint 3.3D)', () => {
  it('repeating accept as the winner returns 200 without a second assignment', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createAssignedRide(t.http, rider, driver);

    const again = await accept(t.http, ride.id, driver);

    expect(again.status).toBe(200);
    expect(again.body).toEqual(ride);
    expect(await assignmentsFor(t.pool, ride.id)).toHaveLength(1);
  });

  it('repeating cancel returns 200 with the same body', async () => {
    const rider = await createRider(t.pool);
    const ride = await createRequestedRide(t.http, rider);
    const first = await cancel(t.http, ride.id, asRider(rider), 'Changed my mind');
    const again = await cancel(t.http, ride.id, asRider(rider));
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body).toEqual(first.body);
  });

  it('repeating complete returns 200 and finalizes the fare once', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createInProgressRide(t.http, rider, driver);

    const responses = await Promise.all([
      complete(t.http, ride.id, driver),
      complete(t.http, ride.id, driver),
    ]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(responses[0]?.body).toEqual(responses[1]?.body);
    expect(
      await queryOne(t.pool, 'SELECT final_total, estimated_total FROM fares WHERE ride_id = $1', [
        ride.id,
      ]),
    ).toEqual({ final_total: ride.fare.estimatedTotal, estimated_total: ride.fare.estimatedTotal });
    await assertInvariants(t.pool);
  });
});
