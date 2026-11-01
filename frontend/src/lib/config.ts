/**
 * Public, non-secret runtime configuration. `process.env.NEXT_PUBLIC_*` must be referenced
 * literally so Next.js can inline it into the browser bundle at build time.
 */
const DEFAULT_API_BASE_URL = 'http://localhost:3001/api/v1';

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
  /\/+$/,
  '',
);

/** Per-request timeout; after it the request fails as NETWORK_ERROR (blueprint 5.4.1). */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Ride status and driver console polling period while something can still change. */
export const POLL_INTERVAL_MS = 3_000;

/** Debounce before asking for a fare estimate after the trip inputs change. */
export const ESTIMATE_DEBOUNCE_MS = 300;

/**
 * Mirrors the backend's default service area (`DEFAULT_SERVICE_AREA` in env.schema.ts).
 * Used only to place pins on the map placeholder; the backend remains the validator.
 */
export const SERVICE_AREA = { minLat: 31.35, maxLat: 31.7, minLng: 74.1, maxLng: 74.55 } as const;
