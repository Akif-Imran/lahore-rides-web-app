-- Up Migration

-- gen_random_uuid() is built into PostgreSQL 13+; pgcrypto is enabled for portability.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE riders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(120) NOT NULL,
  phone       varchar(20)  NOT NULL UNIQUE,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE drivers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 varchar(120) NOT NULL,
  phone                varchar(20)  NOT NULL UNIQUE,
  vehicle_category     text NOT NULL CHECK (vehicle_category IN ('ECONOMY','COMFORT')),
  vehicle_model        varchar(80)  NOT NULL,
  vehicle_plate        varchar(20)  NOT NULL UNIQUE,
  availability         text NOT NULL DEFAULT 'OFFLINE'
                         CHECK (availability IN ('OFFLINE','AVAILABLE','BUSY')),
  lat                  double precision CHECK (lat BETWEEN -90 AND 90),
  lng                  double precision CHECK (lng BETWEEN -180 AND 180),
  location_updated_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- A location is either fully known or not known at all.
  CONSTRAINT chk_driver_location_pair CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE INDEX idx_drivers_available ON drivers (vehicle_category, availability)
  WHERE availability = 'AVAILABLE';

CREATE TABLE rides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id         uuid NOT NULL REFERENCES riders(id),
  driver_id        uuid REFERENCES drivers(id),
  category         text NOT NULL CHECK (category IN ('ECONOMY','COMFORT')),
  status           text NOT NULL DEFAULT 'REQUESTED'
                     CHECK (status IN ('REQUESTED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED')),
  pickup_name      varchar(160) NOT NULL,
  pickup_lat       double precision NOT NULL,
  pickup_lng       double precision NOT NULL,
  dest_name        varchar(160) NOT NULL,
  dest_lat         double precision NOT NULL,
  dest_lng         double precision NOT NULL,
  distance_m       integer NOT NULL CHECK (distance_m > 0),
  duration_s       integer NOT NULL CHECK (duration_s > 0),
  eta_minutes      integer,
  cancelled_by     text CHECK (cancelled_by IN ('RIDER','DRIVER','SYSTEM')),
  cancel_reason    varchar(255),
  version          integer NOT NULL DEFAULT 1,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  assigned_at      timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_driver_consistency CHECK (
    (status = 'REQUESTED' AND driver_id IS NULL) OR
    (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED') AND driver_id IS NOT NULL) OR
    (status IN ('CANCELLED','EXPIRED'))
  )
);
CREATE INDEX idx_rides_rider ON rides (rider_id, requested_at DESC);
CREATE INDEX idx_rides_open ON rides (category, requested_at) WHERE status = 'REQUESTED';
-- One active ride per rider: the database-level backstop against duplicate ride requests.
CREATE UNIQUE INDEX uq_one_active_ride_per_rider ON rides (rider_id)
  WHERE status IN ('REQUESTED','ASSIGNED','IN_PROGRESS');

CREATE TABLE ride_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL REFERENCES rides(id),
  driver_id   uuid NOT NULL REFERENCES drivers(id),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
-- The hard guarantees: one active driver per ride, one active ride per driver.
CREATE UNIQUE INDEX uq_active_assignment_per_ride   ON ride_assignments (ride_id)   WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_active_assignment_per_driver ON ride_assignments (driver_id) WHERE status = 'ACTIVE';

CREATE TABLE fares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id          uuid NOT NULL UNIQUE REFERENCES rides(id),
  currency         char(3) NOT NULL DEFAULT 'PKR',
  base_amount      integer NOT NULL CHECK (base_amount >= 0),
  distance_amount  integer NOT NULL CHECK (distance_amount >= 0),
  time_amount      integer NOT NULL CHECK (time_amount >= 0),
  surge_multiplier numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (surge_multiplier >= 1),
  estimated_total  integer NOT NULL CHECK (estimated_total >= 0),
  final_total      integer CHECK (final_total >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id         uuid NOT NULL REFERENCES riders(id),
  key              uuid NOT NULL,
  request_hash     char(64) NOT NULL,
  response_status  integer,
  response_body    jsonb,
  ride_id          uuid REFERENCES rides(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rider_id, key)
);

-- Down Migration

-- Reverse dependency order. The pgcrypto extension is left in place (it may be shared).
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS fares;
DROP TABLE IF EXISTS ride_assignments;
DROP TABLE IF EXISTS rides;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS riders;
