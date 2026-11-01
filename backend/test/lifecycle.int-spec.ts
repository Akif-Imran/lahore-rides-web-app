import {
  API,
  accept,
  asDriver,
  asRider,
  cancel,
  complete,
  createAssignedRide,
  createRequestedRide,
  getRide,
  start,
} from './helpers/api.js';
import {
  assertInvariants,
  assignmentsFor,
  driverAvailability,
  queryOne,
  resetDatabase,
  rideRow,
} from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

describe('ride lifecycle (blueprint test 13)', () => {
  it('request -> accept -> start -> complete, with the driver freed and the fare finalized', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);

    const requested = await createRequestedRide(t.http, rider);
    const assigned = await accept(t.http, requested.id, driver);
    expect(assigned.body).toMatchObject({ status: 'ASSIGNED', version: 2 });
    const started = await start(t.http, requested.id, driver);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', version: 3 });
    const completed = await complete(t.http, requested.id, driver);

    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      status: 'COMPLETED',
      version: 4,
      fare: {
        estimatedTotal: requested.fare.estimatedTotal,
        finalTotal: requested.fare.estimatedTotal,
      },
      driver: { id: driver, location: null },
    });
    const row = await rideRow(t.pool, requested.id);
    const timeline = [
      row.requested_at,
      row.assigned_at,
      row.started_at,
      row.completed_at,
    ] as Date[];
    expect(timeline.every((ts) => ts instanceof Date)).toBe(true);
    expect([...timeline].sort((a, b) => a.getTime() - b.getTime())).toEqual(timeline);

    expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
    expect(await assignmentsFor(t.pool, requested.id)).toEqual([
      { driver_id: driver, status: 'COMPLETED', ended_at: expect.any(Date) },
    ]);
    await assertInvariants(t.pool);
  });

  it('shows each stage to the rider and the driver, and frees both for the next ride', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createAssignedRide(t.http, rider, driver);

    const asSeenByRider = await getRide(t.http, ride.id, asRider(rider));
    expect(asSeenByRider.body).toMatchObject({
      status: 'ASSIGNED',
      driver: { id: driver, name: 'Test Driver' },
    });
    const active = await t.http.get(`${API}/riders/me/active-ride`).set(asRider(rider));
    expect(active.body.ride.id).toBe(ride.id);
    const profile = await t.http.get(`${API}/drivers/${driver}`).set(asDriver(driver));
    expect(profile.body.activeRide.id).toBe(ride.id);

    await start(t.http, ride.id, driver);
    await complete(t.http, ride.id, driver);

    expect((await t.http.get(`${API}/riders/me/active-ride`).set(asRider(rider))).body).toEqual({
      ride: null,
    });
    expect(
      (await t.http.get(`${API}/drivers/${driver}`).set(asDriver(driver))).body.activeRide,
    ).toBeNull();
    // The assigned driver can still read the finished ride (e.g. for their trip history).
    expect((await getRide(t.http, ride.id, asDriver(driver))).status).toBe(200);
    // Both can take part in a new ride.
    const next = await createRequestedRide(t.http, rider);
    expect((await accept(t.http, next.id, driver)).status).toBe(200);
  });

  it('a rider cancel of an ASSIGNED ride frees the driver and records who cancelled and why', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createAssignedRide(t.http, rider, driver);

    const res = await cancel(t.http, ride.id, asRider(rider), 'Found another way');

    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'RIDER',
      cancelReason: 'Found another way',
      fare: { finalTotal: null },
    });
    expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
    expect(await assignmentsFor(t.pool, ride.id)).toEqual([
      { driver_id: driver, status: 'CANCELLED', ended_at: expect.any(Date) },
    ]);
    await assertInvariants(t.pool);
  });

  it('the assigned driver may cancel before starting; the driver is freed', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createAssignedRide(t.http, rider, driver);

    const res = await cancel(t.http, ride.id, asDriver(driver));

    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'DRIVER',
      cancelReason: null,
    });
    expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
    expect(
      await queryOne(t.pool, 'SELECT cancelled_by FROM rides WHERE id = $1', [ride.id]),
    ).toEqual({
      cancelled_by: 'DRIVER',
    });
    await assertInvariants(t.pool);
  });

  it('serves conditional GETs: 304 while unchanged, 200 with a new ETag after a transition', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createRequestedRide(t.http, rider);
    const first = await getRide(t.http, ride.id, asRider(rider));
    const etag = first.headers['etag'] as string;
    expect(first.headers['cache-control']).toBe('no-cache');

    const unchanged = await getRide(t.http, ride.id, { ...asRider(rider), 'If-None-Match': etag });
    expect(unchanged.status).toBe(304);

    await accept(t.http, ride.id, driver);
    const changed = await getRide(t.http, ride.id, { ...asRider(rider), 'If-None-Match': etag });
    expect(changed.status).toBe(200);
    expect(changed.body.status).toBe('ASSIGNED');
    expect(changed.headers['etag']).not.toBe(etag);
  });
});
