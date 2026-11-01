import { describe, expect, it } from 'vitest';
// The backend's seed is the source of truth for the demo identities; the frontend mirrors it.
import { SEED_DRIVERS, SEED_RIDERS } from '../../../backend/src/seed/seed-data';
import { SERVICE_AREA } from '@/lib/config';
import { DEMO_DRIVERS, DEMO_RIDERS } from '@/lib/demo-actors';
import { LANDMARKS } from '@/lib/landmarks';

/** Great-circle distance in metres (same formula as the backend's geo.ts). */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe('demo actors mirror the backend seed (DECISIONS D2)', () => {
  it('has the same riders', () => {
    expect(DEMO_RIDERS).toEqual(SEED_RIDERS.map(({ id, name }) => ({ id, name })));
  });

  it('has the same drivers, vehicles and home positions', () => {
    expect(DEMO_DRIVERS).toEqual(
      SEED_DRIVERS.map((d) => ({
        id: d.id,
        name: d.name,
        vehicleCategory: d.vehicleCategory,
        vehicle: d.vehicleModel,
        plate: d.vehiclePlate,
        area: d.area,
        home: { lat: d.lat, lng: d.lng },
      })),
    );
  });
});

describe('landmarks', () => {
  it('lists the 12 landmarks from the blueprint with unique ids', () => {
    expect(LANDMARKS).toHaveLength(12);
    expect(new Set(LANDMARKS.map((l) => l.id)).size).toBe(12);
    expect(LANDMARKS.map((l) => l.name)).toEqual(
      expect.arrayContaining([
        'Liberty Market',
        'Lahore Fort',
        'Badshahi Mosque',
        'Gaddafi Stadium',
        'Emporium Mall',
        'Packages Mall',
        'Johar Town',
        'DHA Phase 5',
        'Model Town',
        'Mall Road',
      ]),
    );
  });

  it('are all inside the service area', () => {
    for (const l of LANDMARKS) {
      expect(l.lat, l.name).toBeGreaterThanOrEqual(SERVICE_AREA.minLat);
      expect(l.lat, l.name).toBeLessThanOrEqual(SERVICE_AREA.maxLat);
      expect(l.lng, l.name).toBeGreaterThanOrEqual(SERVICE_AREA.minLng);
      expect(l.lng, l.name).toBeLessThanOrEqual(SERVICE_AREA.maxLng);
    }
  });

  it('are pairwise further apart than the 200 m minimum trip', () => {
    for (const a of LANDMARKS) {
      for (const b of LANDMARKS) {
        if (a.id < b.id) expect(haversineMeters(a, b), `${a.name}–${b.name}`).toBeGreaterThan(200);
      }
    }
  });

  it('each has an available seeded driver for Economy rides within 5 km (DECISIONS D17)', () => {
    // Backend rule: Economy rides can be served by Economy *and* Comfort cars; the radius is a
    // straight-line (Haversine) distance. Hamza (Model Town) is seeded OFFLINE.
    const economyEligible = SEED_DRIVERS.filter((d) => d.availability === 'AVAILABLE');
    for (const landmark of LANDMARKS) {
      const nearest = Math.min(...economyEligible.map((d) => haversineMeters(landmark, d)));
      expect(nearest, landmark.name).toBeLessThanOrEqual(5_000);
    }
  });

  it('Comfort has coverage gaps on the outskirts, which exercises the empty state', () => {
    const comfort = SEED_DRIVERS.filter(
      (d) => d.vehicleCategory === 'COMFORT' && d.availability === 'AVAILABLE',
    );
    const uncovered = LANDMARKS.filter(
      (l) => Math.min(...comfort.map((d) => haversineMeters(l, d))) > 5_000,
    );
    expect(uncovered.length).toBeGreaterThan(0);
  });
});
