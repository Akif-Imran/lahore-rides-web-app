import { loadConfig, type AppConfig } from '../../src/config/env.schema.js';

export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://ridebooking:change_me@localhost:5432/ridebooking_test';

/** Every test begins with TRUNCATE, so refuse anything that is not clearly a test database. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${name}": the database name must end with "_test".`,
    );
  }
}

/**
 * Config for test apps. Built from explicit values, not the developer's process.env, so test
 * behaviour never depends on someone's local .env. Rate limits are effectively disabled
 * (dedicated tests lower them) and the expiry sweeper is off (tests call sweep() directly).
 */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  assertTestDatabase(overrides['DATABASE_URL'] ?? TEST_DATABASE_URL);
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DB_POOL_MAX: '20',
    RIDE_EXPIRY_SWEEP_ENABLED: 'false',
    RIDE_REQUEST_TTL_SECONDS: '300',
    DRIVER_LOCATION_TTL_SECONDS: '120',
    MAX_OFFER_RADIUS_KM: '5',
    RATE_LIMIT_LIMIT: '100000',
    RATE_LIMIT_CREATE_RIDE_LIMIT: '100000',
    ...overrides,
  });
}
