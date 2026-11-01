import { randomInt, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { RideCategory } from '../../src/common/domain/ride-category.js';
import type { LatLng } from '../../src/common/utils/geo.js';
import type { DriverAvailability } from '../../src/drivers/driver-availability.js';
import { NEAR_LIBERTY } from './fixtures.js';

const phone = () => `+92${randomInt(1_000_000_000, 9_999_999_999)}`;

export async function createRider(pool: Pool, name = 'Test Rider'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO riders (name, phone) VALUES ($1, $2) RETURNING id',
    [name, phone()],
  );
  return (rows[0] as { id: string }).id;
}

export interface DriverOptions {
  category?: RideCategory;
  availability?: Exclude<DriverAvailability, 'BUSY'>;
  /** null = never reported a location. */
  location?: LatLng | null;
  /** How long ago the location was reported (default: just now). */
  locationAgeSeconds?: number;
}

export async function createDriver(pool: Pool, options: DriverOptions = {}): Promise<string> {
  const location = options.location === undefined ? NEAR_LIBERTY : options.location;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO drivers (name, phone, vehicle_category, vehicle_model, vehicle_plate,
                          availability, lat, lng, location_updated_at)
     VALUES ('Test Driver', $1, $2, 'Test Car', $3, $4, $5::float8, $6::float8,
             CASE WHEN $5::float8 IS NULL THEN NULL ELSE now() - make_interval(secs => $7) END)
     RETURNING id`,
    [
      phone(),
      options.category ?? 'ECONOMY',
      `T-${randomUUID().slice(0, 8)}`,
      options.availability ?? 'AVAILABLE',
      location?.lat ?? null,
      location?.lng ?? null,
      options.locationAgeSeconds ?? 0,
    ],
  );
  return (rows[0] as { id: string }).id;
}

export async function createDrivers(pool: Pool, n: number, options: DriverOptions = {}) {
  return Promise.all(Array.from({ length: n }, () => createDriver(pool, options)));
}
