/** BUSY is set only by the ride lifecycle (accept); drivers toggle AVAILABLE/OFFLINE themselves. */
export const DRIVER_AVAILABILITY = ['OFFLINE', 'AVAILABLE', 'BUSY'] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITY)[number];
