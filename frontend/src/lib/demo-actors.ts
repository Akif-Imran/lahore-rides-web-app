import type { RideCategory } from '@/types/api';

/**
 * Seeded demo identities. Mirrors `backend/src/seed/seed-data.ts` (fixed UUIDs, DECISIONS D2);
 * keep the two in sync. The app sends these as `X-Rider-Id` / `X-Driver-Id`: a stand-in for
 * real authentication, which is a documented limitation.
 */
export interface DemoRider {
  id: string;
  name: string;
}

export interface DemoDriver {
  id: string;
  name: string;
  vehicleCategory: RideCategory;
  vehicle: string;
  plate: string;
  area: string;
  /** Seeded position, used when the driver goes online without having reported one. */
  home: { lat: number; lng: number };
}

export const DEMO_RIDERS: readonly DemoRider[] = [
  { id: '11111111-1111-4111-8111-000000000001', name: 'Ayesha Khan' },
  { id: '11111111-1111-4111-8111-000000000002', name: 'Bilal Ahmed' },
  { id: '11111111-1111-4111-8111-000000000003', name: 'Sana Malik' },
];

export const DEMO_DRIVERS: readonly DemoDriver[] = [
  {
    id: '22222222-2222-4222-8222-000000000001',
    name: 'Usman Tariq',
    vehicleCategory: 'ECONOMY',
    vehicle: 'Suzuki Alto',
    plate: 'LEA-1001',
    area: 'Gulberg',
    home: { lat: 31.52, lng: 74.36 },
  },
  {
    id: '22222222-2222-4222-8222-000000000002',
    name: 'Hamza Sheikh',
    vehicleCategory: 'ECONOMY',
    vehicle: 'Suzuki Cultus',
    plate: 'LEA-1002',
    area: 'Model Town',
    home: { lat: 31.4834, lng: 74.326 },
  },
  {
    id: '22222222-2222-4222-8222-000000000003',
    name: 'Ali Raza',
    vehicleCategory: 'ECONOMY',
    vehicle: 'Suzuki WagonR',
    plate: 'LEA-1003',
    area: 'Johar Town',
    home: { lat: 31.475, lng: 74.29 },
  },
  {
    id: '22222222-2222-4222-8222-000000000004',
    name: 'Fatima Noor',
    vehicleCategory: 'ECONOMY',
    vehicle: 'Suzuki Alto',
    plate: 'LEA-1004',
    area: 'Walled City',
    home: { lat: 31.578, lng: 74.322 },
  },
  {
    id: '22222222-2222-4222-8222-000000000005',
    name: 'Imran Qureshi',
    vehicleCategory: 'COMFORT',
    vehicle: 'Toyota Corolla',
    plate: 'LEB-2001',
    area: 'DHA',
    home: { lat: 31.47, lng: 74.39 },
  },
  {
    id: '22222222-2222-4222-8222-000000000006',
    name: 'Zainab Hussain',
    vehicleCategory: 'COMFORT',
    vehicle: 'Honda Civic',
    plate: 'LEB-2002',
    area: 'Mall Road',
    home: { lat: 31.545, lng: 74.335 },
  },
];

export const DEFAULT_RIDER = DEMO_RIDERS[0]!;
export const DEFAULT_DRIVER = DEMO_DRIVERS[0]!;

export function findDemoRider(id: string | null | undefined): DemoRider | undefined {
  return DEMO_RIDERS.find((rider) => rider.id === id);
}

export function findDemoDriver(id: string | null | undefined): DemoDriver | undefined {
  return DEMO_DRIVERS.find((driver) => driver.id === id);
}
