import type { LatLng } from '../../src/common/utils/geo.js';

export const LIBERTY = { name: 'Liberty Market', lat: 31.5106, lng: 74.344 };
export const FORT = { name: 'Lahore Fort', lat: 31.588, lng: 74.315 };
export const GADDAFI = { name: 'Gaddafi Stadium', lat: 31.5136, lng: 74.3332 };
export const MODEL_TOWN = { name: 'Model Town', lat: 31.4834, lng: 74.326 };

/** ~1.8 km from Liberty Market: inside the 5 km matching radius. */
export const NEAR_LIBERTY: LatLng = { lat: 31.52, lng: 74.36 };
/** ~7.7 km from Liberty Market: outside the 5 km matching radius. */
export const FAR_FROM_LIBERTY: LatLng = { lat: 31.47, lng: 74.41 };

export const tripBody = (overrides: Record<string, unknown> = {}) => ({
  pickup: LIBERTY,
  destination: FORT,
  category: 'ECONOMY',
  ...overrides,
});
