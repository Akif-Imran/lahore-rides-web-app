import { describe, expect, it } from 'vitest';
import {
  ApiError,
  isNetworkError,
  isServerErrorCode,
  isTransientError,
  shouldShowRequestId,
  toUserMessage,
} from '@/lib/errors';

const err = (code: ApiError['code'], status: number, extra: Partial<ApiError> = {}) =>
  new ApiError({ code, status, message: 'internal detail', ...extra });

describe('ApiError.fieldErrors', () => {
  it('returns well-formed VALIDATION_ERROR fields and skips malformed ones', () => {
    const error = new ApiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'bad',
      details: {
        fields: [
          { field: 'pickup.lat', message: 'too big' },
          { field: 'destination', message: 'too short', code: 'TRIP_TOO_SHORT' },
          { field: 42, message: 'x' },
          'nonsense',
          null,
        ],
      },
    });
    expect(error.fieldErrors).toEqual([
      { field: 'pickup.lat', message: 'too big' },
      { field: 'destination', message: 'too short', code: 'TRIP_TOO_SHORT' },
    ]);
  });

  it('is empty without details', () => {
    expect(err('VALIDATION_ERROR', 400).fieldErrors).toEqual([]);
  });
});

describe('error classification', () => {
  it('treats no response and 5xx as transient, 4xx as final', () => {
    expect(isTransientError(err('NETWORK_ERROR', 0))).toBe(true);
    expect(isTransientError(err('INTERNAL_ERROR', 500))).toBe(true);
    expect(isTransientError(err('SERVICE_UNAVAILABLE', 503))).toBe(true);
    expect(isTransientError(err('NOT_FOUND', 404))).toBe(false);
    expect(isTransientError(err('RATE_LIMITED', 429))).toBe(false);
    expect(isTransientError(new Error('plain'))).toBe(false);
  });

  it('recognises network errors', () => {
    expect(isNetworkError(err('NETWORK_ERROR', 0))).toBe(true);
    expect(isNetworkError(err('INTERNAL_ERROR', 500))).toBe(false);
  });

  it('shows the request id only for server-side failures that have one', () => {
    expect(shouldShowRequestId(err('INTERNAL_ERROR', 500, { requestId: 'r' }))).toBe(true);
    expect(shouldShowRequestId(err('INTERNAL_ERROR', 500))).toBe(false);
    expect(shouldShowRequestId(err('NOT_FOUND', 404, { requestId: 'r' }))).toBe(false);
  });

  it('knows every backend error code', () => {
    expect(isServerErrorCode('RIDE_ALREADY_ASSIGNED')).toBe(true);
    expect(isServerErrorCode('NETWORK_ERROR')).toBe(false);
    expect(isServerErrorCode(undefined)).toBe(false);
  });
});

describe('toUserMessage', () => {
  it('maps codes to friendly copy and never echoes the server message', () => {
    expect(toUserMessage(err('RIDE_ALREADY_ASSIGNED', 409))).toBe('Another driver took this ride.');
    expect(toUserMessage(err('NETWORK_ERROR', 0))).toMatch(/couldn't reach the server/i);
    for (const code of ['INTERNAL_ERROR', 'UNEXPECTED_RESPONSE', 'NOT_FOUND'] as const) {
      expect(toUserMessage(err(code, 500))).not.toContain('internal detail');
    }
  });

  it('has a generic message for non-API errors', () => {
    expect(toUserMessage(new Error('stack trace here'))).toBe(
      'Something went wrong on our side. Please try again.',
    );
    expect(toUserMessage('weird')).toBe('Something went wrong on our side. Please try again.');
  });
});
