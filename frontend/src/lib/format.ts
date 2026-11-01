import type { CancelledBy, RideCategory } from '@/types/api';

const rupees = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

/** Whole PKR, e.g. `Rs 1,240`. */
export function formatFare(amount: number): string {
  return `Rs ${rupees.format(amount)}`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatEta(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`;
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-PK', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** "just now", "3 min ago", "2 h ago". */
export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export const CATEGORY_LABEL: Record<RideCategory, string> = {
  ECONOMY: 'Economy',
  COMFORT: 'Comfort',
};

export const CATEGORY_DESCRIPTION: Record<RideCategory, string> = {
  ECONOMY: 'Affordable everyday rides',
  COMFORT: 'Newer cars with more room',
};

export const CANCELLED_BY_LABEL: Record<CancelledBy, string> = {
  RIDER: 'you',
  DRIVER: 'the driver',
  SYSTEM: 'the system',
};
