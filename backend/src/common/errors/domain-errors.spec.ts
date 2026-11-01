import {
  ActiveRideExistsError,
  ConflictError,
  DomainError,
  DriverNotEligibleError,
  DriverUnavailableError,
  ForbiddenError,
  IdempotencyKeyReusedError,
  InvalidStateTransitionError,
  NotFoundError,
  RideAlreadyAssignedError,
  RideNotFoundError,
  ServiceUnavailableError,
  UnauthenticatedError,
  ValidationError,
} from './domain-errors.js';
import { ERROR_HTTP_STATUS, ErrorCode } from './error-codes.js';

describe('error codes', () => {
  it.each(Object.values(ErrorCode))('%s maps to a 4xx/5xx status', (code) => {
    const status = ERROR_HTTP_STATUS[code];
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
  });

  it('matches the blueprint status table', () => {
    expect(ERROR_HTTP_STATUS).toMatchObject({
      VALIDATION_ERROR: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      DRIVER_NOT_ELIGIBLE: 403,
      NOT_FOUND: 404,
      RIDE_ALREADY_ASSIGNED: 409,
      INVALID_STATE_TRANSITION: 409,
      ACTIVE_RIDE_EXISTS: 409,
      DRIVER_UNAVAILABLE: 409,
      IDEMPOTENCY_KEY_REUSED: 422,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
    });
  });
});

describe('domain errors', () => {
  it.each<[DomainError, string, number, Record<string, unknown> | undefined]>([
    [
      new ValidationError([{ field: 'pickup.lat', message: 'must be a number' }]),
      'VALIDATION_ERROR',
      400,
      { fields: [{ field: 'pickup.lat', message: 'must be a number' }] },
    ],
    [new UnauthenticatedError(), 'UNAUTHENTICATED', 401, undefined],
    [new ForbiddenError(), 'FORBIDDEN', 403, undefined],
    [new NotFoundError('Driver', 'd1'), 'NOT_FOUND', 404, { resource: 'Driver', id: 'd1' }],
    [new RideNotFoundError('r1'), 'NOT_FOUND', 404, { resource: 'Ride', id: 'r1' }],
    [new RideAlreadyAssignedError('r1'), 'RIDE_ALREADY_ASSIGNED', 409, { rideId: 'r1' }],
    [
      new InvalidStateTransitionError('CANCELLED', 'COMPLETED'),
      'INVALID_STATE_TRANSITION',
      409,
      { currentStatus: 'CANCELLED', attempted: 'COMPLETED' },
    ],
    [new DriverUnavailableError('BUSY'), 'DRIVER_UNAVAILABLE', 409, { reason: 'BUSY' }],
    [
      new DriverNotEligibleError('ECONOMY', 'COMFORT'),
      'DRIVER_NOT_ELIGIBLE',
      403,
      { vehicleCategory: 'ECONOMY', rideCategory: 'COMFORT' },
    ],
    [new ActiveRideExistsError('r9'), 'ACTIVE_RIDE_EXISTS', 409, { activeRideId: 'r9' }],
    [new IdempotencyKeyReusedError(), 'IDEMPOTENCY_KEY_REUSED', 422, undefined],
    [new ConflictError(), 'CONFLICT', 409, undefined],
    [new ServiceUnavailableError(), 'SERVICE_UNAVAILABLE', 503, undefined],
  ])('%s carries code, status and details', (error, code, httpStatus, details) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(httpStatus);
    expect(error.details).toEqual(details);
    expect(error.message).not.toBe('');
    expect(error.name).toBe(error.constructor.name);
  });

  it('keeps the subtype chain for not-found errors', () => {
    expect(new RideNotFoundError('r1')).toBeInstanceOf(NotFoundError);
    expect(new RideNotFoundError('r1').message).toBe('Ride not found');
  });

  it('omits the id from not-found details when none is given', () => {
    expect(new NotFoundError('Driver').details).toEqual({ resource: 'Driver' });
  });

  it('gives each unavailability reason its own message', () => {
    const reasons = ['BUSY', 'OFFLINE', 'NO_LOCATION', 'LOCATION_STALE'] as const;
    const messages = reasons.map((reason) => new DriverUnavailableError(reason).message);
    expect(new Set(messages).size).toBe(reasons.length);
  });
});
