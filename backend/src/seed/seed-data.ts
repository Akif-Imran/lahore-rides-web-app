import type { RideCategory } from '../common/domain/ride-category.js';
import type { DriverAvailability } from '../drivers/driver-availability.js';

/**
 * Demo identities with fixed, v4-shaped UUIDs so README examples, tests, E2E and the frontend's
 * demo actor switcher can all refer to them. All data is fictional.
 * The frontend mirrors these in `frontend/src/lib/demo-actors.ts`; keep the two in sync.
 */

export interface SeedRider {
  id: string;
  name: string;
  phone: string;
}

export interface SeedDriver {
  id: string;
  name: string;
  phone: string;
  vehicleCategory: RideCategory;
  vehicleModel: string;
  vehiclePlate: string;
  /** State restored by `seed --reset`. BUSY is never seeded: it requires an active assignment. */
  availability: Exclude<DriverAvailability, 'BUSY'>;
  area: string;
  lat: number;
  lng: number;
}

export const SEED_RIDERS: readonly SeedRider[] = [
  { id: '11111111-1111-4111-8111-000000000001', name: 'Ayesha Khan', phone: '+923000000001' },
  { id: '11111111-1111-4111-8111-000000000002', name: 'Bilal Ahmed', phone: '+923000000002' },
  { id: '11111111-1111-4111-8111-000000000003', name: 'Sana Malik', phone: '+923000000003' },
];

export const SEED_DRIVERS: readonly SeedDriver[] = [
  {
    id: '22222222-2222-4222-8222-000000000001',
    name: 'Usman Tariq',
    phone: '+923100000001',
    vehicleCategory: 'ECONOMY',
    vehicleModel: 'Suzuki Alto',
    vehiclePlate: 'LEA-1001',
    availability: 'AVAILABLE',
    area: 'Gulberg',
    lat: 31.52,
    lng: 74.36,
  },
  {
    id: '22222222-2222-4222-8222-000000000002',
    name: 'Hamza Sheikh',
    phone: '+923100000002',
    vehicleCategory: 'ECONOMY',
    vehicleModel: 'Suzuki Cultus',
    vehiclePlate: 'LEA-1002',
    availability: 'OFFLINE',
    area: 'Model Town',
    lat: 31.4834,
    lng: 74.326,
  },
  {
    id: '22222222-2222-4222-8222-000000000003',
    name: 'Ali Raza',
    phone: '+923100000003',
    vehicleCategory: 'ECONOMY',
    vehicleModel: 'Suzuki WagonR',
    vehiclePlate: 'LEA-1003',
    availability: 'AVAILABLE',
    area: 'Johar Town',
    lat: 31.475,
    lng: 74.29,
  },
  {
    id: '22222222-2222-4222-8222-000000000004',
    name: 'Fatima Noor',
    phone: '+923100000004',
    vehicleCategory: 'ECONOMY',
    vehicleModel: 'Suzuki Alto',
    vehiclePlate: 'LEA-1004',
    availability: 'AVAILABLE',
    area: 'Walled City',
    lat: 31.578,
    lng: 74.322,
  },
  {
    id: '22222222-2222-4222-8222-000000000005',
    name: 'Imran Qureshi',
    phone: '+923100000005',
    vehicleCategory: 'COMFORT',
    vehicleModel: 'Toyota Corolla',
    vehiclePlate: 'LEB-2001',
    availability: 'AVAILABLE',
    area: 'DHA',
    lat: 31.47,
    lng: 74.39,
  },
  {
    id: '22222222-2222-4222-8222-000000000006',
    name: 'Zainab Hussain',
    phone: '+923100000006',
    vehicleCategory: 'COMFORT',
    vehicleModel: 'Honda Civic',
    vehiclePlate: 'LEB-2002',
    availability: 'AVAILABLE',
    area: 'Mall Road',
    lat: 31.545,
    lng: 74.335,
  },
];
