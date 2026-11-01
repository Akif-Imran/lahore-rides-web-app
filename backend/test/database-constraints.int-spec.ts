import { DatabaseError, type Pool } from 'pg';
import { CONSTRAINT } from '../src/database/constraints.js';
import { createAssignedRide, createRequestedRide } from './helpers/api.js';
import { resetDatabase } from './helpers/db.js';
import { createDriver, createRider } from './helpers/factories.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

/**
 * The database's own guarantees, exercised with raw SQL that bypasses every application check.
 * These are the backstops that keep data consistent even if a code path forgot a lock.
 */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => resetDatabase(t.pool));

async function violation(pool: Pool, sql: string, params: unknown[]): Promise<DatabaseError> {
  try {
    await pool.query(sql, params);
  } catch (error) {
    if (error instanceof DatabaseError) return error;
    throw error;
  }
  throw new Error(`Expected the database to reject: ${sql}`);
}

describe('database invariants enforced by PostgreSQL itself', () => {
  it(`${CONSTRAINT.ACTIVE_ASSIGNMENT_PER_RIDE}: a ride can never have two active drivers`, async () => {
    const driver = await createDriver(t.pool);
    const other = await createDriver(t.pool);
    const ride = await createAssignedRide(t.http, await createRider(t.pool), driver);

    const error = await violation(
      t.pool,
      'INSERT INTO ride_assignments (ride_id, driver_id) VALUES ($1, $2)',
      [ride.id, other],
    );
    expect(error).toMatchObject({
      code: '23505',
      constraint: CONSTRAINT.ACTIVE_ASSIGNMENT_PER_RIDE,
    });
  });

  it(`${CONSTRAINT.ACTIVE_ASSIGNMENT_PER_DRIVER}: a driver can never be on two active rides`, async () => {
    const driver = await createDriver(t.pool);
    await createAssignedRide(t.http, await createRider(t.pool), driver);
    const second = await createRequestedRide(t.http, await createRider(t.pool));

    const error = await violation(
      t.pool,
      'INSERT INTO ride_assignments (ride_id, driver_id) VALUES ($1, $2)',
      [second.id, driver],
    );
    expect(error).toMatchObject({
      code: '23505',
      constraint: CONSTRAINT.ACTIVE_ASSIGNMENT_PER_DRIVER,
    });
  });

  it(`${CONSTRAINT.ONE_ACTIVE_RIDE_PER_RIDER}: a rider can never hold two active rides`, async () => {
    const rider = await createRider(t.pool);
    await createRequestedRide(t.http, rider);

    const error = await violation(
      t.pool,
      `INSERT INTO rides (rider_id, category, pickup_name, pickup_lat, pickup_lng,
                          dest_name, dest_lat, dest_lng, distance_m, duration_s)
       VALUES ($1, 'ECONOMY', 'A', 31.5, 74.3, 'B', 31.6, 74.3, 1000, 100)`,
      [rider],
    );
    expect(error).toMatchObject({
      code: '23505',
      constraint: CONSTRAINT.ONE_ACTIVE_RIDE_PER_RIDER,
    });
  });

  it('finished assignments do not block new ones (the indexes are partial)', async () => {
    const driver = await createDriver(t.pool);
    const ride = await createAssignedRide(t.http, await createRider(t.pool), driver);
    await t.pool.query(`UPDATE ride_assignments SET status = 'CANCELLED' WHERE ride_id = $1`, [
      ride.id,
    ]);
    const next = await createRequestedRide(t.http, await createRider(t.pool));

    await expect(
      t.pool.query('INSERT INTO ride_assignments (ride_id, driver_id) VALUES ($1, $2)', [
        next.id,
        driver,
      ]),
    ).resolves.toBeDefined();
  });

  it('chk_driver_consistency: an ASSIGNED ride must have a driver', async () => {
    const ride = await createRequestedRide(t.http, await createRider(t.pool));
    const error = await violation(t.pool, `UPDATE rides SET status = 'ASSIGNED' WHERE id = $1`, [
      ride.id,
    ]);
    expect(error).toMatchObject({ code: '23514', constraint: 'chk_driver_consistency' });
  });

  it('an unknown ride status is rejected by a CHECK constraint', async () => {
    const ride = await createRequestedRide(t.http, await createRider(t.pool));
    const error = await violation(t.pool, `UPDATE rides SET status = 'TELEPORTED' WHERE id = $1`, [
      ride.id,
    ]);
    // It violates both rides_status_check and chk_driver_consistency; Postgres reports one.
    expect(error.code).toBe('23514');
    expect(['rides_status_check', 'chk_driver_consistency']).toContain(error.constraint);
  });

  it('chk_driver_location_pair: a driver location is both coordinates or neither', async () => {
    const driver = await createDriver(t.pool);
    const error = await violation(t.pool, 'UPDATE drivers SET lng = NULL WHERE id = $1', [driver]);
    expect(error).toMatchObject({ code: '23514', constraint: 'chk_driver_location_pair' });
  });

  it('drivers_availability_check: availability is one of OFFLINE / AVAILABLE / BUSY', async () => {
    const driver = await createDriver(t.pool);
    const error = await violation(
      t.pool,
      `UPDATE drivers SET availability = 'NAPPING' WHERE id = $1`,
      [driver],
    );
    expect(error).toMatchObject({ code: '23514', constraint: 'drivers_availability_check' });
  });
});
