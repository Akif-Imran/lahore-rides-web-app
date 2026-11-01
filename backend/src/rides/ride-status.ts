export const RIDE_STATUSES = [
  'REQUESTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/**
 * A rider may hold at most one ride in these states. Must match the partial unique index
 * `uq_one_active_ride_per_rider` in the init migration.
 */
export const ACTIVE_RIDE_STATUSES = [
  'REQUESTED',
  'ASSIGNED',
  'IN_PROGRESS',
] as const satisfies readonly RideStatus[];

/** Terminal states never change. */
export const TERMINAL_RIDE_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const satisfies readonly RideStatus[];

export function isTerminalStatus(status: RideStatus): boolean {
  return (TERMINAL_RIDE_STATUSES as readonly RideStatus[]).includes(status);
}
