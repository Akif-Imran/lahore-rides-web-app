import { HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  isConnectionError,
  isPgError,
  isRetryablePgError,
  PgErrorCode,
} from '../../database/pg-errors.js';
import { DomainError, type ErrorDetails } from '../errors/domain-errors.js';
import { ErrorCode } from '../errors/error-codes.js';

export interface MappedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
  headers?: Record<string, string>;
  /** Unexpected failure: log at error level with the stack trace. */
  unexpected: boolean;
}

export const GENERIC_500_MESSAGE =
  'Something went wrong on our side. Please retry; if it keeps happening, contact support with the request id.';
const RETRY_AFTER_SECONDS = '1';

const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  422: ErrorCode.VALIDATION_ERROR,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

function codeForStatus(status: number): ErrorCode {
  return (
    STATUS_TO_CODE[status] ??
    (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR)
  );
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const { message } = response as { message: unknown };
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return exception.message;
}

/** body-parser errors carry `type` and `status` (e.g. malformed JSON, body too large). */
function bodyParserError(exception: unknown): { status: number; type: string } | null {
  if (!(exception instanceof Error)) return null;
  const { type, status } = exception as Error & { type?: unknown; status?: unknown };
  return typeof type === 'string' && typeof status === 'number' && type.startsWith('entity.')
    ? { status, type }
    : null;
}

const serviceUnavailable = (message: string): MappedError => ({
  status: 503,
  code: ErrorCode.SERVICE_UNAVAILABLE,
  message,
  details: { retryable: true },
  headers: { 'Retry-After': RETRY_AFTER_SECONDS },
  unexpected: true,
});

/**
 * Maps anything thrown while handling a request to a status, a stable code and a message
 * that is safe to show a client. Internal details (stack, SQL, constraint names) never leave
 * the server; unknown errors become a generic 500.
 */
export function mapException(exception: unknown): MappedError {
  if (exception instanceof DomainError) {
    return {
      status: exception.httpStatus,
      code: exception.code,
      message: exception.message,
      ...(exception.details ? { details: exception.details } : {}),
      ...(exception.httpStatus === 503 ? { headers: { 'Retry-After': RETRY_AFTER_SECONDS } } : {}),
      unexpected: exception.httpStatus >= 500,
    };
  }

  if (exception instanceof ThrottlerException) {
    return {
      status: 429,
      code: ErrorCode.RATE_LIMITED,
      message: 'Too many requests. Please wait a moment and try again.',
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500 && status !== 503) {
      return {
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        message: GENERIC_500_MESSAGE,
        unexpected: true,
      };
    }
    return {
      status,
      code: codeForStatus(status),
      message: httpExceptionMessage(exception),
      ...(status === 503 ? { headers: { 'Retry-After': RETRY_AFTER_SECONDS } } : {}),
      unexpected: status >= 500,
    };
  }

  const parseError = bodyParserError(exception);
  if (parseError) {
    return {
      status: parseError.status,
      code: ErrorCode.VALIDATION_ERROR,
      message:
        parseError.type === 'entity.parse.failed'
          ? 'Request body is not valid JSON'
          : parseError.type === 'entity.too.large'
            ? 'Request body is too large'
            : 'Request body could not be read',
      unexpected: false,
    };
  }

  if (isRetryablePgError(exception)) {
    return serviceUnavailable('The service is busy. Please retry in a moment.');
  }
  if (isPgError(exception) && exception.code === PgErrorCode.UNIQUE_VIOLATION) {
    // Expected unique violations are translated by services; anything reaching here is a
    // conflicting concurrent write we did not anticipate.
    return {
      status: 409,
      code: ErrorCode.CONFLICT,
      message: 'The request conflicts with a concurrent change. Please retry.',
      unexpected: true,
    };
  }
  if (isConnectionError(exception)) {
    return serviceUnavailable('The service is temporarily unavailable. Please retry shortly.');
  }

  return {
    status: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: GENERIC_500_MESSAGE,
    unexpected: true,
  };
}
