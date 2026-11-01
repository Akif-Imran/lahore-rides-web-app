import type { ServerErrorCode } from '@/types/api';

/** Errors raised by the client itself, never sent by the backend. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE';
export type ApiErrorCode = ServerErrorCode | ClientErrorCode;

const SERVER_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'DRIVER_NOT_ELIGIBLE',
  'NOT_FOUND',
  'RIDE_ALREADY_ASSIGNED',
  'INVALID_STATE_TRANSITION',
  'ACTIVE_RIDE_EXISTS',
  'DRIVER_UNAVAILABLE',
  'CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const satisfies readonly ServerErrorCode[];

// Compile-time check that the list above covers every code in the generated contract.
type MissingCodes = Exclude<ServerErrorCode, (typeof SERVER_ERROR_CODES)[number]>;
const _exhaustive: MissingCodes extends never ? true : MissingCodes = true;
void _exhaustive;

export function isServerErrorCode(value: unknown): value is ServerErrorCode {
  return typeof value === 'string' && (SERVER_ERROR_CODES as readonly string[]).includes(value);
}

/** One entry of `details.fields` on a VALIDATION_ERROR, e.g. `{ field: 'pickup.lat', ... }`. */
export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export interface ApiErrorInit {
  code: ApiErrorCode;
  message: string;
  /** HTTP status; 0 when the request never got a response. */
  status: number;
  requestId?: string | null;
  details?: Record<string, unknown> | null;
  retryAfterSeconds?: number | null;
  cause?: unknown;
}

/** Every failed API call surfaces as this, parsed from the backend's error envelope. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message, { cause: init.cause });
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** VALIDATION_ERROR field list; malformed entries are skipped. */
  get fieldErrors(): FieldError[] {
    const fields = this.details?.fields;
    if (!Array.isArray(fields)) return [];
    return fields.flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { field, message, code } = entry as Record<string, unknown>;
      if (typeof field !== 'string' || typeof message !== 'string') return [];
      return [{ field, message, ...(typeof code === 'string' ? { code } : {}) }];
    });
  }

  /** A string detail such as `activeRideId` or `currentStatus`, if present. */
  detail(key: string): string | null {
    const value = this.details?.[key];
    return typeof value === 'string' ? value : null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNetworkError(error: unknown): boolean {
  return isApiError(error) && error.code === 'NETWORK_ERROR';
}

/**
 * Failures that may succeed if the same request is simply sent again: no response at all,
 * or a server-side error. 4xx answers are definitive and are never retried automatically.
 */
export function isTransientError(error: unknown): boolean {
  return isApiError(error) && (error.code === 'NETWORK_ERROR' || error.status >= 500);
}

/** Server-side failures whose request id is worth showing so support can find the logs. */
export function shouldShowRequestId(error: unknown): boolean {
  return isApiError(error) && error.status >= 500 && error.requestId !== null;
}

const USER_MESSAGES: Record<ApiErrorCode, string> = {
  NETWORK_ERROR: "Couldn't reach the server. Check your connection and try again.",
  UNEXPECTED_RESPONSE: 'Something went wrong on our side. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
  SERVICE_UNAVAILABLE: 'The service is busy right now. Please try again in a moment.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  VALIDATION_ERROR: 'Please check the highlighted fields.',
  UNAUTHENTICATED: 'Choose a demo user to continue.',
  FORBIDDEN: "You're not allowed to do that.",
  NOT_FOUND: "We couldn't find that ride.",
  ACTIVE_RIDE_EXISTS: 'You already have a ride in progress.',
  IDEMPOTENCY_KEY_REUSED: 'Your request changed while it was being retried. Please try again.',
  RIDE_ALREADY_ASSIGNED: 'Another driver took this ride.',
  DRIVER_UNAVAILABLE: 'You need to be online and not on a trip to accept rides.',
  DRIVER_NOT_ELIGIBLE: "Your vehicle category can't take this ride.",
  INVALID_STATE_TRANSITION: 'This ride has changed in the meantime. Showing the latest status.',
  CONFLICT: 'That conflicts with a recent change. Please refresh and try again.',
};

/** Short, non-technical copy for any error; never exposes internals. */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) return USER_MESSAGES[error.code];
  return USER_MESSAGES.UNEXPECTED_RESPONSE;
}
