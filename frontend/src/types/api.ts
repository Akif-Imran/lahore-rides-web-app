/**
 * Friendly names for the API contract. Everything here derives from `api.gen.ts`, which is
 * generated from `backend/openapi.json` (`npm run gen:api`), so a backend contract change shows
 * up as a type error in the frontend instead of a runtime surprise.
 */
import type { components } from './api.gen';

type Schemas = components['schemas'];

export type Ride = Schemas['RideResponseDto'];
export type RideStatus = Ride['status'];
export type RideCategory = Ride['category'];
export type RideDriver = NonNullable<Ride['driver']>;
export type RideFare = Ride['fare'];
export type FareBreakdown = Schemas['FareBreakdownDto'];
export type CancelledBy = NonNullable<Ride['cancelledBy']>;
export type Coordinates = Schemas['CoordinatesDto'];
export type NamedLocation = Schemas['LocationDto'];

export type CreateRideRequest = Schemas['CreateRideDto'];
export type CancelRideRequest = Schemas['CancelRideDto'];
export type ActiveRideResponse = Schemas['ActiveRideResponseDto'];

export type FareEstimateRequest = Schemas['FareEstimateRequestDto'];
export type FareEstimateResponse = Schemas['FareEstimateResponseDto'];
export type CategoryEstimate = Schemas['CategoryEstimateDto'];

export type Driver = Schemas['DriverResponseDto'];
export type DriverAvailability = Driver['availability'];
export type Offer = Schemas['OfferDto'];
export type OffersResponse = Schemas['OffersResponseDto'];
export type UpdateAvailabilityRequest = Schemas['UpdateAvailabilityDto'];

export type ErrorBody = Schemas['ErrorBodyDto'];
export type ErrorResponse = Schemas['ErrorResponseDto'];
/** Error codes the backend can return (the envelope's `error.code`). */
export type ServerErrorCode = ErrorBody['code'];

export const RIDE_CATEGORIES = ['ECONOMY', 'COMFORT'] as const satisfies readonly RideCategory[];

export const TERMINAL_RIDE_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const satisfies readonly RideStatus[];

export function isTerminalStatus(status: RideStatus): boolean {
  return (TERMINAL_RIDE_STATUSES as readonly RideStatus[]).includes(status);
}
