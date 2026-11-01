'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { Actor } from '@/lib/api-client';
import { DEFAULT_DRIVER, DEFAULT_RIDER, findDemoDriver, findDemoRider } from '@/lib/demo-actors';
import { createPersistedChoice } from '@/lib/persisted-choice';

// The rider is "the person using the app": shared by all tabs. Each driver console tab acts as
// its own driver (sessionStorage), so two tabs can race to accept the same ride.
const riderChoice = createPersistedChoice({
  key: 'ride-booking:rider-id',
  storage: 'local',
  fallback: DEFAULT_RIDER.id,
  isValid: (id) => findDemoRider(id) !== undefined,
});

const driverChoice = createPersistedChoice({
  key: 'ride-booking:driver-id',
  storage: 'session',
  fallback: DEFAULT_DRIVER.id,
  isValid: (id) => findDemoDriver(id) !== undefined,
});

// The server never knows the stored choice, so it renders "no identity yet" (null) and the
// client fills it in right after hydration. Queries wait for it, so no request is ever sent
// as the wrong user.
const serverSnapshot = () => null;

export function useRiderId(): string | null {
  return useSyncExternalStore(riderChoice.subscribe, riderChoice.get, serverSnapshot);
}

export function useDriverId(): string | null {
  return useSyncExternalStore(driverChoice.subscribe, driverChoice.get, serverSnapshot);
}

export const setRiderId = (id: string) => riderChoice.set(id);
export const setDriverId = (id: string) => driverChoice.set(id);

export function useRiderActor(): Actor | null {
  const id = useRiderId();
  return useMemo(() => (id ? { role: 'rider', id } : null), [id]);
}

export function useDriverActor(): Actor | null {
  const id = useDriverId();
  return useMemo(() => (id ? { role: 'driver', id } : null), [id]);
}
