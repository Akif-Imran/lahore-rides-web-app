import { describe, expect, it } from 'vitest';
import { SERVICE_AREA } from '@/lib/config';
import { fitBounds, project } from '@/lib/map-projection';

const SIZE = { width: 400, height: 300 };
const libertyMarket = { lat: 31.5106, lng: 74.344 };
const lahoreFort = { lat: 31.588, lng: 74.315 };

/** Ground distance per pixel on each axis (km); equal means no distortion. */
function kmPerPixel(bounds: ReturnType<typeof fitBounds>) {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const kmPerDegLat = 111.195;
  const kmPerDegLng = kmPerDegLat * Math.cos((midLat * Math.PI) / 180);
  return {
    x: ((bounds.maxLng - bounds.minLng) * kmPerDegLng) / SIZE.width,
    y: ((bounds.maxLat - bounds.minLat) * kmPerDegLat) / SIZE.height,
  };
}

describe('fitBounds + project', () => {
  it('keeps every point inside the viewport with padding', () => {
    const bounds = fitBounds([libertyMarket, lahoreFort], SIZE, SERVICE_AREA);
    for (const point of [libertyMarket, lahoreFort]) {
      const { x, y } = project(point, bounds, SIZE);
      expect(x).toBeGreaterThan(20);
      expect(x).toBeLessThan(SIZE.width - 20);
      expect(y).toBeGreaterThan(20);
      expect(y).toBeLessThan(SIZE.height - 20);
    }
  });

  it('puts north at the top and east to the right', () => {
    const bounds = fitBounds([libertyMarket, lahoreFort], SIZE, SERVICE_AREA);
    const liberty = project(libertyMarket, bounds, SIZE);
    const fort = project(lahoreFort, bounds, SIZE);
    expect(fort.y).toBeLessThan(liberty.y); // the fort is further north
    expect(fort.x).toBeLessThan(liberty.x); // and further west
  });

  it('preserves shape: one pixel is the same distance on both axes', () => {
    const bounds = fitBounds([libertyMarket, lahoreFort], SIZE, SERVICE_AREA);
    const scale = kmPerPixel(bounds);
    expect(scale.x).toBeCloseTo(scale.y, 6);
  });

  it('frames a single point with a minimum span instead of zooming infinitely', () => {
    const bounds = fitBounds([libertyMarket], SIZE, SERVICE_AREA);
    expect(bounds.maxLat - bounds.minLat).toBeGreaterThan(0.02);
    const { x, y } = project(libertyMarket, bounds, SIZE);
    expect(x).toBeCloseTo(SIZE.width / 2, 6);
    expect(y).toBeCloseTo(SIZE.height / 2, 6);
  });

  it('frames the whole service area when there are no points', () => {
    const bounds = fitBounds([], SIZE, SERVICE_AREA);
    const EPS = 1e-9; // floating-point slack
    expect(bounds.minLat).toBeLessThanOrEqual(SERVICE_AREA.minLat + EPS);
    expect(bounds.maxLat).toBeGreaterThanOrEqual(SERVICE_AREA.maxLat - EPS);
    expect(bounds.minLng).toBeLessThanOrEqual(SERVICE_AREA.minLng + EPS);
    expect(bounds.maxLng).toBeGreaterThanOrEqual(SERVICE_AREA.maxLng - EPS);
  });
});
