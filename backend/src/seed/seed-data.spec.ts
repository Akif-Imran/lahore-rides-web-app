import { DEFAULT_SERVICE_AREA } from '../config/env.schema.js';
import { SEED_DRIVERS, SEED_RIDERS } from './seed-data.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('seed data', () => {
  const ids = [...SEED_RIDERS, ...SEED_DRIVERS].map((actor) => actor.id);

  it('uses unique v4 UUIDs (the API validates ids as UUID v4)', () => {
    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique phones and plates (UNIQUE columns)', () => {
    const phones = [...SEED_RIDERS, ...SEED_DRIVERS].map((actor) => actor.phone);
    const plates = SEED_DRIVERS.map((driver) => driver.vehiclePlate);
    expect(new Set(phones).size).toBe(phones.length);
    expect(new Set(plates).size).toBe(plates.length);
  });

  it('matches the blueprint mix: 3 riders, 4 Economy + 2 Comfort drivers', () => {
    expect(SEED_RIDERS).toHaveLength(3);
    expect(SEED_DRIVERS.filter((d) => d.vehicleCategory === 'ECONOMY')).toHaveLength(4);
    expect(SEED_DRIVERS.filter((d) => d.vehicleCategory === 'COMFORT')).toHaveLength(2);
  });

  it('places every driver inside the Lahore service area', () => {
    const { minLat, maxLat, minLng, maxLng } = DEFAULT_SERVICE_AREA;
    for (const driver of SEED_DRIVERS) {
      expect(driver.lat, driver.name).toBeGreaterThanOrEqual(minLat);
      expect(driver.lat, driver.name).toBeLessThanOrEqual(maxLat);
      expect(driver.lng, driver.name).toBeGreaterThanOrEqual(minLng);
      expect(driver.lng, driver.name).toBeLessThanOrEqual(maxLng);
    }
  });

  it('keeps most drivers available so the demo has supply', () => {
    const available = SEED_DRIVERS.filter((d) => d.availability === 'AVAILABLE');
    expect(available.length).toBeGreaterThanOrEqual(SEED_DRIVERS.length - 1);
  });
});
