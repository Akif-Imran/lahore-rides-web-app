import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOpenApiDocument } from '../src/common/http/openapi.js';
import { API } from './helpers/api.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('health and OpenAPI (blueprint test 16)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('reports liveness and database readiness', async () => {
    const live = await t.http.get(`${API}/health/live`);
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });

    const ready = await t.http.get(`${API}/health/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('serves Swagger UI and the OpenAPI document', async () => {
    expect((await t.http.get('/docs')).status).toBe(200);
    const res = await t.http.get('/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.components.securitySchemes).sort()).toEqual(['driver', 'rider']);
  });

  it('documents every route with a success response and the error envelope', async () => {
    const document = buildOpenApiDocument(t.app);
    const operations = Object.entries(document.paths).flatMap(([route, item]) =>
      Object.entries(
        item as Record<string, { responses: Record<string, unknown>; security?: unknown[] }>,
      ).map(([method, op]) => ({ route, method, op })),
    );
    expect(operations).toHaveLength(13);
    for (const { route, method, op } of operations) {
      const statuses = Object.keys(op.responses);
      expect(
        statuses.some((s) => s.startsWith('2')),
        `${method} ${route} has a 2xx`,
      ).toBe(true);
      if (op.security) expect(statuses, `${method} ${route} documents 401`).toContain('401');
    }
  });

  it('matches the committed backend/openapi.json (run `npm run openapi:export` if this fails)', async () => {
    const committed = JSON.parse(
      await readFile(path.resolve(import.meta.dirname, '../openapi.json'), 'utf8'),
    ) as unknown;
    expect(JSON.parse(JSON.stringify(buildOpenApiDocument(t.app)))).toEqual(committed);
  });
});
