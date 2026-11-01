import { ValidationError } from '../common/errors/index.js';
import { DEFAULT_SERVICE_AREA } from '../config/env.schema.js';
import type { LatLng } from '../common/utils/geo.js';
import { MIN_TRIP_DISTANCE_M, validateTrip } from './trip-validation.js';

const LIBERTY_MARKET: LatLng = { lat: 31.5106, lng: 74.344 };
const LAHORE_FORT: LatLng = { lat: 31.5889, lng: 74.3149 };
const ISLAMABAD: LatLng = { lat: 33.6844, lng: 73.0479 };
const KARACHI: LatLng = { lat: 24.8607, lng: 67.0011 };

/** Metres of latitude per degree (mean Earth radius). */
const M_PER_DEG_LAT = 111_195;
const north = (point: LatLng, meters: number): LatLng => ({
  lat: point.lat + meters / M_PER_DEG_LAT,
  lng: point.lng,
});

function fieldErrors(pickup: LatLng, destination: LatLng) {
  try {
    validateTrip(pickup, destination, DEFAULT_SERVICE_AREA);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400 });
    return (error as ValidationError).details?.['fields'];
  }
}

describe('validateTrip', () => {
  it('accepts a normal trip inside Lahore', () => {
    expect(() => validateTrip(LIBERTY_MARKET, LAHORE_FORT, DEFAULT_SERVICE_AREA)).not.toThrow();
  });

  it('rejects a pickup outside the service area', () => {
    expect(fieldErrors(ISLAMABAD, LAHORE_FORT)).toEqual([
      expect.objectContaining({ field: 'pickup', code: 'OUT_OF_SERVICE_AREA' }),
    ]);
  });

  it('rejects a destination outside the service area', () => {
    expect(fieldErrors(LIBERTY_MARKET, KARACHI)).toEqual([
      expect.objectContaining({ field: 'destination', code: 'OUT_OF_SERVICE_AREA' }),
    ]);
  });

  it('reports every problem at once', () => {
    expect(fieldErrors(ISLAMABAD, KARACHI)).toEqual([
      expect.objectContaining({ field: 'pickup', code: 'OUT_OF_SERVICE_AREA' }),
      expect.objectContaining({ field: 'destination', code: 'OUT_OF_SERVICE_AREA' }),
    ]);
  });

  it('rejects identical pickup and destination', () => {
    expect(fieldErrors(LIBERTY_MARKET, LIBERTY_MARKET)).toEqual([
      expect.objectContaining({ field: 'destination', code: 'TRIP_TOO_SHORT' }),
    ]);
  });

  it(`enforces the ${MIN_TRIP_DISTANCE_M} m minimum distance`, () => {
    expect(fieldErrors(LIBERTY_MARKET, north(LIBERTY_MARKET, 150))).toEqual([
      expect.objectContaining({ code: 'TRIP_TOO_SHORT' }),
    ]);
    expect(fieldErrors(LIBERTY_MARKET, north(LIBERTY_MARKET, 250))).toEqual([]);
  });

  it('treats the service-area edge as inside', () => {
    const { minLat, minLng, maxLat, maxLng } = DEFAULT_SERVICE_AREA;
    expect(fieldErrors({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng })).toEqual([]);
  });
});
