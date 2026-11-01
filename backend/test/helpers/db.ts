import type { Pool, QueryResultRow } from 'pg';

/**
 * Direct SQL for fixtures and assertions. Deliberately independent of the app's repositories:
 * tests verify the database state through a second path, not the code under test.
 */

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE idempotency_keys, fares, ride_assignments, rides, drivers, riders RESTART IDENTITY CASCADE',
  );
}

export async function queryOne<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const { rows } = await pool.query<T>(sql, params);
  if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}: ${sql}`);
  return rows[0] as T;
}

export async function count(pool: Pool, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${sql}) q`,
    params,
  );
  return rows[0]?.n ?? 0;
}

export interface RideRow {
  status: string;
  driver_id: string | null;
  version: number;
  cancelled_by: string | null;
  cancel_reason: string | null;
  requested_at: Date;
  assigned_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  updated_at: Date;
}

export const rideRow = (pool: Pool, rideId: string) =>
  queryOne<RideRow>(
    pool,
    `SELECT status, driver_id, version, cancelled_by, cancel_reason, requested_at, assigned_at,
            started_at, completed_at, cancelled_at, updated_at
       FROM rides WHERE id = $1`,
    [rideId],
  );

export const driverAvailability = async (pool: Pool, driverId: string): Promise<string> =>
  (
    await queryOne<{ availability: string }>(
      pool,
      'SELECT availability FROM drivers WHERE id = $1',
      [driverId],
    )
  ).availability;

export async function assignmentsFor(
  pool: Pool,
  rideId: string,
): Promise<Array<{ driver_id: string; status: string; ended_at: Date | null }>> {
  const { rows } = await pool.query(
    'SELECT driver_id, status, ended_at FROM ride_assignments WHERE ride_id = $1 ORDER BY assigned_at',
    [rideId],
  );
  return rows;
}

export async function backdateRide(pool: Pool, rideId: string, seconds: number): Promise<void> {
  await pool.query(
    `UPDATE rides SET requested_at = now() - make_interval(secs => $2) WHERE id = $1`,
    [rideId, seconds],
  );
}

/** Everything about a ride and the drivers involved that a rejected call must not change. */
export async function snapshot(pool: Pool, rideId: string, driverIds: string[]) {
  return {
    ride: await rideRow(pool, rideId),
    drivers: await Promise.all(driverIds.map((id) => driverAvailability(pool, id))),
    assignments: await assignmentsFor(pool, rideId),
    fare: await queryOne(
      pool,
      'SELECT estimated_total, final_total FROM fares WHERE ride_id = $1',
      [rideId],
    ),
  };
}

/**
 * Cross-table invariants that must hold after any sequence of API calls, however they race.
 * Each query returns offending rows; all must be empty.
 */
const INVARIANTS: Array<[string, string]> = [
  [
    'a BUSY driver has exactly one ACTIVE assignment, and a non-BUSY driver has none',
    `SELECT d.id FROM drivers d
       LEFT JOIN ride_assignments a ON a.driver_id = d.id AND a.status = 'ACTIVE'
      GROUP BY d.id, d.availability
     HAVING (d.availability = 'BUSY') <> (count(a.id) = 1)`,
  ],
  [
    'an ACTIVE assignment belongs to an ASSIGNED/IN_PROGRESS ride held by the same driver',
    `SELECT a.id FROM ride_assignments a JOIN rides r ON r.id = a.ride_id
      WHERE a.status = 'ACTIVE'
        AND (r.status NOT IN ('ASSIGNED', 'IN_PROGRESS') OR r.driver_id <> a.driver_id)`,
  ],
  [
    'an ASSIGNED/IN_PROGRESS ride has an ACTIVE assignment',
    `SELECT r.id FROM rides r
      WHERE r.status IN ('ASSIGNED', 'IN_PROGRESS')
        AND NOT EXISTS (SELECT 1 FROM ride_assignments a WHERE a.ride_id = r.id AND a.status = 'ACTIVE')`,
  ],
  [
    'every ride has exactly one fare',
    `SELECT r.id FROM rides r LEFT JOIN fares f ON f.ride_id = r.id WHERE f.id IS NULL`,
  ],
  [
    'a final fare is set exactly when the ride is COMPLETED',
    `SELECT r.id FROM rides r JOIN fares f ON f.ride_id = r.id
      WHERE (r.status = 'COMPLETED') <> (f.final_total IS NOT NULL)`,
  ],
  [
    'no rider has more than one active ride',
    `SELECT rider_id FROM rides WHERE status IN ('REQUESTED', 'ASSIGNED', 'IN_PROGRESS')
      GROUP BY rider_id HAVING count(*) > 1`,
  ],
];

export async function assertInvariants(pool: Pool): Promise<void> {
  for (const [description, sql] of INVARIANTS) {
    const { rows } = await pool.query(sql);
    expect(rows, `invariant violated: ${description}`).toEqual([]);
  }
}
