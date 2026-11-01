import {
  boundingBoxAround,
  EARTH_RADIUS_M,
  haversineMeters,
  isWithinBoundingBox,
  roadDistanceMeters,
  ROAD_DISTANCE_FACTOR,
  type LatLng,
} from './geo.js';

const LIBERTY_MARKET: LatLng = { lat: 31.5106, lng: 74.344 };
const LAHORE_FORT: LatLng = { lat: 31.5889, lng: 74.3149 };
const ONE_DEGREE_M = (Math.PI * EARTH_RADIUS_M) / 180; // ≈ 111,195 m

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(LIBERTY_MARKET, LIBERTY_MARKET)).toBe(0);
  });

  it('measures one degree of latitude along a meridian as ~111.195 km', () => {
    expect(haversineMeters({ lat: 31, lng: 74.3 }, { lat: 32, lng: 74.3 })).toBeCloseTo(
      ONE_DEGREE_M,
      3,
    );
    expect(ONE_DEGREE_M).toBeCloseTo(111_195, -1);
  });

  it('measures one degree of longitude at the equator as ~111.195 km', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(ONE_DEGREE_M, 3);
  });

  it('shrinks longitude distance with latitude (Lahore, ~31.5°N)', () => {
    const atLahore = haversineMeters({ lat: 31.5, lng: 74 }, { lat: 31.5, lng: 75 });
    expect(atLahore / ONE_DEGREE_M).toBeCloseTo(Math.cos((31.5 * Math.PI) / 180), 3);
  });

  it('measures Liberty Market to Lahore Fort at ~9.1 km', () => {
    const meters = haversineMeters(LIBERTY_MARKET, LAHORE_FORT);
    expect(meters).toBeGreaterThan(9_000);
    expect(meters).toBeLessThan(9_300);
  });

  it('is symmetric', () => {
    expect(haversineMeters(LIBERTY_MARKET, LAHORE_FORT)).toBe(
      haversineMeters(LAHORE_FORT, LIBERTY_MARKET),
    );
  });

  it('stays numerically stable for antipodal points (half the circumference)', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_M,
      0,
    );
  });
});

describe('roadDistanceMeters', () => {
  it('applies the road factor and rounds to whole metres', () => {
    const road = roadDistanceMeters(LIBERTY_MARKET, LAHORE_FORT);
    expect(Number.isInteger(road)).toBe(true);
    expect(road).toBe(
      Math.round(haversineMeters(LIBERTY_MARKET, LAHORE_FORT) * ROAD_DISTANCE_FACTOR),
    );
  });

  it('accepts a custom factor', () => {
    expect(roadDistanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, 1)).toBe(
      Math.round(ONE_DEGREE_M),
    );
  });
});

describe('isWithinBoundingBox', () => {
  const box = { minLat: 31, minLng: 74, maxLat: 32, maxLng: 75 };

  it.each<[string, LatLng, boolean]>([
    ['centre', { lat: 31.5, lng: 74.5 }, true],
    ['south-west corner (inclusive)', { lat: 31, lng: 74 }, true],
    ['north-east corner (inclusive)', { lat: 32, lng: 75 }, true],
    ['south of box', { lat: 30.99, lng: 74.5 }, false],
    ['north of box', { lat: 32.01, lng: 74.5 }, false],
    ['west of box', { lat: 31.5, lng: 73.99 }, false],
    ['east of box', { lat: 31.5, lng: 75.01 }, false],
  ])('%s -> %s', (_label, point, expected) => {
    expect(isWithinBoundingBox(point, box)).toBe(expected);
  });
});

describe('boundingBoxAround', () => {
  const radius = 5_000;
  const box = boundingBoxAround(LIBERTY_MARKET, radius);

  it('touches the circle at each cardinal point', () => {
    const edges: LatLng[] = [
      { lat: box.maxLat, lng: LIBERTY_MARKET.lng },
      { lat: box.minLat, lng: LIBERTY_MARKET.lng },
      { lat: LIBERTY_MARKET.lat, lng: box.maxLng },
      { lat: LIBERTY_MARKET.lat, lng: box.minLng },
    ];
    for (const edge of edges) {
      expect(haversineMeters(LIBERTY_MARKET, edge)).toBeCloseTo(radius, -1);
    }
  });

  it('contains every point within the radius', () => {
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const rad = (bearing * Math.PI) / 180;
      const point = {
        lat: LIBERTY_MARKET.lat + ((radius * 0.99) / ONE_DEGREE_M) * Math.cos(rad),
        lng:
          LIBERTY_MARKET.lng +
          ((radius * 0.99) / (ONE_DEGREE_M * Math.cos((LIBERTY_MARKET.lat * Math.PI) / 180))) *
            Math.sin(rad),
      };
      expect(haversineMeters(LIBERTY_MARKET, point)).toBeLessThan(radius);
      expect(isWithinBoundingBox(point, box)).toBe(true);
    }
  });

  it('is wider in longitude than latitude away from the equator', () => {
    expect(box.maxLng - box.minLng).toBeGreaterThan(box.maxLat - box.minLat);
  });
});
