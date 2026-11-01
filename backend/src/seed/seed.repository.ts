import type { Queryable } from '../database/queryable.js';
import type { SeedDriver, SeedRider } from './seed-data.js';

/** SQL used by the seed script. Kept here so SQL stays in repositories, as in the app code. */

export async function insertRidersIfMissing(
  db: Queryable,
  riders: readonly SeedRider[],
): Promise<number> {
  let inserted = 0;
  for (const rider of riders) {
    const result = await db.query(
      `INSERT INTO riders (id, name, phone) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [rider.id, rider.name, rider.phone],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

const DRIVER_COLUMNS = `id, name, phone, vehicle_category, vehicle_model, vehicle_plate,
                        availability, lat, lng, location_updated_at`;

function driverValues(driver: SeedDriver): unknown[] {
  return [
    driver.id,
    driver.name,
    driver.phone,
    driver.vehicleCategory,
    driver.vehicleModel,
    driver.vehiclePlate,
    driver.availability,
    driver.lat,
    driver.lng,
  ];
}

/** Inserts missing drivers only; never touches the availability of existing ones. */
export async function insertDriversIfMissing(
  db: Queryable,
  drivers: readonly SeedDriver[],
): Promise<number> {
  let inserted = 0;
  for (const driver of drivers) {
    const result = await db.query(
      `INSERT INTO drivers (${DRIVER_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (id) DO NOTHING`,
      driverValues(driver),
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/**
 * Marks known driver locations as fresh again. Seeded drivers don't stream GPS, so without
 * this a long-lived demo database would eventually show "no drivers nearby".
 */
export async function refreshDriverLocationTimestamps(
  db: Queryable,
  driverIds: readonly string[],
): Promise<void> {
  await db.query(
    `UPDATE drivers SET location_updated_at = now()
      WHERE id = ANY($1::uuid[]) AND lat IS NOT NULL`,
    [driverIds],
  );
}

/** Restores drivers to their exact seed state (availability and location). */
export async function resetDrivers(db: Queryable, drivers: readonly SeedDriver[]): Promise<number> {
  let upserted = 0;
  for (const driver of drivers) {
    const result = await db.query(
      `INSERT INTO drivers (${DRIVER_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         vehicle_category = EXCLUDED.vehicle_category,
         vehicle_model = EXCLUDED.vehicle_model,
         vehicle_plate = EXCLUDED.vehicle_plate,
         availability = EXCLUDED.availability,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         location_updated_at = now(),
         updated_at = now()`,
      driverValues(driver),
    );
    upserted += result.rowCount ?? 0;
  }
  return upserted;
}

/** Deletes all ride data. Riders and drivers are kept. */
export async function truncateRideData(db: Queryable): Promise<void> {
  await db.query('TRUNCATE TABLE idempotency_keys, fares, ride_assignments, rides');
}
