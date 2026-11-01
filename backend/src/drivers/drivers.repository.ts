import { Injectable } from '@nestjs/common';
import type { RideCategory } from '../common/domain/ride-category.js';
import { boundingBoxAround, type LatLng } from '../common/utils/geo.js';
import type { Queryable } from '../database/queryable.js';
import { haversineSql } from '../database/sql/haversine.js';
import type { DriverRecord, NearbyDriver } from './driver.types.js';

interface DriverRow {
  id: string;
  name: string;
  vehicle_category: DriverRecord['vehicleCategory'];
  vehicle_model: string;
  vehicle_plate: string;
  availability: DriverRecord['availability'];
  lat: number | null;
  lng: number | null;
  location_updated_at: Date | null;
  updated_at: Date;
}

const DRIVER_COLUMNS = `id, name, vehicle_category, vehicle_model, vehicle_plate, availability,
  lat, lng, location_updated_at, updated_at`;

function toDriverRecord(row: DriverRow): DriverRecord {
  return {
    id: row.id,
    name: row.name,
    vehicleCategory: row.vehicle_category,
    vehicleModel: row.vehicle_model,
    vehiclePlate: row.vehicle_plate,
    availability: row.availability,
    lat: row.lat,
    lng: row.lng,
    locationUpdatedAt: row.location_updated_at,
    updatedAt: row.updated_at,
  };
}

export interface NearestAvailableQuery {
  vehicleCategories: readonly RideCategory[];
  center: LatLng;
  radiusM: number;
  locationTtlSeconds: number;
  limit: number;
}

@Injectable()
export class DriversRepository {
  async findById(db: Queryable, id: string): Promise<DriverRecord | null> {
    const { rows } = await db.query<DriverRow>(
      `SELECT ${DRIVER_COLUMNS} FROM drivers WHERE id = $1`,
      [id],
    );
    return rows[0] ? toDriverRecord(rows[0]) : null;
  }

  /** Row lock. Always taken after the ride lock (lock order ride -> driver). */
  async findByIdForUpdate(tx: Queryable, id: string): Promise<DriverRecord | null> {
    const { rows } = await tx.query<DriverRow>(
      `SELECT ${DRIVER_COLUMNS} FROM drivers WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ? toDriverRecord(rows[0]) : null;
  }

  /** AVAILABLE -> BUSY as a compare-and-swap. False if the driver was not AVAILABLE. */
  async markBusy(tx: Queryable, id: string): Promise<boolean> {
    const result = await tx.query(
      `UPDATE drivers SET availability = 'BUSY', updated_at = now()
        WHERE id = $1 AND availability = 'AVAILABLE'`,
      [id],
    );
    return result.rowCount === 1;
  }

  /** BUSY -> AVAILABLE when a trip ends. False if the driver was not BUSY. */
  async releaseFromTrip(tx: Queryable, id: string): Promise<boolean> {
    const result = await tx.query(
      `UPDATE drivers SET availability = 'AVAILABLE', updated_at = now()
        WHERE id = $1 AND availability = 'BUSY'`,
      [id],
    );
    return result.rowCount === 1;
  }

  /**
   * Driver-initiated AVAILABLE/OFFLINE toggle, optionally reporting a new location.
   * Never touches a BUSY driver: that state belongs to the ride lifecycle. Null if BUSY.
   */
  async setAvailability(
    tx: Queryable,
    id: string,
    availability: 'AVAILABLE' | 'OFFLINE',
    location: LatLng | null,
  ): Promise<DriverRecord | null> {
    const { rows } = await tx.query<DriverRow>(
      `UPDATE drivers SET
          availability = $2,
          lat = COALESCE($3::float8, lat),
          lng = COALESCE($4::float8, lng),
          location_updated_at = CASE WHEN $3::float8 IS NULL THEN location_updated_at ELSE now() END,
          updated_at = now()
        WHERE id = $1 AND availability <> 'BUSY'
        RETURNING ${DRIVER_COLUMNS}`,
      [id, availability, location?.lat ?? null, location?.lng ?? null],
    );
    return rows[0] ? toDriverRecord(rows[0]) : null;
  }

  /**
   * Nearest AVAILABLE drivers with a fresh location within `radiusM`, closest first.
   * The bounding box lets Postgres discard far-away rows before computing Haversine.
   * Production: PostGIS `ST_DWithin` on a GiST index, or an H3/Redis geo index.
   */
  async findNearestAvailable(db: Queryable, query: NearestAvailableQuery): Promise<NearbyDriver[]> {
    const box = boundingBoxAround(query.center, query.radiusM);
    const { rows } = await db.query<{ id: string; distance_m: number }>(
      `SELECT d.id, geo.distance_m
         FROM drivers d
         CROSS JOIN LATERAL (
           SELECT ${haversineSql('d.lat', 'd.lng', '$1::float8', '$2::float8')} AS distance_m
         ) geo
        WHERE d.availability = 'AVAILABLE'
          AND d.vehicle_category = ANY($3::text[])
          AND d.location_updated_at >= now() - make_interval(secs => $4::float8)
          AND d.lat BETWEEN $5 AND $6
          AND d.lng BETWEEN $7 AND $8
          AND geo.distance_m <= $9
        ORDER BY geo.distance_m
        LIMIT $10`,
      [
        query.center.lat,
        query.center.lng,
        query.vehicleCategories,
        query.locationTtlSeconds,
        box.minLat,
        box.maxLat,
        box.minLng,
        box.maxLng,
        query.radiusM,
        query.limit,
      ],
    );
    return rows.map((row) => ({ id: row.id, distanceM: row.distance_m }));
  }
}
