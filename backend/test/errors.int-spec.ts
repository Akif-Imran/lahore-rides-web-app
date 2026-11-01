import { randomUUID } from 'node:crypto';
import { RidesRepository } from '../src/rides/rides.repository.js';
import { GENERIC_500_MESSAGE } from '../src/common/http/error-mapper.js';
import {
  API,
  accept,
  asDriver,
  asRider,
  createRequestedRide,
  errorEnvelopeSchema,
  expectError,
  getRide,
  requestRide,
} from './helpers/api.js';
import { resetDatabase } from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { tripBody } from './helpers/fixtures.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('consistent error responses (blueprint test 15)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetDatabase(t.pool));

  it('every kind of failure uses the same envelope with a matching request id', async () => {
    const rider = await createRider(t.pool);
    const driver = await createDriver(t.pool);
    const ride = await createRequestedRide(t.http, rider);

    const failures = await Promise.all([
      requestRide(t.http, rider, { body: tripBody({ category: 'X' }) }), // 400 validation
      t.http.get(`${API}/rides/${ride.id}`), // 401
      t.http.post(`${API}/rides/${ride.id}/accept`).set(asRider(rider)), // 403
      getRide(t.http, randomUUID(), asRider(rider)), // 404
      t.http.get(`${API}/no-such-route`).set(asRider(rider)), // 404 (framework)
      requestRide(t.http, rider), // 409 active ride
      accept(t.http, ride.id, driver).then(() => accept(t.http, ride.id, randomUUID())), // 401 unknown driver
    ]);

    for (const res of failures) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      const { error } = errorEnvelopeSchema.parse(res.body);
      expect(error.requestId).toBe(res.headers['x-request-id']);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    }
  });

  it('propagates a caller-supplied X-Request-Id into the error body', async () => {
    const res = await t.http.get(`${API}/rides/${randomUUID()}`).set('X-Request-Id', 'trace-42');
    expect(expectError(res, 401, 'UNAUTHENTICATED').requestId).toBe('trace-42');
  });
});

describe('unexpected failures', () => {
  it('returns a generic 500 that leaks neither the message nor the stack', async () => {
    class ExplodingRidesRepository extends RidesRepository {
      override findDetailsById(): never {
        throw new Error('connection to db-prod-7 failed: password=hunter2 at /srv/app/rides.ts:42');
      }
    }
    const t = await createTestApp({
      customize: (builder) =>
        builder.overrideProvider(RidesRepository).useClass(ExplodingRidesRepository),
    });
    try {
      await resetDatabase(t.pool);
      const rider = await createRider(t.pool);

      const res = await getRide(t.http, randomUUID(), asRider(rider));

      const error = expectError(res, 500, 'INTERNAL_ERROR');
      expect(error.message).toBe(GENERIC_500_MESSAGE);
      const raw = JSON.stringify(res.body);
      for (const secret of ['hunter2', 'db-prod-7', '/srv/app', 'stack', 'rides.ts']) {
        expect(raw).not.toContain(secret);
      }
    } finally {
      await t.close();
    }
  });

  it('turns a lock wait beyond lock_timeout into a retryable 503, then succeeds once the lock is free', async () => {
    const t = await createTestApp({ env: { DB_LOCK_TIMEOUT_MS: '300' } });
    try {
      await resetDatabase(t.pool);
      const rider = await createRider(t.pool);
      const driver = await createDriver(t.pool);
      const ride = await createRequestedRide(t.http, rider);

      // Another session holds the ride's row lock longer than the API is willing to wait.
      const holder = await t.pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM rides WHERE id = $1 FOR UPDATE', [ride.id]);

        const res = await accept(t.http, ride.id, driver);

        const error = expectError(res, 503, 'SERVICE_UNAVAILABLE');
        expect(error.details).toEqual({ retryable: true });
        expect(res.headers['retry-after']).toBe('1');
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }

      expect((await accept(t.http, ride.id, driver)).status).toBe(200);
    } finally {
      await t.close();
    }
  });

  it('answers 503 (not 500) when the database is unreachable', async () => {
    const t = await createTestApp({
      env: { DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/unreachable_test' },
    });
    try {
      const ready = await t.http.get(`${API}/health/ready`);
      expectError(ready, 503, 'SERVICE_UNAVAILABLE');

      const live = await t.http.get(`${API}/health/live`);
      expect(live.status).toBe(200);

      const res = await getRide(t.http, randomUUID(), asDriver(randomUUID()));
      expectError(res, 503, 'SERVICE_UNAVAILABLE');
      expect(res.headers['retry-after']).toBe('1');
    } finally {
      await t.close();
    }
  });
});
