import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export const RIDER_SECURITY = 'rider';
export const DRIVER_SECURITY = 'driver';

const DESCRIPTION = `
Simplified ride-booking API for Lahore.

**Identity (demo only).** Callers identify themselves with \`X-Rider-Id\` or \`X-Driver-Id\`
(UUIDs of seeded users). Production would use JWT/OIDC; the guard is isolated so that swap is
a one-file change.

**Idempotency.** \`POST /rides\` requires an \`Idempotency-Key\` (UUID) generated once per ride
request and reused on retries. A replay returns the original response with
\`Idempotent-Replayed: true\`; the same key with a different body returns 422.

**Errors.** Every non-2xx response uses one envelope:
\`{ "error": { "code", "message", "details"?, "requestId" } }\`. Clients branch on \`code\`.
Every response carries \`X-Request-Id\`.
`.trim();

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Ride Booking API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0.0')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Rider-Id', description: 'Seeded rider UUID' },
      RIDER_SECURITY,
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Driver-Id', description: 'Seeded driver UUID' },
      DRIVER_SECURITY,
    )
    .addTag('rides', 'Ride requests and lifecycle')
    .addTag('fares', 'Fare and pickup ETA estimates')
    .addTag('riders', 'Rider-scoped queries')
    .addTag('drivers', 'Driver console: availability and offers')
    .addTag('health', 'Liveness and readiness probes')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Swagger UI at /docs, raw OpenAPI JSON at /docs-json (outside the /api/v1 prefix). */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'Ride Booking API',
  });
}
