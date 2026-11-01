import { API, asRider, expectError, requestRide } from './helpers/api.js';
import { resetDatabase } from './helpers/db.js';
import { createRider } from './helpers/factories.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('rate limiting', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      env: {
        RATE_LIMIT_CREATE_RIDE_LIMIT: '2',
        RATE_LIMIT_LIMIT: '6',
        RATE_LIMIT_TTL_SECONDS: '60',
      },
    });
  });
  afterAll(() => t.close());
  beforeEach(() => resetDatabase(t.pool));

  it('limits ride creation per rider and answers 429 with Retry-After', async () => {
    const rider = await createRider(t.pool);
    // Bodies are invalid on purpose: the limit applies before validation and creates nothing.
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await requestRide(t.http, rider, { body: {} })).status);
    expect(statuses).toEqual([400, 400, 429]);

    const limited = await requestRide(t.http, rider, { body: {} });
    expectError(limited, 429, 'RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps separate buckets per caller', async () => {
    const [busy, other] = [await createRider(t.pool), await createRider(t.pool)];
    for (let i = 0; i < 3; i++) await requestRide(t.http, busy, { body: {} });
    expect((await requestRide(t.http, other, { body: {} })).status).toBe(400);
  });

  it('applies the global limit to other endpoints, but never to health checks', async () => {
    const rider = await createRider(t.pool);
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await t.http.get(`${API}/riders/me/active-ride`).set(asRider(rider))).status);
    }
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses[6]).toBe(429);

    for (let i = 0; i < 10; i++) expect((await t.http.get(`${API}/health/live`)).status).toBe(200);
  });
});
