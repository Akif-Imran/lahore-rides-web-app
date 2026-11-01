import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { assignRequestId } from '../http/request-id.js';

type ResponseWithLocals = ServerResponse & { locals?: Record<string, unknown> };

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export function buildLoggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      genReqId: assignRequestId,
      // Structured JSON in every environment except local development.
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[REDACTED]',
      },
      // Keep request log lines small: who called what, not every header.
      serializers: {
        req: (req: IncomingMessage & { id?: unknown; raw?: IncomingMessage }) => {
          const raw = req.raw ?? req;
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            riderId: header(raw, 'x-rider-id'),
            driverId: header(raw, 'x-driver-id'),
          };
        },
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // One line per request; for errors it carries the stable error code set by the filter.
      customSuccessObject: (_req, res, value: Record<string, unknown>) => {
        const errorCode = (res as ResponseWithLocals).locals?.['errorCode'];
        return errorCode ? { ...value, errorCode } : value;
      },
      autoLogging: { ignore: (req) => (req.url ?? '').includes('/health/') },
    },
  };
}

@Module({})
export class LoggingModule {
  /**
   * Must be called at runtime (from AppModule.forRoot), not at import time: nestjs-pino
   * creates a provider for every `@InjectPinoLogger(context)` registered *before* this call,
   * so building it lazily guarantees every module's logger context has been registered.
   */
  static forRoot(): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => buildLoggerParams(config),
        }),
      ],
    };
  }
}
