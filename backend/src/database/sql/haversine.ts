import { EARTH_RADIUS_M } from '../../common/utils/geo.js';

/**
 * SQL expression for the great-circle distance in metres between a row's coordinates and a
 * point given as two query parameters. Same formula and radius as `haversineMeters()` in
 * common/utils/geo.ts, so SQL-side filtering agrees with TypeScript-side ETAs.
 * Callers pair it with a bounding-box predicate so the planner can prune rows cheaply first.
 */
export function haversineSql(
  latColumn: string,
  lngColumn: string,
  latParam: string,
  lngParam: string,
): string {
  return `(2 * ${EARTH_RADIUS_M} * asin(least(1, sqrt(
      power(sin(radians(${latColumn} - ${latParam}) / 2), 2) +
      cos(radians(${latParam})) * cos(radians(${latColumn})) *
      power(sin(radians(${lngColumn} - ${lngParam}) / 2), 2)
    ))))`;
}
