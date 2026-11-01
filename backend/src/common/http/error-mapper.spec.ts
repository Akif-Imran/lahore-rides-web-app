import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DatabaseError } from 'pg';
import {
  ActiveRideExistsError,
  InvalidStateTransitionError,
  ServiceUnavailableError,
  ValidationError,
} from '../errors/index.js';
import { GENERIC_500_MESSAGE, mapException } from './error-mapper.js';

function pgError(code: string, constraint?: string): DatabaseError {
  const error = new DatabaseError('database said no', 0, 'error');
  error.code = code;
  error.constraint = constraint;
  return error;
}

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('mapException', () => {
  describe('domain errors keep their code, status, message and details', () => {
    it.each([
      [new InvalidStateTransitionError('CANCELLED', 'COMPLETED'), 409, 'INVALID_STATE_TRANSITION'],
      [new ActiveRideExistsError('r1'), 409, 'ACTIVE_RIDE_EXISTS'],
      [new ValidationError([{ field: 'pickup.lat', message: 'too big' }]), 400, 'VALIDATION_ERROR'],
    ])('%s', (error, status, code) => {
      expect(mapException(error)).toMatchObject({
        status,
        code,
        message: error.message,
        details: error.details,
        unexpected: false,
      });
    });

    it('adds Retry-After and flags 503 domain errors as unexpected', () => {
      expect(mapException(new ServiceUnavailableError())).toMatchObject({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        headers: { 'Retry-After': '1' },
        unexpected: true,
      });
    });
  });

  it('maps throttling to 429 RATE_LIMITED', () => {
    expect(mapException(new ThrottlerException())).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      unexpected: false,
    });
  });

  describe('framework HTTP exceptions', () => {
    it.each<[HttpException, number, string]>([
      [new BadRequestException('Bad thing'), 400, 'VALIDATION_ERROR'],
      [new UnauthorizedException(), 401, 'UNAUTHENTICATED'],
      [new ForbiddenException(), 403, 'FORBIDDEN'],
      [new NotFoundException('Cannot GET /api/v1/nope'), 404, 'NOT_FOUND'],
      [new ConflictException(), 409, 'CONFLICT'],
      [new PayloadTooLargeException(), 413, 'VALIDATION_ERROR'],
      [new ServiceUnavailableException(), 503, 'SERVICE_UNAVAILABLE'],
    ])('%s -> %i %s', (exception, status, code) => {
      expect(mapException(exception)).toMatchObject({ status, code });
    });

    it('surfaces the exception message for client errors', () => {
      expect(mapException(new NotFoundException('Cannot GET /api/v1/nope')).message).toBe(
        'Cannot GET /api/v1/nope',
      );
      expect(mapException(new BadRequestException(['first problem', 'second'])).message).toBe(
        'first problem',
      );
    });

    it('hides the message of framework 5xx errors', () => {
      expect(mapException(new InternalServerErrorException('db password is hunter2'))).toEqual({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: GENERIC_500_MESSAGE,
        unexpected: true,
      });
    });
  });

  describe('request body parse errors', () => {
    it.each([
      ['entity.parse.failed', 400, 'Request body is not valid JSON'],
      ['entity.too.large', 413, 'Request body is too large'],
      ['entity.verify.failed', 403, 'Request body could not be read'],
    ])('%s -> %i', (type, status, message) => {
      const error = Object.assign(new SyntaxError('Unexpected token } in JSON'), { type, status });
      expect(mapException(error)).toMatchObject({ status, code: 'VALIDATION_ERROR', message });
    });
  });

  describe('PostgreSQL errors', () => {
    it.each(['40001', '40P01', '55P03', '57014'])(
      'treats %s (serialization/deadlock/lock timeout/statement timeout) as retryable 503',
      (code) => {
        expect(mapException(pgError(code))).toMatchObject({
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          details: { retryable: true },
          headers: { 'Retry-After': '1' },
        });
      },
    );

    it('maps an unanticipated unique violation to 409 CONFLICT without leaking the constraint', () => {
      const mapped = mapException(pgError('23505', 'some_internal_index'));
      expect(mapped).toMatchObject({ status: 409, code: 'CONFLICT', unexpected: true });
      expect(JSON.stringify(mapped)).not.toContain('some_internal_index');
    });

    it('maps connection failures to 503', () => {
      const refused = new AggregateError([
        withCode('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED'),
        withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'),
      ]);
      expect(mapException(refused)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
      expect(mapException(new Error('timeout exceeded when trying to connect'))).toMatchObject({
        status: 503,
      });
      expect(mapException(pgError('57P01'))).toMatchObject({ status: 503 });
    });

    it('treats other database errors (e.g. a CHECK violation) as an internal bug', () => {
      expect(mapException(pgError('23514'))).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    });
  });

  it.each([
    new Error('kaboom: secret internals'),
    new TypeError('x is undefined'),
    'a string',
    null,
  ])('maps unknown throwables (%s) to a generic 500 that leaks nothing', (thrown) => {
    expect(mapException(thrown)).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: GENERIC_500_MESSAGE,
      unexpected: true,
    });
  });
});
