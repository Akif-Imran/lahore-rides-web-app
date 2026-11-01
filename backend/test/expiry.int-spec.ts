import { SchedulerRegistry } from '@nestjs/schedule';
import { RideExpiryScheduler } from '../src/rides/ride-expiry.scheduler.js';
import {
  API,
  accept,
  asRider,
  createAssignedRide,
  createRequestedRide,
  expectError,
  getRide,
} from './helpers/api.js';
import {
  assertInvariants,
  assignmentsFor,
  backdateRide,
  driverAvailability,
  resetDatabase,
  rideRow,
} from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

let t: TestApp;
let sweeper: RideExpiryScheduler;
let staleSeconds: number;
beforeAll(async () => {
  t = await createTestApp();
  sweeper = t.app.get(RideExpiryScheduler);
  staleSeconds = t.config.rides.requestTtlSeconds + 30;
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

describe('sweeper scheduling', () => {
  it('registers its interval only when enabled, and clears it on shutdown', async () => {
    const enabled = await createTestApp({ env: { RIDE_EXPIRY_SWEEP_ENABLED: 'true' } });
    const registry = enabled.app.get(SchedulerRegistry);
    expect(registry.getIntervals()).toContain('ride-expiry-sweep');
    await enabled.close();
    expect(registry.getIntervals()).not.toContain('ride-expiry-sweep');

    expect(t.app.get(SchedulerRegistry).getIntervals()).not.toContain('ride-expiry-sweep');
  });
});

describe('request expiry sweeper', () => {
  it('expires only REQUESTED rides older than the TTL', async () => {
    const stale = await createRequestedRide(t.http, await createRider(t.pool));
    const fresh = await createRequestedRide(t.http, await createRider(t.pool));
    const driver = await createDriver(t.pool);
    const oldButAssigned = await createAssignedRide(t.http, await createRider(t.pool), driver);
    await backdateRide(t.pool, stale.id, staleSeconds);
    await backdateRide(t.pool, oldButAssigned.id, staleSeconds);

    expect(await sweeper.sweep()).toBe(1);

    expect(await rideRow(t.pool, stale.id)).toMatchObject({ status: 'EXPIRED', version: 2 });
    expect((await rideRow(t.pool, fresh.id)).status).toBe('REQUESTED');
    expect((await rideRow(t.pool, oldButAssigned.id)).status).toBe('ASSIGNED');
    expect(await sweeper.sweep()).toBe(0); // idempotent
  });

  it('an expired ride shows as EXPIRED, cannot be accepted, and frees the rider to book again', async () => {
    const rider = await createRider(t.pool);
    const ride = await createRequestedRide(t.http, rider);
    await backdateRide(t.pool, ride.id, staleSeconds);
    await sweeper.sweep();

    expect((await getRide(t.http, ride.id, asRider(rider))).body.status).toBe('EXPIRED');
    expectError(
      await accept(t.http, ride.id, await createDriver(t.pool)),
      409,
      'INVALID_STATE_TRANSITION',
    );
    expect((await t.http.get(`${API}/riders/me/active-ride`).set(asRider(rider))).body).toEqual({
      ride: null,
    });
    expect((await createRequestedRide(t.http, rider)).status).toBe('REQUESTED');
  });

  it('never both expires and assigns a ride when a sweep races an accept (20 times)', async () => {
    for (let i = 0; i < 20; i++) {
      const ride = await createRequestedRide(t.http, await createRider(t.pool));
      const driver = await createDriver(t.pool);
      await backdateRide(t.pool, ride.id, staleSeconds);

      const [expiredCount, accepted] = await Promise.all([
        sweeper.sweep(),
        accept(t.http, ride.id, driver),
      ]);

      const row = await rideRow(t.pool, ride.id);
      if (accepted.status === 200) {
        expect(row.status).toBe('ASSIGNED');
        expect(expiredCount).toBe(0);
        expect(await driverAvailability(t.pool, driver)).toBe('BUSY');
      } else {
        expectError(accepted, 409, 'INVALID_STATE_TRANSITION');
        expect(row.status).toBe('EXPIRED');
        expect(expiredCount).toBe(1);
        expect(await assignmentsFor(t.pool, ride.id)).toEqual([]);
        expect(await driverAvailability(t.pool, driver)).toBe('AVAILABLE');
      }
      await assertInvariants(t.pool);
    }
  });
});
