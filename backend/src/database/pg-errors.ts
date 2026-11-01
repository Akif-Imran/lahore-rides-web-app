import { DatabaseError } from 'pg';

/** PostgreSQL SQLSTATE codes the application reacts to. */
export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
  ADMIN_SHUTDOWN: '57P01',
  CANNOT_CONNECT_NOW: '57P03',
} as const;

/** Transient failures where the same request is expected to succeed if retried. */
const RETRYABLE_CODES = new Set<string>([
  PgErrorCode.SERIALIZATION_FAILURE,
  PgErrorCode.DEADLOCK_DETECTED,
  PgErrorCode.LOCK_NOT_AVAILABLE,
  PgErrorCode.QUERY_CANCELED,
]);

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

export function isPgError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return (
    isPgError(error) &&
    error.code === PgErrorCode.UNIQUE_VIOLATION &&
    (constraint === undefined || error.constraint === constraint)
  );
}

export function isRetryablePgError(error: unknown): boolean {
  return isPgError(error) && error.code !== undefined && RETRYABLE_CODES.has(error.code);
}

/** The database is unreachable or went away (as opposed to rejecting a query). */
export function isConnectionError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isConnectionError);
  }
  if (!(error instanceof Error)) return false;
  if (isPgError(error)) {
    return (
      error.code?.startsWith('08') === true ||
      error.code === PgErrorCode.ADMIN_SHUTDOWN ||
      error.code === PgErrorCode.CANNOT_CONNECT_NOW
    );
  }
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return true;
  return /timeout exceeded when trying to connect|Connection terminated/i.test(error.message);
}
