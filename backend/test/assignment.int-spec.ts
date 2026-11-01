import type { ErrorCode } from '../src/common/errors/error-codes.js';
import { haversineMeters } from '../src/common/utils/geo.js';
import {
  API,
  accept,
  asDriver,
  createAssignedRide,
  createRequestedRide,
  expectError,
  fieldsOf,
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
import {
  FAR_FROM_LIBERTY,
  GADDAFI,
  LIBERTY,
  MODEL_TOWN,
  NEAR_LIBERTY,
  tripBody,
} from './helpers/fixtures.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

describe('driver availability and assignment (blueprint test 7)', () => {
  it('an available, nearby driver accepts: ride ASSIGNED, driver BUSY, assignment ACTIVE', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createRequestedRide(t.http, rider);

    const res = await accept(t.http, ride.id, driver);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ride.id,
      status: 'ASSIGNED',
      version: 2,
      driver: { id: driver, location: NEAR_LIBERTY },
    });
    expect(res.body.assignedAt).toEqual(expect.any(String));
    expect(await rideRow(t.pool, ride.id)).toMatchObject({ status: 'ASSIGNED', driver_id: driver });
    expect(await driverAvailability(t.pool, driver)).toBe('BUSY');
    expect(await assignmentsFor(t.pool, ride.id)).toEqual([
      { driver_id: driver, status: 'ACTIVE', ended_at: null },
    ]);
    await assertInvariants(t.pool);
  });

  it('a Comfort car may take an Economy ride', async () => {
    const rider = await createRider(t.pool);
    const comfort = await createDriver(t.pool, { category: 'COMFORT' });
    const ride = await createRequestedRide(t.http, rider);
    expect((await accept(t.http, ride.id, comfort)).status).toBe(200);
  });

  it.each<[string, Parameters<typeof createDriver>[1], number, ErrorCode, string | undefined]>([
    ['an OFFLINE driver', { availability: 'OFFLINE' }, 409, 'DRIVER_UNAVAILABLE', 'OFFLINE'],
    [
      'a driver with a stale location',
      { locationAgeSeconds: 600 },
      409,
      'DRIVER_UNAVAILABLE',
      'LOCATION_STALE',
    ],
    ['a driver with no location', { location: null }, 409, 'DRIVER_UNAVAILABLE', 'NO_LOCATION'],
    [
      'an Economy car on a Comfort ride',
      { category: 'ECONOMY' },
      403,
      'DRIVER_NOT_ELIGIBLE',
      undefined,
    ],
  ])('rejects %s and changes nothing', async (label, driverOptions, status, code, reason) => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool, driverOptions);
    const comfortRide = label.includes('Comfort');
    const ride = await createRequestedRide(
      t.http,
      rider,
      comfortRide ? tripBody({ category: 'COMFORT' }) : undefined,
    );

    const error = expectError(await accept(t.http, ride.id, driver), status, code);

    if (reason) expect(error.details).toEqual({ reason });
    expect(await rideRow(t.pool, ride.id)).toMatchObject({
      status: 'REQUESTED',
      driver_id: null,
      version: 1,
    });
    expect(await assignmentsFor(t.pool, ride.id)).toEqual([]);
  });

  it('rejects a BUSY driver (already on another trip)', async () => {
    const [riderA, riderB] = [await createRider(t.pool), await createRider(t.pool)];
    const driver = await createDriver(t.pool);
    await createAssignedRide(t.http, riderA, driver);
    const second = await createRequestedRide(t.http, riderB);

    const error = expectError(await accept(t.http, second.id, driver), 409, 'DRIVER_UNAVAILABLE');

    expect(error.details).toEqual({ reason: 'BUSY' });
    await assertInvariants(t.pool);
  });

  it('returns 404 for a ride that does not exist', async () => {
    const driver = await createDriver(t.pool);
    expectError(
      await accept(t.http, '9b2f8a4e-6c1d-4e3a-8f5b-7a9c0d1e2f3a', driver),
      404,
      'NOT_FOUND',
    );
  });
});

describe('driver availability toggle', () => {
  const setAvailability = (driver: string, body: object) =>
    t.http.patch(`${API}/drivers/${driver}/availability`).set(asDriver(driver)).send(body);

  it('goes AVAILABLE with a fresh location and OFFLINE again', async () => {
    const driver = await createDriver(t.pool, {
      availability: 'OFFLINE',
      locationAgeSeconds: 3600,
    });

    const online = await setAvailability(driver, { status: 'AVAILABLE', lat: 31.55, lng: 74.34 });
    expect(online.status).toBe(200);
    expect(online.body).toMatchObject({
      availability: 'AVAILABLE',
      location: { lat: 31.55, lng: 74.34 },
      activeRide: null,
    });
    expect(Date.now() - Date.parse(online.body.locationUpdatedAt)).toBeLessThan(10_000);

    const offline = await setAvailability(driver, { status: 'OFFLINE' });
    expect(offline.body).toMatchObject({
      availability: 'OFFLINE',
      location: { lat: 31.55, lng: 74.34 },
    });
  });

  it('requires a location to go AVAILABLE when none is known', async () => {
    const driver = await createDriver(t.pool, { availability: 'OFFLINE', location: null });
    const error = expectError(
      await setAvailability(driver, { status: 'AVAILABLE' }),
      400,
      'VALIDATION_ERROR',
    );
    expect(fieldsOf(error)).toEqual([expect.objectContaining({ code: 'LOCATION_REQUIRED' })]);
  });

  it('rejects a location outside the service area', async () => {
    const driver = await createDriver(t.pool);
    const error = expectError(
      await setAvailability(driver, { status: 'AVAILABLE', lat: 24.86, lng: 67.0 }),
      400,
      'VALIDATION_ERROR',
    );
    expect(fieldsOf(error)).toEqual([expect.objectContaining({ code: 'OUT_OF_SERVICE_AREA' })]);
  });

  it('refuses to change availability during a trip (BUSY stays BUSY)', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createAssignedRide(t.http, rider, driver);

    expectError(await setAvailability(driver, { status: 'OFFLINE' }), 409, 'CONFLICT');

    expect(await driverAvailability(t.pool, driver)).toBe('BUSY');
    const profile = await t.http.get(`${API}/drivers/${driver}`).set(asDriver(driver));
    expect(profile.body).toMatchObject({ availability: 'BUSY', activeRide: { id: ride.id } });
  });
});

describe('driver offers', () => {
  const offers = async (driver: string) => {
    const res = await t.http.get(`${API}/drivers/${driver}/offers`).set(asDriver(driver));
    expect(res.status).toBe(200);
    return res.body.offers as Array<{
      ride: { id: string };
      distanceToPickupMeters: number;
      pickupEtaMinutes: number;
    }>;
  };

  it('lists compatible open rides within the radius, nearest pickup first', async () => {
    const driver = await createDriver(t.pool, { location: NEAR_LIBERTY });
    const nearRide = await createRequestedRide(t.http, await createRider(t.pool));
    const fartherRide = await createRequestedRide(
      t.http,
      await createRider(t.pool),
      tripBody({ pickup: GADDAFI, destination: MODEL_TOWN }),
    );

    const list = await offers(driver);

    expect(list.map((o) => o.ride.id)).toEqual([nearRide.id, fartherRide.id]);
    expect(list[0]?.distanceToPickupMeters).toBe(
      Math.round(haversineMeters(NEAR_LIBERTY, LIBERTY)),
    );
    expect(list[0]?.pickupEtaMinutes).toEqual(expect.any(Number));
  });

  it('excludes rides outside the radius and categories the car cannot serve', async () => {
    const far = await createDriver(t.pool, { location: FAR_FROM_LIBERTY });
    const economy = await createDriver(t.pool, { category: 'ECONOMY' });
    const comfort = await createDriver(t.pool, { category: 'COMFORT' });
    const comfortRide = await createRequestedRide(
      t.http,
      await createRider(t.pool),
      tripBody({ category: 'COMFORT' }),
    );

    expect(await offers(far)).toEqual([]);
    expect(await offers(economy)).toEqual([]);
    expect((await offers(comfort)).map((o) => o.ride.id)).toEqual([comfortRide.id]);
  });

  it('is empty for an OFFLINE driver or one with a stale location', async () => {
    await createRequestedRide(t.http, await createRider(t.pool));
    expect(await offers(await createDriver(t.pool, { availability: 'OFFLINE' }))).toEqual([]);
    expect(await offers(await createDriver(t.pool, { locationAgeSeconds: 600 }))).toEqual([]);
  });

  it("drops a ride from everyone's offers once it is accepted", async () => {
    const [winner, other] = [await createDriver(t.pool), await createDriver(t.pool)];
    const ride = await createRequestedRide(t.http, await createRider(t.pool));
    expect((await offers(other)).map((o) => o.ride.id)).toEqual([ride.id]);

    await accept(t.http, ride.id, winner);

    expect(await offers(other)).toEqual([]);
    expect(await queryOne(t.pool, 'SELECT status FROM rides WHERE id = $1', [ride.id])).toEqual({
      status: 'ASSIGNED',
    });
  });
});
