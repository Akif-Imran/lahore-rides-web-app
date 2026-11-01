import { canonicalJson, sha256OfCanonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('sorts keys at every level so key order never changes the output', () => {
    const a = { pickup: { lat: 1, lng: 2, name: 'A' }, category: 'ECONOMY' };
    const b = { category: 'ECONOMY', pickup: { name: 'A', lng: 2, lat: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"category":"ECONOMY","pickup":{"lat":1,"lng":2,"name":"A"}}');
  });

  it('keeps array order (it is meaningful)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('drops undefined properties like JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('sha256OfCanonicalJson', () => {
  it('is a 64-char hex digest, stable under key reordering', () => {
    const hash = sha256OfCanonicalJson({ x: 1, y: [1, 2] });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256OfCanonicalJson({ y: [1, 2], x: 1 })).toBe(hash);
  });

  it('changes when any value changes', () => {
    expect(sha256OfCanonicalJson({ category: 'ECONOMY' })).not.toBe(
      sha256OfCanonicalJson({ category: 'COMFORT' }),
    );
  });
});
