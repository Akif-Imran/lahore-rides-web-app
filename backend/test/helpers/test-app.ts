import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { AppConfig } from '../../src/config/env.schema.js';
import { PG_POOL } from '../../src/database/pg-pool.provider.js';
import { testConfig } from './test-config.js';

export type Http = ReturnType<typeof request>;

export interface TestApp {
  app: INestApplication;
  http: Http;
  /** The app's own pool; tests use it for fixtures and direct database assertions. */
  pool: Pool;
  config: AppConfig;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Environment overrides, e.g. `{ RATE_LIMIT_CREATE_RIDE_LIMIT: '2' }`. */
  env?: Record<string, string>;
  /** Test-only provider overrides (e.g. a repository that throws). */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * The real AppModule and the real `configureApp` (pipes, filter, guards, CORS, helmet),
 * listening on an ephemeral port. Listening up front lets many requests run truly in
 * parallel over separate connections, which the concurrency tests rely on.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = testConfig(options.env);
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)] });
  if (options.customize) builder = options.customize(builder);
  const moduleRef = await builder.compile();

  const app = configureApp(moduleRef.createNestApplication({ bufferLogs: true }), config);
  await app.listen(0, '127.0.0.1');

  return {
    app,
    http: request(app.getHttpServer()),
    pool: app.get<Pool>(PG_POOL),
    config,
    close: () => app.close(),
  };
}
