import type { RideCategory } from './ride-category.js';

/**
 * The authenticated caller of a request, resolved by the actor guard from `X-Rider-Id` /
 * `X-Driver-Id`. Drivers carry their vehicle category because ride visibility depends on it.
 */
export type Caller =
  { kind: 'RIDER'; id: string } | { kind: 'DRIVER'; id: string; vehicleCategory: RideCategory };
