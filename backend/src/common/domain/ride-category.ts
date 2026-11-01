/** Ride / vehicle categories. A vehicle's category also bounds which rides it may serve. */
export const RIDE_CATEGORIES = ['ECONOMY', 'COMFORT'] as const;
export type RideCategory = (typeof RIDE_CATEGORIES)[number];
