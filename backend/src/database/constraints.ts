/**
 * Names of the database constraints the services rely on as concurrency backstops.
 * Must match the init migration; integration tests assert each one fires as expected.
 */
export const CONSTRAINT = {
  ONE_ACTIVE_RIDE_PER_RIDER: 'uq_one_active_ride_per_rider',
  ACTIVE_ASSIGNMENT_PER_RIDE: 'uq_active_assignment_per_ride',
  ACTIVE_ASSIGNMENT_PER_DRIVER: 'uq_active_assignment_per_driver',
} as const;
