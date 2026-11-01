import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, resetRideEtagCache } from '@/lib/api';
import {
  type Actor,
  apiRequest,
  EtagCache,
  errorFromResponse,
  parseRetryAfter,
} from '@/lib/api-client';
import { API_BASE_URL } from '@/lib/config';
import { ApiError } from '@/lib/errors';

const rider: Actor = { role: 'rider', id: '11111111-1111-4111-8111-000000000001' };
const driver: Actor = { role: 'driver', id: '22222222-2222-4222-8222-000000000001' };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function envelope(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, requestId: 'req-123', ...extra } };
}

type FetchArgs = [string, RequestInit];
let fetchMock: ReturnType<typeof vi.fn<(...args: FetchArgs) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();
  vi.stubGlobal('fetch', fetchMock);
  resetRideEtagCache();
});

afterEach(() => {
  vi.useRealTimers();
});

const sentHeaders = (call = 0) => new Headers(fetchMock.mock.calls[call]![1].headers);

describe('parseRetryAfter', () => {
  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('60')).toBe(60);
    expect(parseRetryAfter(' 5 ')).toBe(5);
    const now = Date.parse('2026-11-01T10:00:00Z');
    expect(parseRetryAfter('Sun, 01 Nov 2026 10:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Sun, 01 Nov 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('ignores missing or malformed values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('errorFromResponse', () => {
  it('parses the standard error envelope', () => {
    const error = errorFromResponse(
      409,
      new Headers(),
      JSON.stringify(
        envelope('INVALID_STATE_TRANSITION', 'nope', {
          details: { currentStatus: 'IN_PROGRESS', attempted: 'CANCELLED' },
        }),
      ),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      message: 'nope',
      status: 409,
      requestId: 'req-123',
      details: { currentStatus: 'IN_PROGRESS', attempted: 'CANCELLED' },
    });
    expect(error.detail('currentStatus')).toBe('IN_PROGRESS');
  });

  it('carries Retry-After for rate limits', () => {
    const error = errorFromResponse(
      429,
      new Headers({ 'Retry-After': '42' }),
      JSON.stringify(envelope('RATE_LIMITED', 'slow down')),
    );
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 42 });
  });

  it('falls back to UNEXPECTED_RESPONSE for non-envelope bodies, keeping status and request id', () => {
    const error = errorFromResponse(
      502,
      new Headers({ 'X-Request-Id': 'from-header' }),
      '<html>Bad gateway</html>',
    );
    expect(error).toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      status: 502,
      requestId: 'from-header',
      details: null,
    });
  });

  it('does not trust unknown error codes or malformed details', () => {
    expect(
      errorFromResponse(400, new Headers(), JSON.stringify(envelope('SOMETHING_NEW', 'x'))).code,
    ).toBe('UNEXPECTED_RESPONSE');
    const error = errorFromResponse(
      400,
      new Headers({ 'X-Request-Id': 'h' }),
      JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'bad', details: ['x'] } }),
    );
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', details: null, requestId: 'h' });
  });
});

describe('apiRequest', () => {
  it('sends the actor header, JSON body and Accept header', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    const res = await apiRequest<{ ok: boolean }>('/fare-estimates', {
      method: 'POST',
      actor: rider,
      body: { a: 1 },
    });

    expect(res).toMatchObject({ data: { ok: true }, status: 200 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_BASE_URL}/fare-estimates`);
    expect(init).toMatchObject({ method: 'POST', body: '{"a":1}', cache: 'no-store' });
    const headers = sentHeaders();
    expect(headers.get('X-Rider-Id')).toBe(rider.id);
    expect(headers.get('X-Driver-Id')).toBeNull();
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('omits Content-Type without a body and uses the driver header for drivers', async () => {
    fetchMock.mockResolvedValue(json({}));
    await apiRequest('/drivers/x', { actor: driver });
    const headers = sentHeaders();
    expect(headers.get('X-Driver-Id')).toBe(driver.id);
    expect(headers.get('X-Rider-Id')).toBeNull();
    expect(headers.get('Content-Type')).toBeNull();
  });

  it('throws the parsed ApiError for error responses', async () => {
    fetchMock.mockResolvedValue(json(envelope('NOT_FOUND', 'gone'), { status: 404 }));
    await expect(apiRequest('/rides/x', { actor: rider })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      requestId: 'req-123',
    });
  });

  it('turns a failed connection into NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiRequest('/rides', { actor: rider })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'The server could not be reached',
    });
  });

  it('times out after the configured delay as NETWORK_ERROR', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = apiRequest('/rides', { actor: rider, timeoutMs: 10_000 });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'The server did not respond within 10 s',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('rethrows a cancellation requested by the caller untouched', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = apiRequest('/rides', { actor: rider, signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('rejects a 2xx body that is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(apiRequest('/rides/x', { actor: rider })).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      status: 200,
    });
  });
});

describe('api endpoints', () => {
  const ride = { id: 'ride-1', status: 'REQUESTED', version: 1 };

  it('createRide sends the Idempotency-Key and reports replays', async () => {
    fetchMock
      .mockResolvedValueOnce(json(ride, { status: 201 }))
      .mockResolvedValueOnce(
        json(ride, { status: 200, headers: { 'Idempotent-Replayed': 'true' } }),
      );
    const body = {
      pickup: { name: 'A', lat: 31.5, lng: 74.3 },
      destination: { name: 'B', lat: 31.6, lng: 74.3 },
      category: 'ECONOMY' as const,
    };

    const first = await api.createRide(rider, body, 'key-1');
    const second = await api.createRide(rider, body, 'key-1');

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(sentHeaders(0).get('Idempotency-Key')).toBe('key-1');
    expect(sentHeaders(1).get('Idempotency-Key')).toBe('key-1');
  });

  it('getRide revalidates with If-None-Match and reuses the body on 304', async () => {
    fetchMock
      .mockResolvedValueOnce(json(ride, { headers: { ETag: 'W/"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } }));

    const first = await api.getRide(rider, 'ride-1');
    const second = await api.getRide(rider, 'ride-1');

    expect(sentHeaders(0).get('If-None-Match')).toBeNull();
    expect(sentHeaders(1).get('If-None-Match')).toBe('W/"v1"');
    expect(second).toBe(first);
  });

  it('keeps ETags per caller so one rider never gets another caller’s cached body', async () => {
    fetchMock.mockImplementation(async () => json(ride, { headers: { ETag: 'W/"v1"' } }));
    await api.getRide(rider, 'ride-1');
    await api.getRide(driver, 'ride-1');
    expect(sentHeaders(1).get('If-None-Match')).toBeNull();
  });

  it('cancelRide always sends a JSON body, with the reason when given', async () => {
    fetchMock.mockImplementation(async () => json(ride));
    await api.cancelRide(rider, 'ride-1');
    await api.cancelRide(rider, 'ride-1', 'changed my mind');
    expect(fetchMock.mock.calls[0]![1].body).toBe('{}');
    expect(fetchMock.mock.calls[1]![1].body).toBe('{"reason":"changed my mind"}');
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API_BASE_URL}/rides/ride-1/cancel`);
  });

  it('driver endpoints use the acting driver id in the path', async () => {
    fetchMock.mockImplementation(async () => json({ offers: [] }));
    await api.getOffers(driver);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API_BASE_URL}/drivers/${driver.id}/offers`);
  });
});

describe('EtagCache', () => {
  it('evicts the oldest entry beyond its capacity', () => {
    const cache = new EtagCache<number>(2);
    cache.set('a', 'e1', 1);
    cache.set('b', 'e2', 2);
    cache.set('a', 'e3', 3); // refreshes "a"
    cache.set('c', 'e4', 4); // evicts "b"
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual({ etag: 'e3', data: 3 });
    expect(cache.get('c')).toEqual({ etag: 'e4', data: 4 });
  });
});
