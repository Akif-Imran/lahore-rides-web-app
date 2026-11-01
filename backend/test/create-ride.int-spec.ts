import { randomUUID } from 'node:crypto';
import { haversineMeters } from '../src/common/utils/geo.js';
import { quoteFare } from '../src/fares/fare.service.js';
import { pickupEtaMinutes } from '../src/matching/eligibility.js';
import { API, asRider, expectError, fieldsOf, requestRide } from './helpers/api.js';
import { count, queryOne, rideRow, resetDatabase } from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { FAR_FROM_LIBERTY, FORT, LIBERTY, NEAR_LIBERTY, tripBody } from './helpers/fixtures.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

describe('POST /rides: successful creation (blueprint test 5)', () => {
  it('creates a REQUESTED ride and persists exactly the quote the rider was shown', async () => {
    const rider = await createRider(t.pool);
    await createDriver(t.pool, { location: NEAR_LIBERTY });
    const key = randomUUID();

    const res = await requestRide(t.http, rider, { key });

    expect(res.status).toBe(201);
    expect(res.headers['location']).toBe(`${API}/rides/${res.body.id}`);
    expect(res.headers['x-request-id']).toBeTruthy();
    const quote = quoteFare(LIBERTY, FORT, 'ECONOMY');
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      category: 'ECONOMY',
      pickup: LIBERTY,
      destination: FORT,
      driver: null,
      version: 1,
      distanceMeters: quote.distanceM,
      durationSeconds: quote.durationS,
      fare: {
        currency: 'PKR',
        estimatedTotal: quote.total,
        finalTotal: null,
        breakdown: {
          base: quote.breakdown.base,
          distance: quote.breakdown.distance,
          time: quote.breakdown.time,
          surge: 1,
          minimumFareApplied: false,
        },
      },
    });

    const fare = await queryOne(
      t.pool,
      `SELECT currency, base_amount, distance_amount, time_amount,
              surge_multiplier::float8 AS surge, estimated_total, final_total
         FROM fares WHERE ride_id = $1`,
      [res.body.id],
    );
    expect(fare).toEqual({
      currency: 'PKR',
      base_amount: quote.breakdown.base,
      distance_amount: quote.breakdown.distance,
      time_amount: quote.breakdown.time,
      surge: 1,
      estimated_total: quote.total,
      final_total: null,
    });
    expect(await rideRow(t.pool, res.body.id)).toMatchObject({
      status: 'REQUESTED',
      driver_id: null,
    });

    const stored = await queryOne<{
      response_status: number;
      response_body: unknown;
      ride_id: string;
    }>(
      t.pool,
      'SELECT response_status, response_body, ride_id FROM idempotency_keys WHERE rider_id = $1 AND key = $2',
      [rider, key],
    );
    expect(stored).toEqual({ response_status: 201, response_body: res.body, ride_id: res.body.id });
  });

  it('computes the pickup ETA in SQL with the same Haversine as the TypeScript domain code', async () => {
    const rider = await createRider(t.pool);
    await createDriver(t.pool, { location: NEAR_LIBERTY });
    await createDriver(t.pool, { location: { lat: 31.53, lng: 74.38 } }); // further away

    const res = await requestRide(t.http, rider);

    expect(res.body.etaMinutes).toBe(pickupEtaMinutes(haversineMeters(LIBERTY, NEAR_LIBERTY)));
  });

  it('records etaMinutes = null when no eligible driver is within the matching radius', async () => {
    const rider = await createRider(t.pool);
    await createDriver(t.pool, { location: FAR_FROM_LIBERTY });
    await createDriver(t.pool, { location: NEAR_LIBERTY, availability: 'OFFLINE' });
    await createDriver(t.pool, { location: NEAR_LIBERTY, locationAgeSeconds: 600 }); // stale
    await createDriver(t.pool, { location: null });

    const res = await requestRide(t.http, rider);

    expect(res.status).toBe(201);
    expect(res.body.etaMinutes).toBeNull();
  });

  it('counts a nearby Comfort car for an Economy ETA, but not an Economy car for Comfort', async () => {
    const rider = await createRider(t.pool);
    await createDriver(t.pool, { location: NEAR_LIBERTY, category: 'ECONOMY' });

    const estimate = await t.http
      .post(`${API}/fare-estimates`)
      .set(asRider(rider))
      .send({ pickup: LIBERTY, destination: FORT });
    expect(estimate.status).toBe(200);
    const eta = (category: string) =>
      estimate.body.estimates.find((e: { category: string }) => e.category === category).etaMinutes;
    expect(eta('ECONOMY')).toEqual(expect.any(Number));
    expect(eta('COMFORT')).toBeNull();
  });
});

describe('POST /rides: invalid input (blueprint test 6)', () => {
  const ISLAMABAD = { name: 'Islamabad', lat: 33.6844, lng: 73.0479 };

  it.each<[string, Record<string, unknown>, Array<{ field: string; code?: string }>]>([
    ['missing pickup', { pickup: undefined }, [{ field: 'pickup' }]],
    ['latitude above 90', { pickup: { ...LIBERTY, lat: 91 } }, [{ field: 'pickup.lat' }]],
    [
      'longitude below -180',
      { destination: { ...FORT, lng: -200 } },
      [{ field: 'destination.lng' }],
    ],
    [
      'coordinate sent as a string',
      { pickup: { ...LIBERTY, lat: '31.5' } },
      [{ field: 'pickup.lat' }],
    ],
    ['blank location name', { pickup: { ...LIBERTY, name: '  ' } }, [{ field: 'pickup.name' }]],
    ['unknown category', { category: 'LUXURY' }, [{ field: 'category' }]],
    ['unknown extra property', { couponCode: 'FREE' }, [{ field: 'couponCode' }]],
    [
      'pickup outside Lahore',
      { pickup: ISLAMABAD },
      [{ field: 'pickup', code: 'OUT_OF_SERVICE_AREA' }],
    ],
    [
      'same pickup and destination',
      { destination: { ...LIBERTY, name: 'Liberty again' } },
      [{ field: 'destination', code: 'TRIP_TOO_SHORT' }],
    ],
  ])(
    '%s -> 400 VALIDATION_ERROR with field details, nothing persisted',
    async (_label, change, expected) => {
      const rider = await createRider(t.pool);
      const key = randomUUID();

      const res = await requestRide(t.http, rider, { key, body: tripBody(change) });

      const error = expectError(res, 400, 'VALIDATION_ERROR');
      expect(fieldsOf(error)).toEqual(
        expect.arrayContaining(expected.map((e) => expect.objectContaining(e))),
      );
      expect(await count(t.pool, 'SELECT 1 FROM rides')).toBe(0);
      expect(await count(t.pool, 'SELECT 1 FROM idempotency_keys')).toBe(0);
    },
  );

  it('requires an Idempotency-Key header', async () => {
    const rider = await createRider(t.pool);
    const res = await t.http.post(`${API}/rides`).set(asRider(rider)).send(tripBody());
    const error = expectError(res, 400, 'VALIDATION_ERROR');
    expect(fieldsOf(error)).toEqual([
      expect.objectContaining({ field: 'Idempotency-Key', code: 'REQUIRED' }),
    ]);
  });

  it('requires the Idempotency-Key to be a UUID', async () => {
    const rider = await createRider(t.pool);
    const res = await requestRide(t.http, rider, { key: 'retry-1' });
    const error = expectError(res, 400, 'VALIDATION_ERROR');
    expect(fieldsOf(error)).toEqual([
      expect.objectContaining({ field: 'Idempotency-Key', code: 'INVALID' }),
    ]);
  });

  it('rejects a malformed JSON body with the standard envelope', async () => {
    const rider = await createRider(t.pool);
    const res = await t.http
      .post(`${API}/rides`)
      .set(asRider(rider))
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"pickup":');
    expectError(res, 400, 'VALIDATION_ERROR');
  });

  it('rejects a malformed ride id in the path', async () => {
    const rider = await createRider(t.pool);
    const res = await t.http.get(`${API}/rides/12345`).set(asRider(rider));
    const error = expectError(res, 400, 'VALIDATION_ERROR');
    expect(fieldsOf(error)).toEqual([
      expect.objectContaining({ field: 'id', code: 'INVALID_UUID' }),
    ]);
  });

  it('a rejected request does not burn its Idempotency-Key', async () => {
    const rider = await createRider(t.pool);
    const key = randomUUID();
    expect(
      (await requestRide(t.http, rider, { key, body: tripBody({ category: 'LUXURY' }) })).status,
    ).toBe(400);
    expect((await requestRide(t.http, rider, { key })).status).toBe(201);
  });
});
