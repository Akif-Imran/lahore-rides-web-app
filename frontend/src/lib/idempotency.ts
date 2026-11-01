/**
 * One Idempotency-Key per ride-request *intent* (blueprint 3.3B / 5.4.2):
 * - the first click on "Request ride" mints a key for the current trip;
 * - every retry of that same trip reuses it, so the backend replays instead of duplicating;
 * - a different trip (other landmarks, category or rider) gets a new key;
 * - after a success the intent is over and the next request gets a new key.
 */
export class IntentKeyStore {
  private current: { fingerprint: string; key: string } | null = null;

  constructor(private readonly generate: () => string = randomUuid) {}

  keyFor(fingerprint: string): string {
    if (this.current?.fingerprint !== fingerprint) {
      this.current = { fingerprint, key: this.generate() };
    }
    return this.current.key;
  }

  /** Ends the intent (call after a successful request). */
  reset(): void {
    this.current = null;
  }
}

/** Deterministic JSON with sorted object keys, so equal requests give equal fingerprints. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * RFC 4122 v4 UUID. `crypto.randomUUID` only exists in secure contexts (HTTPS or localhost),
 * so opening the app over a LAN IP falls back to `getRandomValues`, which is always present.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
