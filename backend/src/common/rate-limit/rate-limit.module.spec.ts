import { trackRequester } from './rate-limit.module.js';

const RIDER = '11111111-1111-4111-8111-000000000001';
const DRIVER = '22222222-2222-4222-8222-000000000001';

describe('trackRequester', () => {
  it('buckets by caller identity when a valid id is sent', () => {
    expect(trackRequester({ headers: { 'x-rider-id': RIDER }, ip: '1.2.3.4' })).toBe(
      `actor:${RIDER}`,
    );
    expect(trackRequester({ headers: { 'x-driver-id': DRIVER }, ip: '1.2.3.4' })).toBe(
      `actor:${DRIVER}`,
    );
  });

  it('normalises case so one identity is one bucket', () => {
    expect(trackRequester({ headers: { 'x-rider-id': RIDER.toUpperCase() } })).toBe(
      `actor:${RIDER}`,
    );
  });

  it('falls back to the client IP for missing or malformed identities', () => {
    expect(trackRequester({ headers: {}, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(trackRequester({ headers: { 'x-rider-id': 'not-a-uuid' }, ip: '1.2.3.4' })).toBe(
      'ip:1.2.3.4',
    );
    expect(trackRequester({})).toBe('ip:unknown');
  });
});
