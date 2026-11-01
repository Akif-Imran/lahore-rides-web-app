import { randomUUID } from 'node:crypto';
import {
  API,
  asDriver,
  asRider,
  cancel,
  createAssignedRide,
  createRequestedRide,
  expectError,
  getRide,
  requestRide,
} from './helpers/api.js';
import { resetDatabase, rideRow } from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { tripBody } from './helpers/fixtures.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

describe('authorization (blueprint test 14)', () => {
  it('another rider can neither read nor cancel the ride, and cannot learn it exists (404)', async () => {
    const [owner, stranger] = [await createRider(t.pool), await createRider(t.pool)];
    const ride = await createRequestedRide(t.http, owner);

    expectError(await getRide(t.http, ride.id, asRider(stranger)), 404, 'NOT_FOUND');
    expectError(await cancel(t.http, ride.id, asRider(stranger)), 404, 'NOT_FOUND');

    // Same answer as for an id that does not exist at all.
    const missing = await getRide(t.http, randomUUID(), asRider(stranger));
    expect(missing.body.error.message).toBe('Ride not found');
    expect((await rideRow(t.pool, ride.id)).status).toBe('REQUESTED');
    const strangersActive = await t.http.get(`${API}/riders/me/active-ride`).set(asRider(stranger));
    expect(strangersActive.body).toEqual({ ride: null });
  });

  it('a driver cannot read a ride assigned to someone else', async () => {
    const rider = await createRider(t.pool);
    const [assigned, other] = [await createDriver(t.pool), await createDriver(t.pool)];
    const ride = await createAssignedRide(t.http, rider, assigned);

    expect((await getRide(t.http, ride.id, asDriver(assigned))).status).toBe(200);
    expectError(await getRide(t.http, ride.id, asDriver(other)), 404, 'NOT_FOUND');
  });

  it('a driver can preview an open ride their car can serve, but not one it cannot', async () => {
    const rider = await createRider(t.pool);
    const economyDriver = await createDriver(t.pool, { category: 'ECONOMY' });
    const comfortRide = await createRequestedRide(t.http, rider, tripBody({ category: 'COMFORT' }));
    expectError(await getRide(t.http, comfortRide.id, asDriver(economyDriver)), 404, 'NOT_FOUND');

    const comfortDriver = await createDriver(t.pool, { category: 'COMFORT' });
    expect((await getRide(t.http, comfortRide.id, asDriver(comfortDriver))).status).toBe(200);
  });

  it('identifies callers strictly', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createRequestedRide(t.http, rider);
    const url = `${API}/rides/${ride.id}`;

    expectError(await t.http.get(url), 401, 'UNAUTHENTICATED');
    expectError(await t.http.get(url).set(asRider(randomUUID())), 401, 'UNAUTHENTICATED');
    expectError(await t.http.get(url).set(asRider('not-a-uuid')), 401, 'UNAUTHENTICATED');
    expectError(await t.http.get(url).set(asDriver(rider)), 401, 'UNAUTHENTICATED'); // a rider id is not a driver
    expectError(
      await t.http.get(url).set({ ...asRider(rider), ...asDriver(driver) }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('keeps riders and drivers on their own endpoints (403)', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createRequestedRide(t.http, rider);

    expectError(
      await t.http
        .post(`${API}/rides`)
        .set(asDriver(driver))
        .set('Idempotency-Key', randomUUID())
        .send(tripBody()),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t.http.post(`${API}/rides/${ride.id}/accept`).set(asRider(rider)),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t.http.get(`${API}/riders/me/active-ride`).set(asDriver(driver)),
      403,
      'FORBIDDEN',
    );
    expectError(await t.http.get(`${API}/drivers/${driver}`).set(asRider(rider)), 403, 'FORBIDDEN');
  });

  it('lets a driver act only on their own driver profile', async () => {
    const [me, someoneElse] = [await createDriver(t.pool), await createDriver(t.pool)];
    expectError(
      await t.http.get(`${API}/drivers/${someoneElse}`).set(asDriver(me)),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t.http.get(`${API}/drivers/${someoneElse}/offers`).set(asDriver(me)),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t.http
        .patch(`${API}/drivers/${someoneElse}/availability`)
        .set(asDriver(me))
        .send({ status: 'OFFLINE' }),
      403,
      'FORBIDDEN',
    );
  });

  it('treats identity headers case-insensitively (UUID case does not matter)', async () => {
    const rider = await createRider(t.pool);
    const ride = await createRequestedRide(t.http, rider);
    expect((await getRide(t.http, ride.id, asRider(rider.toUpperCase()))).status).toBe(200);
    const res = await requestRide(t.http, rider.toUpperCase());
    expectError(res, 409, 'ACTIVE_RIDE_EXISTS');
  });
});
