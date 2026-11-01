export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Smallest span shown, in degrees (~2 km), so a short trip is not zoomed absurdly far in. */
const MIN_SPAN_DEG = 0.02;

/**
 * Bounds around `points` with relative `padding`, widened to fill `size` without distorting
 * shapes (longitude degrees are scaled by cos(latitude), as on a real map). With no points it
 * frames `fallback` (the whole service area).
 */
export function fitBounds(
  points: readonly LatLng[],
  size: Size,
  fallback: Bounds,
  padding = 0.25,
): Bounds {
  if (points.length === 0) {
    const corners = [
      { lat: fallback.minLat, lng: fallback.minLng },
      { lat: fallback.maxLat, lng: fallback.maxLng },
    ];
    return fitBounds(corners, size, fallback, 0);
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);

  // Work in "screen degrees" where one unit is the same distance on both axes.
  let spanY = Math.max(Math.max(...lats) - Math.min(...lats), MIN_SPAN_DEG) * (1 + 2 * padding);
  let spanX =
    Math.max((Math.max(...lngs) - Math.min(...lngs)) * lngScale, MIN_SPAN_DEG) * (1 + 2 * padding);

  const aspect = size.width / size.height;
  if (spanX / spanY < aspect) spanX = spanY * aspect;
  else spanY = spanX / aspect;

  const halfLng = spanX / lngScale / 2;
  return {
    minLat: midLat - spanY / 2,
    maxLat: midLat + spanY / 2,
    minLng: midLng - halfLng,
    maxLng: midLng + halfLng,
  };
}

/** Equirectangular projection into an SVG viewport (y grows downwards). */
export function project(point: LatLng, bounds: Bounds, size: Size): { x: number; y: number } {
  const x = ((point.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * size.width;
  const y = ((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat)) * size.height;
  return { x, y };
}
