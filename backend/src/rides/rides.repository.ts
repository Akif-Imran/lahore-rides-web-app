import { Injectable } from '@nestjs/common';
import type { RideCategory } from '../common/domain/ride-category.js';
import { boundingBoxAround, type LatLng } from '../common/utils/geo.js';
import type { Queryable } from '../database/queryable.js';
import { haversineSql } from '../database/sql/haversine.js';
import type {
  CancelledBy,
  NewRide,
  OpenRideNearby,
  RideDetails,
  RideRecord,
} from './ride.types.js';
import type { RideStatus } from './ride-status.js';

interface RideRow {
  id: string;
  rider_id: string;
  driver_id: string | null;
  category: RideCategory;
  status: RideStatus;
  pickup_name: string;
  pickup_lat: number;
  pickup_lng: number;
  dest_name: string;
  dest_lat: number;
  dest_lng: number;
  distance_m: number;
  duration_s: number;
  eta_minutes: number | null;
  cancelled_by: CancelledBy | null;
  cancel_reason: string | null;
  version: number;
  requested_at: Date;
  assigned_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  updated_at: Date;
}

interface RideDetailsRow extends RideRow {
  currency: string;
  base_amount: number;
  distance_amount: number;
  time_amount: number;
  surge_multiplier: number;
  estimated_total: number;
  final_total: number | null;
  driver_name: string | null;
  driver_vehicle_category: RideCategory | null;
  driver_vehicle_model: string | null;
  driver_vehicle_plate: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
}

const RIDE_COLUMNS = `r.id, r.rider_id, r.driver_id, r.category, r.status,
  r.pickup_name, r.pickup_lat, r.pickup_lng, r.dest_name, r.dest_lat, r.dest_lng,
  r.distance_m, r.duration_s, r.eta_minutes, r.cancelled_by, r.cancel_reason, r.version,
  r.requested_at, r.assigned_at, r.started_at, r.completed_at, r.cancelled_at, r.updated_at`;

// numeric comes back from pg as a string; cast so the row type is honest.
const FARE_COLUMNS = `f.currency, f.base_amount, f.distance_amount, f.time_amount,
  f.surge_multiplier::float8 AS surge_multiplier, f.estimated_total, f.final_total`;

const DRIVER_SUMMARY_COLUMNS = `d.name AS driver_name, d.vehicle_category AS driver_vehicle_category,
  d.vehicle_model AS driver_vehicle_model, d.vehicle_plate AS driver_vehicle_plate,
  d.lat AS driver_lat, d.lng AS driver_lng`;

const DETAILS_FROM = `FROM rides r
  JOIN fares f ON f.ride_id = r.id
  LEFT JOIN drivers d ON d.id = r.driver_id`;

function toRideRecord(row: RideRow): RideRecord {
  return {
    id: row.id,
    riderId: row.rider_id,
    driverId: row.driver_id,
    category: row.category,
    status: row.status,
    pickup: { name: row.pickup_name, lat: row.pickup_lat, lng: row.pickup_lng },
    destination: { name: row.dest_name, lat: row.dest_lat, lng: row.dest_lng },
    distanceM: row.distance_m,
    durationS: row.duration_s,
    etaMinutes: row.eta_minutes,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    version: row.version,
    requestedAt: row.requested_at,
    assignedAt: row.assigned_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    updatedAt: row.updated_at,
  };
}

function toRideDetails(row: RideDetailsRow): RideDetails {
  const hasDriver =
    row.driver_id !== null &&
    row.driver_name !== null &&
    row.driver_vehicle_category !== null &&
    row.driver_vehicle_model !== null &&
    row.driver_vehicle_plate !== null;
  return {
    ride: toRideRecord(row),
    fare: {
      currency: row.currency,
      baseAmount: row.base_amount,
      distanceAmount: row.distance_amount,
      timeAmount: row.time_amount,
      surgeMultiplier: row.surge_multiplier,
      estimatedTotal: row.estimated_total,
      finalTotal: row.final_total,
    },
    driver: hasDriver
      ? {
          id: row.driver_id as string,
          name: row.driver_name as string,
          vehicleCategory: row.driver_vehicle_category as RideCategory,
          vehicleModel: row.driver_vehicle_model as string,
          vehiclePlate: row.driver_vehicle_plate as string,
          lat: row.driver_lat,
          lng: row.driver_lng,
        }
      : null,
  };
}

export interface OpenOffersQuery {
  rideCategories: readonly RideCategory[];
  center: LatLng;
  radiusM: number;
  limit: number;
}

@Injectable()
export class RidesRepository {
  async insert(tx: Queryable, ride: NewRide): Promise<RideRecord> {
    const { rows } = await tx.query<RideRow>(
      `INSERT INTO rides AS r (rider_id, category, pickup_name, pickup_lat, pickup_lng,
                               dest_name, dest_lat, dest_lng, distance_m, duration_s, eta_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${RIDE_COLUMNS}`,
      [
        ride.riderId,
        ride.category,
        ride.pickup.name,
        ride.pickup.lat,
        ride.pickup.lng,
        ride.destination.name,
        ride.destination.lat,
        ride.destination.lng,
        ride.distanceM,
        ride.durationS,
        ride.etaMinutes,
      ],
    );
    return toRideRecord(rows[0] as RideRow);
  }

  /**
   * Row lock on the ride. Every lifecycle transaction takes this first, which serialises
   * concurrent accept/start/cancel/complete calls on the same ride.
   */
  async findByIdForUpdate(tx: Queryable, id: string): Promise<RideRecord | null> {
    const { rows } = await tx.query<RideRow>(
      `SELECT ${RIDE_COLUMNS} FROM rides r WHERE r.id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ? toRideRecord(rows[0]) : null;
  }

  async findDetailsById(db: Queryable, id: string): Promise<RideDetails | null> {
    const { rows } = await db.query<RideDetailsRow>(
      `SELECT ${RIDE_COLUMNS}, ${FARE_COLUMNS}, ${DRIVER_SUMMARY_COLUMNS} ${DETAILS_FROM}
        WHERE r.id = $1`,
      [id],
    );
    return rows[0] ? toRideDetails(rows[0]) : null;
  }

  /** The rider's REQUESTED/ASSIGNED/IN_PROGRESS ride (at most one, by unique index). */
  async findActiveDetailsByRider(db: Queryable, riderId: string): Promise<RideDetails | null> {
    const { rows } = await db.query<RideDetailsRow>(
      `SELECT ${RIDE_COLUMNS}, ${FARE_COLUMNS}, ${DRIVER_SUMMARY_COLUMNS} ${DETAILS_FROM}
        WHERE r.rider_id = $1 AND r.status IN ('REQUESTED', 'ASSIGNED', 'IN_PROGRESS')`,
      [riderId],
    );
    return rows[0] ? toRideDetails(rows[0]) : null;
  }

  /** The driver's ASSIGNED/IN_PROGRESS ride (at most one, by unique index on assignments). */
  async findActiveDetailsByDriver(db: Queryable, driverId: string): Promise<RideDetails | null> {
    const { rows } = await db.query<RideDetailsRow>(
      `SELECT ${RIDE_COLUMNS}, ${FARE_COLUMNS}, ${DRIVER_SUMMARY_COLUMNS} ${DETAILS_FROM}
        WHERE r.driver_id = $1 AND r.status IN ('ASSIGNED', 'IN_PROGRESS')`,
      [driverId],
    );
    return rows[0] ? toRideDetails(rows[0]) : null;
  }

  // Each transition below is a compare-and-swap on the expected status: it returns false
  // (and changes nothing) if another transaction moved the ride first.

  async markAssigned(tx: Queryable, rideId: string, driverId: string): Promise<boolean> {
    const result = await tx.query(
      `UPDATE rides SET status = 'ASSIGNED', driver_id = $2, assigned_at = now(),
              version = version + 1, updated_at = now()
        WHERE id = $1 AND status = 'REQUESTED'`,
      [rideId, driverId],
    );
    return result.rowCount === 1;
  }

  async markStarted(tx: Queryable, rideId: string): Promise<boolean> {
    const result = await tx.query(
      `UPDATE rides SET status = 'IN_PROGRESS', started_at = now(),
              version = version + 1, updated_at = now()
        WHERE id = $1 AND status = 'ASSIGNED'`,
      [rideId],
    );
    return result.rowCount === 1;
  }

  async markCompleted(tx: Queryable, rideId: string): Promise<boolean> {
    const result = await tx.query(
      `UPDATE rides SET status = 'COMPLETED', completed_at = now(),
              version = version + 1, updated_at = now()
        WHERE id = $1 AND status = 'IN_PROGRESS'`,
      [rideId],
    );
    return result.rowCount === 1;
  }

  async markCancelled(
    tx: Queryable,
    rideId: string,
    expectedStatus: 'REQUESTED' | 'ASSIGNED',
    cancelledBy: CancelledBy,
    reason: string | null,
  ): Promise<boolean> {
    const result = await tx.query(
      `UPDATE rides SET status = 'CANCELLED', cancelled_by = $3, cancel_reason = $4,
              cancelled_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1 AND status = $2`,
      [rideId, expectedStatus, cancelledBy, reason],
    );
    return result.rowCount === 1;
  }

  /**
   * REQUESTED -> EXPIRED for requests older than the TTL. Safe without explicit locks: the
   * conditional UPDATE waits for any in-flight accept holding the row lock, re-checks
   * `status = 'REQUESTED'` on the committed row, and skips rides that were just assigned.
   */
  async expireRequestedBefore(db: Queryable, ttlSeconds: number): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE rides SET status = 'EXPIRED', version = version + 1, updated_at = now()
        WHERE status = 'REQUESTED'
          AND requested_at < now() - make_interval(secs => $1::float8)
        RETURNING id`,
      [ttlSeconds],
    );
    return rows.map((row) => row.id);
  }

  /** Open rides a driver could take, nearest pickup first (the driver's offer list). */
  async findOpenNear(db: Queryable, query: OpenOffersQuery): Promise<OpenRideNearby[]> {
    const box = boundingBoxAround(query.center, query.radiusM);
    const { rows } = await db.query<RideDetailsRow & { distance_to_pickup_m: number }>(
      `SELECT ${RIDE_COLUMNS}, ${FARE_COLUMNS}, ${DRIVER_SUMMARY_COLUMNS},
              geo.distance_m AS distance_to_pickup_m
         ${DETAILS_FROM}
         CROSS JOIN LATERAL (
           SELECT ${haversineSql('r.pickup_lat', 'r.pickup_lng', '$1::float8', '$2::float8')} AS distance_m
         ) geo
        WHERE r.status = 'REQUESTED'
          AND r.category = ANY($3::text[])
          AND r.pickup_lat BETWEEN $4 AND $5
          AND r.pickup_lng BETWEEN $6 AND $7
          AND geo.distance_m <= $8
        ORDER BY geo.distance_m, r.requested_at
        LIMIT $9`,
      [
        query.center.lat,
        query.center.lng,
        query.rideCategories,
        box.minLat,
        box.maxLat,
        box.minLng,
        box.maxLng,
        query.radiusM,
        query.limit,
      ],
    );
    return rows.map((row) => ({
      details: toRideDetails(row),
      distanceM: row.distance_to_pickup_m,
    }));
  }
}
