import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Accept a caller-supplied id only if it is short and log-safe; otherwise mint one. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Resolves the request id (propagating a valid incoming `X-Request-Id` for cross-service
 * tracing) and echoes it on the response. Used as pino-http's `genReqId`, and by the error
 * filter for errors raised before the logging middleware ran (e.g. malformed JSON bodies).
 */
export function assignRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  if (!res.headersSent) res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
