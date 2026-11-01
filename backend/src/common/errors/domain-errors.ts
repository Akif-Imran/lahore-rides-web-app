import { ERROR_HTTP_STATUS, ErrorCode } from './error-codes.js';

export type ErrorDetails = Record<string, unknown>;

/** One invalid input field. `field` is a dotted path, e.g. `pickup.lat`. */
export interface FieldError {
  field: string;
  message: string;
  /** Optional machine-readable reason, e.g. `OUT_OF_SERVICE_AREA`. */
  code?: string;
}

/**
 * Base class for expected, client-facing failures. Services throw these; the global
 * exception filter turns them into the standard error envelope. Anything that is not a
 * DomainError (or a known framework/database error) is treated as a 500 and its details
 * are never sent to the client.
 */
export class DomainError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = new.target.name;
    this.httpStatus = ERROR_HTTP_STATUS[code];
  }
}

export class ValidationError extends DomainError {
  constructor(fields: FieldError[], message = 'Request validation failed') {
    super(ErrorCode.VALIDATION_ERROR, message, { fields });
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Missing or unknown caller identity') {
    super(ErrorCode.UNAUTHENTICATED, message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You are not allowed to perform this action', details?: ErrorDetails) {
    super(ErrorCode.FORBIDDEN, message, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super(ErrorCode.NOT_FOUND, `${resource} not found`, id ? { resource, id } : { resource });
  }
}

/** Also used when a ride exists but is not visible to the caller, so existence never leaks. */
export class RideNotFoundError extends NotFoundError {
  constructor(rideId: string) {
    super('Ride', rideId);
  }
}

export class RideAlreadyAssignedError extends DomainError {
  constructor(rideId: string) {
    super(
      ErrorCode.RIDE_ALREADY_ASSIGNED,
      'This ride has already been accepted by another driver',
      {
        rideId,
      },
    );
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(currentStatus: string, attempted: string) {
    super(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Ride cannot move from ${currentStatus} to ${attempted}`,
      { currentStatus, attempted },
    );
  }
}

export type DriverUnavailableReason = 'BUSY' | 'OFFLINE' | 'NO_LOCATION' | 'LOCATION_STALE';

const DRIVER_UNAVAILABLE_MESSAGES: Record<DriverUnavailableReason, string> = {
  BUSY: 'Driver is already on another trip',
  OFFLINE: 'Driver is offline',
  NO_LOCATION: 'Driver has not reported a location',
  LOCATION_STALE: 'Driver location is out of date',
};

export class DriverUnavailableError extends DomainError {
  constructor(reason: DriverUnavailableReason) {
    super(ErrorCode.DRIVER_UNAVAILABLE, DRIVER_UNAVAILABLE_MESSAGES[reason], { reason });
  }
}

export class DriverNotEligibleError extends DomainError {
  constructor(vehicleCategory: string, rideCategory: string) {
    super(
      ErrorCode.DRIVER_NOT_ELIGIBLE,
      `A ${vehicleCategory} vehicle cannot serve a ${rideCategory} ride`,
      { vehicleCategory, rideCategory },
    );
  }
}

export class ActiveRideExistsError extends DomainError {
  constructor(activeRideId: string | null) {
    super(ErrorCode.ACTIVE_RIDE_EXISTS, 'You already have an active ride', { activeRideId });
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super(
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      'This Idempotency-Key was already used with a different request body',
    );
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'The request conflicts with the current state', details?: ErrorDetails) {
    super(ErrorCode.CONFLICT, message, details);
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message = 'Service temporarily unavailable, please retry', details?: ErrorDetails) {
    super(ErrorCode.SERVICE_UNAVAILABLE, message, details);
  }
}
