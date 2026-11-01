import type { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'api/v1';

/**
 * HTTP-level configuration shared by main.ts, integration tests and the OpenAPI export, so
 * tests exercise exactly what runs in production. Process-level concerns (listen, shutdown
 * hooks) stay in main.ts.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix(API_PREFIX);
  return app;
}
