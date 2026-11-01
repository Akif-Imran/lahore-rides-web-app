/**
 * One-line, log-safe description of an unknown thrown value.
 *
 * Node network errors are often AggregateErrors with an empty message (e.g. `localhost`
 * resolving to both ::1 and 127.0.0.1, each refusing the connection), so fall back to the
 * error code and the inner errors instead of logging an empty string.
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    const inner = [...new Set(error.errors.map(describeError))].join('; ');
    return error.message ? `${error.message} (${inner})` : inner;
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (error.message) return error.message;
    if (typeof code === 'string') return code;
    return error.name;
  }
  return typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error));
}
