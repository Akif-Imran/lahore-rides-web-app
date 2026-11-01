'use client';

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DriverRideAction } from '@/lib/api';
import type { Actor } from '@/lib/api-client';
import { POLL_INTERVAL_MS } from '@/lib/config';
import { queryKeys } from '@/lib/query-client';
import type { Driver, Ride, UpdateAvailabilityRequest } from '@/types/api';

/** The driver's own profile and active ride, polled so a rider's cancel shows up. */
export function useDriverProfile(actor: Actor | null) {
  return useQuery({
    queryKey: queryKeys.driver(actor?.id ?? ''),
    queryFn: actor ? ({ signal }) => api.getDriver(actor, signal) : skipToken,
    refetchInterval: POLL_INTERVAL_MS,
  });
}

/** Open ride requests the driver could accept now (empty unless AVAILABLE). */
export function useOffers(actor: Actor | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.offers(actor?.id ?? ''),
    queryFn: actor && enabled ? ({ signal }) => api.getOffers(actor, signal) : skipToken,
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export type DriverActionVariables =
  | { rideId: string; action: DriverRideAction }
  | { rideId: string; action: 'cancel'; reason?: string };

export function useDriverRideAction(actor: Actor | null) {
  const queryClient = useQueryClient();
  return useMutation<Ride, unknown, DriverActionVariables>({
    mutationFn: (variables) => {
      if (!actor) throw new Error('No driver selected');
      return variables.action === 'cancel'
        ? api.cancelRide(actor, variables.rideId, variables.reason)
        : api.driverRideAction(actor, variables.rideId, variables.action);
    },
    // Win or lose, the driver's state and the offer list may have changed: refetch both.
    onSettled: () => {
      if (!actor) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.driver(actor.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.offers(actor.id) });
    },
  });
}

export function useSetAvailability(actor: Actor | null) {
  const queryClient = useQueryClient();
  return useMutation<Driver, unknown, UpdateAvailabilityRequest>({
    mutationFn: (body) => {
      if (!actor) throw new Error('No driver selected');
      return api.setAvailability(actor, body);
    },
    onSuccess: (driver) => {
      if (!actor) return;
      queryClient.setQueryData(queryKeys.driver(actor.id), driver);
      void queryClient.invalidateQueries({ queryKey: queryKeys.offers(actor.id) });
    },
    onError: () => {
      if (!actor) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.driver(actor.id) });
    },
  });
}
