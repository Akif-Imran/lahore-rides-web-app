import { describe, expect, it } from 'vitest';
import { canonicalJson, IntentKeyStore, randomUuid } from '@/lib/idempotency';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('IntentKeyStore', () => {
  it('reuses one key for every retry of the same intent', () => {
    const store = new IntentKeyStore();
    const key = store.keyFor('trip-a');
    expect(store.keyFor('trip-a')).toBe(key);
    expect(store.keyFor('trip-a')).toBe(key);
  });

  it('mints a new key when the intent changes', () => {
    let n = 0;
    const store = new IntentKeyStore(() => `key-${++n}`);
    expect(store.keyFor('trip-a')).toBe('key-1');
    expect(store.keyFor('trip-b')).toBe('key-2');
    // Going back to an earlier trip is a new intent too.
    expect(store.keyFor('trip-a')).toBe('key-3');
  });

  it('mints a new key after the intent ended successfully', () => {
    let n = 0;
    const store = new IntentKeyStore(() => `key-${++n}`);
    expect(store.keyFor('trip-a')).toBe('key-1');
    store.reset();
    expect(store.keyFor('trip-a')).toBe('key-2');
  });
});

describe('canonicalJson', () => {
  it('ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' }, z: undefined })).toBe(
      canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }),
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('distinguishes different values', () => {
    expect(canonicalJson({ category: 'ECONOMY' })).not.toBe(canonicalJson({ category: 'COMFORT' }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('randomUuid', () => {
  it('returns RFC 4122 v4 UUIDs', () => {
    expect(randomUuid()).toMatch(UUID_V4);
    expect(randomUuid()).not.toBe(randomUuid());
  });

  it('falls back to getRandomValues outside secure contexts', () => {
    // Simulate a browser without crypto.randomUUID (plain-HTTP LAN origin).
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(UUID_V4);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
