'use client';

import { skipToken, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Actor } from '@/lib/api-client';
import type { EstimateStatus } from '@/lib/booking-state';
import { ESTIMATE_DEBOUNCE_MS } from '@/lib/config';
import { findLandmark, toApiLocation } from '@/lib/landmarks';
import { queryKeys } from '@/lib/query-client';
import { useDebouncedValue } from './use-debounced-value';

/**
 * Both categories' fare and pickup ETA for the chosen landmarks, fetched 300 ms after the trip
 * stops changing. Returns `loading` during the debounce too, so a stale price for the previous
 * trip is never shown.
 */
export function useFareEstimate(
  actor: Actor | null,
  pickupId: string,
  destinationId: string,
): { estimate: EstimateStatus; retry: () => void } {
  const tripKey = `${pickupId}|${destinationId}`;
  const debouncedKey = useDebouncedValue(tripKey, ESTIMATE_DEBOUNCE_MS);
  const [debouncedPickupId = '', debouncedDestinationId = ''] = debouncedKey.split('|');

  const pickup = findLandmark(debouncedPickupId);
  const destination = findLandmark(debouncedDestinationId);
  const enabled = actor !== null && !!pickup && !!destination && pickup.id !== destination.id;

  const query = useQuery({
    queryKey: queryKeys.fareEstimate(actor?.id ?? '', debouncedPickupId, debouncedDestinationId),
    queryFn:
      enabled && pickup && destination
        ? ({ signal }) =>
            api.estimateFares(
              actor,
              { pickup: toApiLocation(pickup), destination: toApiLocation(destination) },
              signal,
            )
        : skipToken,
    // Driver positions move, so ETAs go stale; prices for the same trip do not change.
    staleTime: 15_000,
  });

  const currentValid =
    !!findLandmark(pickupId) && !!findLandmark(destinationId) && pickupId !== destinationId;

  let estimate: EstimateStatus;
  if (!currentValid) estimate = { status: 'idle' };
  else if (debouncedKey !== tripKey || !enabled || query.isPending)
    estimate = { status: 'loading' };
  else if (query.isError) estimate = { status: 'error', error: query.error };
  else estimate = { status: 'success', data: query.data };

  return { estimate, retry: () => void query.refetch() };
}
