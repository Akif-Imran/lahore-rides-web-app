const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check only; the backend is the authority on whether the id exists. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
