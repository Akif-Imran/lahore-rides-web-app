import { ConfigValidationError, DEFAULT_SERVICE_AREA, loadConfig } from './env.schema.js';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    const config = loadConfig({ DATABASE_URL });

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3001,
      logLevel: 'info',
      corsOrigins: ['http://localhost:3000'],
      database: { url: DATABASE_URL, poolMax: 10, lockTimeoutMs: 3000, statementTimeoutMs: 5000 },
      serviceArea: DEFAULT_SERVICE_AREA,
      matching: { maxOfferRadiusKm: 5, driverLocationTtlSeconds: 120 },
      rides: { requestTtlSeconds: 300, expirySweepEnabled: true },
      rateLimit: { ttlSeconds: 60, limit: 120, createRideLimit: 10 },
    });
  });

  it('parses and coerces explicit values', () => {
    const config = loadConfig({
      DATABASE_URL,
      NODE_ENV: 'production',
      PORT: '8080',
      CORS_ORIGINS: 'https://a.example, https://b.example',
      SERVICE_AREA_BBOX: '31.4,74.2,31.6,74.5',
      RIDE_EXPIRY_SWEEP_ENABLED: 'false',
      MAX_OFFER_RADIUS_KM: '2.5',
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(config.serviceArea).toEqual({ minLat: 31.4, minLng: 74.2, maxLat: 31.6, maxLng: 74.5 });
    expect(config.rides.expirySweepEnabled).toBe(false);
    expect(config.matching.maxOfferRadiusKm).toBe(2.5);
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ DATABASE_URL, PORT: '', LOG_LEVEL: '' });
    expect(config.port).toBe(3001);
    expect(config.logLevel).toBe('info');
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigValidationError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['DATABASE_URL', 'mysql://localhost/db'],
    ['PORT', 'not-a-number'],
    ['PORT', '70000'],
    ['LOG_LEVEL', 'verbose'],
    ['NODE_ENV', 'staging'],
    ['CORS_ORIGINS', 'not a url'],
    ['SERVICE_AREA_BBOX', '31.7,74.1,31.3,74.5'],
    ['SERVICE_AREA_BBOX', '1,2,3'],
    ['DB_POOL_MAX', '0'],
    ['RIDE_EXPIRY_SWEEP_ENABLED', 'maybe'],
  ])('rejects invalid %s=%s and names the variable', (key, value) => {
    const env = { DATABASE_URL, [key]: value };
    expect(() => loadConfig(env)).toThrow(ConfigValidationError);
    expect(() => loadConfig(env)).toThrow(new RegExp(key));
  });
});
