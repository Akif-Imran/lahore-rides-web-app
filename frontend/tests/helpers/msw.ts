import { HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { API_BASE_URL } from '@/lib/config';
import type { ServerErrorCode } from '@/types/api';

/** One MSW server per test file; handlers are added per test with `server.use(...)`. */
export const server = setupServer();

/** Registers the server lifecycle. Any request without a handler fails the test. */
export function setupMswServer(): void {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}

export const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

/** The backend's standard error envelope. */
export function errorResponse(
  status: number,
  code: ServerErrorCode,
  message: string,
  options: { details?: Record<string, unknown>; headers?: Record<string, string> } = {},
) {
  return HttpResponse.json(
    {
      error: {
        code,
        message,
        requestId: 'req-test-0001',
        ...(options.details ? { details: options.details } : {}),
      },
    },
    { status, headers: options.headers },
  );
}

/** A promise you resolve from the test, to hold a request "in flight". */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
