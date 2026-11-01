import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ErrorEnvelope } from './error-envelope.js';
import { mapException } from './error-mapper.js';
import { assignRequestId } from './request-id.js';

/**
 * Single place where errors become HTTP responses, so every non-2xx response has the same
 * envelope and a request id. Expected failures (4xx) are logged once by the request logger
 * at warn level, tagged with the error code; unexpected ones are logged here with the stack.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(AllExceptionsFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: unknown }>();
    const res = http.getResponse<Response>();
    const mapped = mapException(exception);
    const requestId = typeof req.id === 'string' ? req.id : assignRequestId(req, res);

    if (mapped.unexpected) {
      this.logger.error({ err: exception, errorCode: mapped.code, requestId }, 'Request failed');
    }
    res.locals['errorCode'] = mapped.code;

    if (res.headersSent) return;

    for (const [name, value] of Object.entries(mapped.headers ?? {})) res.setHeader(name, value);
    if (mapped.code === 'RATE_LIMITED') normalizeRetryAfter(res);

    const body: ErrorEnvelope = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details ? { details: mapped.details } : {}),
        requestId,
      },
    };
    res.status(mapped.status).json(body);
  }
}

/**
 * Named throttlers set `Retry-After-<name>`; clients expect the standard `Retry-After`.
 * Use the longest wait among the throttlers that tripped.
 */
function normalizeRetryAfter(res: Response): void {
  const waits = Object.entries(res.getHeaders())
    .filter(([name]) => name.toLowerCase().startsWith('retry-after'))
    .map(([, value]) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (waits.length > 0) res.setHeader('Retry-After', String(Math.max(...waits)));
}
