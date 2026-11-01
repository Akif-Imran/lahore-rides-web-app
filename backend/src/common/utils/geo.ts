/**
 * Minimal geo helpers. Straight-line (great-circle) distance stands in for a routing engine;
 * a fixed road factor approximates the real driving distance. In production this would be
 * replaced by a routing service (OSRM/Valhalla/Google) for distance and ETA.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

/** Driving distance is on average ~30% longer than the straight line in a dense city. */
export const ROAD_DISTANCE_FACTOR = 1.3;

/** Metres per degree of latitude (and of longitude at the equator). */
const METERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated driving distance, whole metres. */
export function roadDistanceMeters(a: LatLng, b: LatLng, factor = ROAD_DISTANCE_FACTOR): number {
  return Math.round(haversineMeters(a, b) * factor);
}

export function isWithinBoundingBox(point: LatLng, box: BoundingBox): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}

/**
 * Smallest lat/lng box containing a circle of `radiusMeters` around `center`. Used as a cheap,
 * index-friendly prefilter before the exact Haversine check.
 */
export function boundingBoxAround(center: LatLng, radiusMeters: number): BoundingBox {
  const dLat = radiusMeters / METERS_PER_DEGREE;
  const dLng = radiusMeters / (METERS_PER_DEGREE * Math.cos(toRadians(center.lat)));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}
