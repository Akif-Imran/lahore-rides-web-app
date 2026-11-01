import type { NamedLocation } from '@/types/api';

/**
 * Pickup and destination come from this fixed list instead of free-text geocoding
 * (a documented simplification). Coordinates are approximate public landmark locations.
 * Every landmark lies inside the service area and has an Economy driver within 5 km of the
 * seeded positions (checked when the seed was designed, DECISIONS D17).
 */
export interface Landmark {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
}

export const LANDMARKS: readonly Landmark[] = [
  { id: 'liberty-market', name: 'Liberty Market', area: 'Gulberg III', lat: 31.5106, lng: 74.344 },
  { id: 'lahore-fort', name: 'Lahore Fort', area: 'Walled City', lat: 31.588, lng: 74.315 },
  {
    id: 'badshahi-mosque',
    name: 'Badshahi Mosque',
    area: 'Walled City',
    lat: 31.5881,
    lng: 74.3099,
  },
  { id: 'gaddafi-stadium', name: 'Gaddafi Stadium', area: 'Gulberg', lat: 31.5136, lng: 74.3332 },
  { id: 'emporium-mall', name: 'Emporium Mall', area: 'Johar Town', lat: 31.4675, lng: 74.2662 },
  { id: 'packages-mall', name: 'Packages Mall', area: 'Walton Road', lat: 31.4712, lng: 74.3556 },
  {
    id: 'allama-iqbal-airport',
    name: 'Allama Iqbal International Airport',
    area: 'Airport Road',
    lat: 31.5216,
    lng: 74.4036,
  },
  {
    id: 'railway-station',
    name: 'Lahore Railway Station',
    area: 'Railway Road',
    lat: 31.577,
    lng: 74.3368,
  },
  { id: 'johar-town', name: 'Johar Town', area: 'Johar Town', lat: 31.4697, lng: 74.2728 },
  { id: 'dha-phase-5', name: 'DHA Phase 5', area: 'DHA', lat: 31.4627, lng: 74.4091 },
  { id: 'model-town', name: 'Model Town', area: 'Model Town', lat: 31.4834, lng: 74.326 },
  { id: 'mall-road', name: 'Mall Road', area: 'Mall Road', lat: 31.5622, lng: 74.328 },
];

const BY_ID = new Map(LANDMARKS.map((landmark) => [landmark.id, landmark]));

export function findLandmark(id: string | null | undefined): Landmark | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isLandmarkId(id: string): boolean {
  return BY_ID.has(id);
}

/** The API's location shape: `{ name, lat, lng }`. */
export function toApiLocation(landmark: Landmark): NamedLocation {
  return { name: landmark.name, lat: landmark.lat, lng: landmark.lng };
}
