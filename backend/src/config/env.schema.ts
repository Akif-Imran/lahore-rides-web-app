import { z } from 'zod';

/**
 * Environment contract for the backend. Parsed once at startup; any problem aborts the boot
 * with a readable list (fail fast) instead of surfacing later as a confusing runtime error.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Lahore service area (lat 31.35–31.70, lng 74.10–74.55). */
export const DEFAULT_SERVICE_AREA: BoundingBox = {
  minLat: 31.35,
  minLng: 74.1,
  maxLat: 31.7,
  maxLng: 74.55,
};

const int = () => z.coerce.number().int();

const bboxSchema = z.string().transform((value, ctx): BoundingBox => {
  const parts = value.split(',').map((part) => Number(part.trim()));
  const [minLat, minLng, maxLat, maxLng] = parts;
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isFinite(n)) ||
    minLat === undefined ||
    minLng === undefined ||
    maxLat === undefined ||
    maxLng === undefined
  ) {
    ctx.addIssue({ code: 'custom', message: 'must be "minLat,minLng,maxLat,maxLng"' });
    return z.NEVER;
  }
  const inRange = minLat >= -90 && maxLat <= 90 && minLng >= -180 && maxLng <= 180;
  if (!inRange || minLat >= maxLat || minLng >= maxLng) {
    ctx.addIssue({ code: 'custom', message: 'must have min < max and valid lat/lng ranges' });
    return z.NEVER;
  }
  return { minLat, minLng, maxLat, maxLng };
});

const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'must be a postgres:// connection URL',
  }),
  DB_POOL_MAX: int().min(1).max(100).default(10),
  DB_LOCK_TIMEOUT_MS: int().min(100).default(3000),
  DB_STATEMENT_TIMEOUT_MS: int().min(100).default(5000),

  CORS_ORIGINS: originListSchema.default(['http://localhost:3000']),

  SERVICE_AREA_BBOX: bboxSchema.default(DEFAULT_SERVICE_AREA),
  MAX_OFFER_RADIUS_KM: z.coerce.number().positive().max(100).default(5),
  DRIVER_LOCATION_TTL_SECONDS: int().min(1).default(120),

  RIDE_REQUEST_TTL_SECONDS: int().min(10).default(300),
  RIDE_EXPIRY_SWEEP_ENABLED: z.stringbool().default(true),

  RATE_LIMIT_TTL_SECONDS: int().min(1).default(60),
  RATE_LIMIT_LIMIT: int().min(1).default(120),
  RATE_LIMIT_CREATE_RIDE_LIMIT: int().min(1).default(10),
});

export type Env = z.infer<typeof envSchema>;

export interface DatabaseConfig {
  url: string;
  poolMax: number;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
}

export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  port: number;
  logLevel: LogLevel;
  corsOrigins: string[];
  database: DatabaseConfig;
  serviceArea: BoundingBox;
  matching: {
    maxOfferRadiusKm: number;
    driverLocationTtlSeconds: number;
  };
  rides: {
    requestTtlSeconds: number;
    expirySweepEnabled: boolean;
  };
  rateLimit: {
    ttlSeconds: number;
    limit: number;
    createRideLimit: number;
  };
}

export class ConfigValidationError extends Error {
  override readonly name = 'ConfigValidationError';
}

export function toAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    corsOrigins: env.CORS_ORIGINS,
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DB_POOL_MAX,
      lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    },
    serviceArea: env.SERVICE_AREA_BBOX,
    matching: {
      maxOfferRadiusKm: env.MAX_OFFER_RADIUS_KM,
      driverLocationTtlSeconds: env.DRIVER_LOCATION_TTL_SECONDS,
    },
    rides: {
      requestTtlSeconds: env.RIDE_REQUEST_TTL_SECONDS,
      expirySweepEnabled: env.RIDE_EXPIRY_SWEEP_ENABLED,
    },
    rateLimit: {
      ttlSeconds: env.RATE_LIMIT_TTL_SECONDS,
      limit: env.RATE_LIMIT_LIMIT,
      createRideLimit: env.RATE_LIMIT_CREATE_RIDE_LIMIT,
    },
  };
}

/**
 * Parses and validates the environment. Empty strings are treated as "unset" so that
 * `FOO=` in an env file falls back to the default instead of failing number coercion.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigValidationError(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return toAppConfig(result.data);
}
