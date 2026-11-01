import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_PREFIX } from './common/http/api-prefix.js';
import { setupSwagger } from './common/http/openapi.js';
import { REQUEST_ID_HEADER } from './common/http/request-id.js';
import type { AppConfig } from './config/env.schema.js';

export { API_PREFIX };

/**
 * HTTP-level configuration shared by main.ts, integration tests and the OpenAPI export, so
 * tests exercise exactly what runs in production. Process-level concerns (listen, shutdown
 * hooks) stay in main.ts.
 */
export function configureApp<T extends INestApplication>(app: T, config: AppConfig): T {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-Rider-Id',
      'X-Driver-Id',
      'Idempotency-Key',
      REQUEST_ID_HEADER,
      'If-None-Match',
    ],
    exposedHeaders: [REQUEST_ID_HEADER, 'Idempotent-Replayed', 'Retry-After', 'ETag', 'Location'],
    maxAge: 600,
  });
  setupSwagger(app);
  return app;
}
