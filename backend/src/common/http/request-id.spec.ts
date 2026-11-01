import type { IncomingMessage, ServerResponse } from 'node:http';
import { assignRequestId } from './request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exchange(incoming?: string | string[]) {
  const headers: Record<string, string> = {};
  const req = { headers: incoming === undefined ? {} : { 'x-request-id': incoming } };
  const res = {
    headersSent: false,
    setHeader: (name: string, value: string) => (headers[name] = value),
  };
  const id = assignRequestId(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  return { id, headers };
}

describe('assignRequestId', () => {
  it('mints a UUID and echoes it on the response when none is supplied', () => {
    const { id, headers } = exchange();
    expect(id).toMatch(UUID);
    expect(headers['X-Request-Id']).toBe(id);
  });

  it('propagates a safe incoming id for cross-service tracing', () => {
    expect(exchange('trace-abc_123.4').id).toBe('trace-abc_123.4');
    expect(exchange(['first-id', 'second-id']).id).toBe('first-id');
  });

  it.each(['has spaces', 'line\nbreak', 'x'.repeat(129), '', '<script>'])(
    'replaces an unsafe incoming id (%j) to keep logs clean',
    (unsafe) => {
      expect(exchange(unsafe).id).toMatch(UUID);
    },
  );
});
