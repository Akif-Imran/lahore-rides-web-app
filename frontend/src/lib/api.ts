import type {
  ActiveRideResponse,
  CreateRideRequest,
  Driver,
  FareEstimateRequest,
  FareEstimateResponse,
  Offer,
  OffersResponse,
  Ride,
  UpdateAvailabilityRequest,
} from '@/types/api';
import { type Actor, apiRequest, EtagCache } from './api-client';

const rideEtags = new EtagCache<Ride>();

const segment = (id: string) => encodeURIComponent(id);

export interface CreateRideResult {
  ride: Ride;
  /** True when the backend replayed the stored response for a retried Idempotency-Key. */
  replayed: boolean;
}

export type DriverRideAction = 'accept' | 'start' | 'complete';

/** One function per endpoint; types come from the generated OpenAPI contract. */
export const api = {
  async estimateFares(
    actor: Actor,
    body: FareEstimateRequest,
    signal?: AbortSignal,
  ): Promise<FareEstimateResponse> {
    const res = await apiRequest<FareEstimateResponse>('/fare-estimates', {
      method: 'POST',
      actor,
      body,
      signal,
    });
    return res.data;
  },

  /** The same `idempotencyKey` must be reused when retrying the same ride request. */
  async createRide(
    actor: Actor,
    body: CreateRideRequest,
    idempotencyKey: string,
  ): Promise<CreateRideResult> {
    const res = await apiRequest<Ride>('/rides', {
      method: 'POST',
      actor,
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return { ride: res.data, replayed: res.headers.get('Idempotent-Replayed') === 'true' };
  },

  /** Conditional GET: sends the last ETag and reuses the cached body on 304. */
  async getRide(actor: Actor, rideId: string, signal?: AbortSignal): Promise<Ride> {
    const path = `/rides/${segment(rideId)}`;
    const cacheKey = `${actor.role}:${actor.id}:${path}`;
    const cached = rideEtags.get(cacheKey);
    const res = await apiRequest<Ride>(path, {
      actor,
      signal,
      headers: cached ? { 'If-None-Match': cached.etag } : {},
    });
    if (res.status === 304 && cached) return cached.data;
    const etag = res.headers.get('ETag');
    if (etag) rideEtags.set(cacheKey, etag, res.data);
    else rideEtags.delete(cacheKey);
    return res.data;
  },

  async cancelRide(actor: Actor, rideId: string, reason?: string): Promise<Ride> {
    const res = await apiRequest<Ride>(`/rides/${segment(rideId)}/cancel`, {
      method: 'POST',
      actor,
      body: reason ? { reason } : {},
    });
    return res.data;
  },

  async driverRideAction(actor: Actor, rideId: string, action: DriverRideAction): Promise<Ride> {
    const res = await apiRequest<Ride>(`/rides/${segment(rideId)}/${action}`, {
      method: 'POST',
      actor,
    });
    return res.data;
  },

  async getActiveRide(actor: Actor, signal?: AbortSignal): Promise<Ride | null> {
    const res = await apiRequest<ActiveRideResponse>('/riders/me/active-ride', { actor, signal });
    return res.data.ride;
  },

  async getDriver(actor: Actor, signal?: AbortSignal): Promise<Driver> {
    const res = await apiRequest<Driver>(`/drivers/${segment(actor.id)}`, { actor, signal });
    return res.data;
  },

  async getOffers(actor: Actor, signal?: AbortSignal): Promise<Offer[]> {
    const res = await apiRequest<OffersResponse>(`/drivers/${segment(actor.id)}/offers`, {
      actor,
      signal,
    });
    return res.data.offers;
  },

  async setAvailability(actor: Actor, body: UpdateAvailabilityRequest): Promise<Driver> {
    const res = await apiRequest<Driver>(`/drivers/${segment(actor.id)}/availability`, {
      method: 'PATCH',
      actor,
      body,
    });
    return res.data;
  },
};

/** Test hook: forget cached ETags between tests. */
export function resetRideEtagCache(): void {
  rideEtags.clear();
}
