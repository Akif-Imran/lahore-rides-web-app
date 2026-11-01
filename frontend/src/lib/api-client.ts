import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config';
import { ApiError, isServerErrorCode } from './errors';

/**
 * Who is calling. Sent as `X-Rider-Id` / `X-Driver-Id` (demo identity, DECISIONS D6);
 * replacing this with a bearer token is the only change real auth would need here.
 */
export type Actor = { role: 'rider' | 'driver'; id: string };

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  actor: Actor;
  body?: unknown;
  headers?: Record<string, string>;
  /** Caller cancellation (e.g. TanStack Query unmounting); rethrown as-is, not as an ApiError. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  /** Parsed JSON body; `undefined` for an empty body (e.g. 304). */
  data: T;
  status: number;
  headers: Headers;
}

function actorHeader(actor: Actor): Record<string, string> {
  return actor.role === 'rider' ? { 'X-Rider-Id': actor.id } : { 'X-Driver-Id': actor.id };
}

/** `Retry-After` as seconds: either delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

/**
 * Builds an ApiError from a non-2xx response. Uses the standard envelope
 * `{ error: { code, message, details?, requestId } }` when present; anything else (an HTML
 * error page from a proxy, a truncated body) becomes UNEXPECTED_RESPONSE with the status kept.
 */
export function errorFromResponse(status: number, headers: Headers, bodyText: string): ApiError {
  const retryAfterSeconds = parseRetryAfter(headers.get('Retry-After'));
  const headerRequestId = headers.get('X-Request-Id');

  let envelope: unknown = null;
  try {
    envelope = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    envelope = null;
  }

  const error =
    typeof envelope === 'object' && envelope !== null
      ? (envelope as { error?: unknown }).error
      : undefined;

  if (typeof error === 'object' && error !== null) {
    const { code, message, details, requestId } = error as Record<string, unknown>;
    if (isServerErrorCode(code) && typeof message === 'string') {
      return new ApiError({
        code,
        message,
        status,
        requestId: typeof requestId === 'string' ? requestId : headerRequestId,
        details:
          typeof details === 'object' && details !== null && !Array.isArray(details)
            ? (details as Record<string, unknown>)
            : null,
        retryAfterSeconds,
      });
    }
  }

  return new ApiError({
    code: 'UNEXPECTED_RESPONSE',
    message: `Unexpected response (HTTP ${status})`,
    status,
    requestId: headerRequestId,
    retryAfterSeconds,
  });
}

class RequestTimeout extends Error {
  override readonly name = 'RequestTimeout';
}

/**
 * Typed `fetch` wrapper: actor header, JSON body, 10 s timeout, envelope parsing.
 * Failures are always ApiError (NETWORK_ERROR for no response or a timeout), except a
 * cancellation requested by the caller, which is rethrown untouched.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions,
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    actor,
    body,
    headers = {},
    signal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;

  // One controller aborts on either the caller's signal or our timeout, so `fetch` only ever
  // sees a single signal created in the current realm.
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new RequestTimeout()), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...actorHeader(actor),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      // Freshness is handled explicitly (ETag for ride polling); never serve from the HTTP cache.
      cache: 'no-store',
      credentials: 'omit',
    });

    const text = await response.text();
    if (!response.ok && response.status !== 304) {
      throw errorFromResponse(response.status, response.headers, text);
    }

    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (cause) {
        throw new ApiError({
          code: 'UNEXPECTED_RESPONSE',
          message: 'The server sent a response that is not valid JSON',
          status: response.status,
          requestId: response.headers.get('X-Request-Id'),
          cause,
        });
      }
    }
    return { data: data as T, status: response.status, headers: response.headers };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw error;
    const timedOut = controller.signal.reason instanceof RequestTimeout;
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: timedOut
        ? `The server did not respond within ${Math.round(timeoutMs / 1000)} s`
        : 'The server could not be reached',
      status: 0,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Last ETag and body per (caller, URL), so polling can send `If-None-Match` and reuse the
 * body on `304 Not Modified`. Bounded, oldest entries evicted first.
 */
export class EtagCache<T> {
  private readonly entries = new Map<string, { etag: string; data: T }>();

  constructor(private readonly maxEntries = 50) {}

  get(key: string): { etag: string; data: T } | undefined {
    return this.entries.get(key);
  }

  set(key: string, etag: string, data: T): void {
    this.entries.delete(key);
    this.entries.set(key, { etag, data });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
