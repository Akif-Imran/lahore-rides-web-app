import { QueryClient } from '@tanstack/react-query';
import { isTransientError } from './errors';

export const MAX_QUERY_RETRIES = 3;

/** 1 s, 2 s, 4 s ... capped at 8 s. */
export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

/** Reads retry only on transient failures (no response, 5xx); a 4xx answer is final. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isTransientError(error);
}

export const queryKeys = {
  fareEstimate: (riderId: string, pickupId: string, destinationId: string) =>
    ['fare-estimate', riderId, pickupId, destinationId] as const,
  ride: (riderId: string, rideId: string) => ['ride', riderId, rideId] as const,
  activeRide: (riderId: string) => ['active-ride', riderId] as const,
  driver: (driverId: string) => ['driver', driverId] as const,
  offers: (driverId: string) => ['offers', driverId] as const,
};

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        retryDelay,
        staleTime: 2_000,
        refetchOnWindowFocus: true,
      },
      // Writes are never retried behind the user's back; the UI offers an explicit Retry
      // (which for POST /rides reuses the same Idempotency-Key).
      mutations: { retry: false },
    },
  });
}
