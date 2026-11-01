/**
 * Writes the OpenAPI document to backend/openapi.json (committed; the frontend generates its
 * API types from it and CI fails if either drifts). Builds the real application graph but
 * never connects to the database (the pg pool connects lazily).
 *   npm run openapi:export
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { buildOpenApiDocument } from '../common/http/openapi.js';
import { describeError } from '../common/utils/describe-error.js';
import { loadConfig } from '../config/env.schema.js';

const OUTPUT = path.resolve(import.meta.dirname, '../../openapi.json');

try {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://openapi:unused@localhost:5432/unused',
    LOG_LEVEL: 'silent',
    RIDE_EXPIRY_SWEEP_ENABLED: 'false',
  });
  const app = configureApp(
    await NestFactory.create(AppModule.forRoot(config), { logger: false }),
    config,
  );
  const document = buildOpenApiDocument(app);
  await writeFile(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI document written to ${path.relative(process.cwd(), OUTPUT)}`);
} catch (error) {
  console.error(`OpenAPI export failed: ${describeError(error)}`);
  process.exitCode = 1;
}
