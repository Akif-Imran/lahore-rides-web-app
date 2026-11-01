'use client';

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateRideResult } from '@/lib/api';
import type { Actor } from '@/lib/api-client';
import { isApiError } from '@/lib/errors';
import { queryKeys } from '@/lib/query-client';
import { ridePollInterval } from '@/lib/ride-status';
import type { CreateRideRequest, Ride } from '@/types/api';
import { useRiderActor } from './use-actor';

export interface CreateRideVariables {
  actor: Actor;
  body: CreateRideRequest;
  idempotencyKey: string;
  /** Identifies the intent the request belongs to (see IntentKeyStore). */
  fingerprint: string;
}

export function useCreateRide() {
  const queryClient = useQueryClient();
  return useMutation<CreateRideResult, unknown, CreateRideVariables>({
    mutationFn: ({ actor, body, idempotencyKey }) => api.createRide(actor, body, idempotencyKey),
    onSuccess: ({ ride }, { actor }) => {
      queryClient.setQueryData(queryKeys.ride(actor.id, ride.id), ride);
      queryClient.setQueryData(queryKeys.activeRide(actor.id), ride);
    },
  });
}

/** The rider's ride, polled until it reaches a terminal status (blueprint 4.4). */
export function useRide(rideId: string) {
  const actor = useRiderActor();
  return useQuery({
    queryKey: queryKeys.ride(actor?.id ?? '', rideId),
    queryFn: actor ? ({ signal }) => api.getRide(actor, rideId, signal) : skipToken,
    refetchInterval: (query) => ridePollInterval(query.state),
    // TanStack Query pauses interval polling while the tab is hidden; keep that default.
    refetchIntervalInBackground: false,
  });
}

/** The rider's current non-terminal ride, if any: restores the UI after a refresh. */
export function useActiveRide() {
  const actor = useRiderActor();
  return useQuery({
    queryKey: queryKeys.activeRide(actor?.id ?? ''),
    queryFn: actor ? ({ signal }) => api.getActiveRide(actor, signal) : skipToken,
    staleTime: 0,
  });
}

export function useCancelRide(rideId: string) {
  const queryClient = useQueryClient();
  const actor = useRiderActor();
  return useMutation<Ride, unknown, { reason?: string }>({
    mutationFn: ({ reason }) => {
      if (!actor) throw new Error('No rider selected');
      return api.cancelRide(actor, rideId, reason);
    },
    onSuccess: (ride) => {
      if (!actor) return;
      queryClient.setQueryData(queryKeys.ride(actor.id, rideId), ride);
      queryClient.setQueryData(queryKeys.activeRide(actor.id), null);
    },
    onError: (error) => {
      // A conflict means our view is stale (e.g. the trip just started): fetch the truth.
      if (actor && isApiError(error) && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ride(actor.id, rideId) });
      }
    },
  });
}
